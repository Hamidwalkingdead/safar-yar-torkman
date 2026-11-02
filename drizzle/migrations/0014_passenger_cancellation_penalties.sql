-- Passenger cancellation penalty and carry-forward debt.
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS prior_debt_amount bigint NOT NULL DEFAULT 0 CHECK (prior_debt_amount >= 0);

CREATE TABLE IF NOT EXISTS public.passenger_cancellation_debts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 passenger_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 source_trip_id uuid NOT NULL UNIQUE REFERENCES public.trips(id),
 driver_id uuid NOT NULL REFERENCES auth.users(id),
 penalty_amount bigint NOT NULL CHECK (penalty_amount > 0),
 platform_amount bigint NOT NULL CHECK (platform_amount >= 0),
 driver_amount bigint NOT NULL CHECK (driver_amount >= 0),
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled')),
 settled_by_trip_id uuid REFERENCES public.trips(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 settled_at timestamptz,
 CHECK (platform_amount + driver_amount = penalty_amount)
);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_cancellation_penalty_once ON public.wallet_transactions(reference_id,kind) WHERE kind='cancellation_penalty';
CREATE INDEX IF NOT EXISTS passenger_cancellation_debts_open_idx
 ON public.passenger_cancellation_debts(passenger_id,created_at) WHERE status='open';
ALTER TABLE public.passenger_cancellation_debts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.passenger_cancellation_debts TO authenticated;
CREATE POLICY passenger_debt_self_read ON public.passenger_cancellation_debts
 FOR SELECT TO authenticated USING (passenger_id=auth.uid());

ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_kind_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_kind_check
 CHECK(kind IN ('trip_earning','topup','withdrawal','refund','adjustment','commission','trip_payment','trip_refund','cancellation_penalty'));

CREATE OR REPLACE FUNCTION public.get_passenger_cancellation_debt()
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(sum(penalty_amount),0)
 FROM public.passenger_cancellation_debts
 WHERE passenger_id=auth.uid() AND status='open';
$$;
REVOKE ALL ON FUNCTION public.get_passenger_cancellation_debt() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_passenger_cancellation_debt() TO authenticated;

-- Include outstanding cancellation debt in the next request's displayed/collected total.
CREATE OR REPLACE FUNCTION public.create_trip(
 p_origin text,p_destination text,p_departure timestamptz,p_km numeric,p_night boolean,
 p_mountain boolean,p_suggested integer DEFAULT NULL,p_payment_method text DEFAULT 'cash'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid; profile public.profiles; fare integer; calculated integer; bal bigint; old_debt bigint;
BEGIN
 SELECT * INTO profile FROM public.profiles WHERE id=auth.uid();
 IF auth.uid() IS NULL OR NOT FOUND OR length(trim(profile.display_name))<2 OR profile.phone !~ '^09[0-9]{9}$'
 THEN RAISE EXCEPTION 'ابتدا پروفایل و شماره تماس را کامل کنید'; END IF;
 IF p_origin IS NULL OR p_destination IS NULL OR trim(p_origin)=trim(p_destination) OR p_departure IS NULL
 OR p_km IS NULL OR p_km<=0 OR p_km>3000 OR p_night IS NULL OR p_mountain IS NULL
 OR (p_suggested IS NOT NULL AND p_suggested<80000)
 OR p_payment_method NOT IN ('cash','wallet') THEN RAISE EXCEPTION 'اطلاعات سفر یا روش پرداخت نامعتبر است'; END IF;
 calculated:=public.trip_fare(p_km,p_night,p_mountain); fare:=coalesce(p_suggested,calculated);
 PERFORM 1 FROM public.passenger_cancellation_debts WHERE passenger_id=auth.uid() AND status='open' FOR UPDATE;
 SELECT coalesce(sum(penalty_amount),0) INTO old_debt
 FROM public.passenger_cancellation_debts WHERE passenger_id=auth.uid() AND status='open';
 IF p_payment_method='wallet' THEN
  INSERT INTO public.wallet_accounts(user_id) VALUES(auth.uid()) ON CONFLICT DO NOTHING;
  SELECT balance INTO bal FROM public.wallet_accounts WHERE user_id=auth.uid() FOR UPDATE;
  IF bal<fare+old_debt THEN RAISE EXCEPTION 'موجودی کیف پول برای کرایه و بدهی قبلی کافی نیست'; END IF;
  UPDATE public.wallet_accounts SET balance=balance-fare-old_debt,updated_at=now() WHERE user_id=auth.uid();
 END IF;
 INSERT INTO public.trips(passenger_id,passenger_name,origin,destination,departure_at,km,night,mountain,calculated,suggested,agreed_fare,commission,driver_net,payment_method,prior_debt_amount)
 VALUES(auth.uid(),profile.display_name,trim(p_origin),trim(p_destination),p_departure,p_km,p_night,p_mountain,calculated,p_suggested,fare,round(fare*0.1)::integer,fare-round(fare*0.1)::integer,p_payment_method,old_debt)
 RETURNING id INTO rid;
 IF p_payment_method='wallet' THEN
  INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
  VALUES(auth.uid(),-fare,'trip_payment',rid,'رزرو کرایه سفر');
  IF old_debt>0 THEN
   INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
   VALUES(auth.uid(),-old_debt,'cancellation_penalty',rid,'پرداخت بدهی جریمه لغو سفر قبلی');
  END IF;
 END IF;
 RETURN rid;
END; $$;
REVOKE ALL ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer,text) TO authenticated;

DROP TRIGGER IF EXISTS trip_cancel_wallet_refund ON public.trips;
DROP TRIGGER IF EXISTS restore_prior_debt_on_wallet_cancel ON public.trips;

-- Passenger cancellation after driver acceptance: 20% penalty, split 90% driver / 10% platform.
-- Cash cancellation creates a debt. Wallet cancellation settles the penalty from the reserved fare.
CREATE OR REPLACE FUNCTION public.process_passenger_cancellation_penalty() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE penalty bigint; platform_share bigint; driver_share bigint;
BEGIN
 IF OLD.status IS DISTINCT FROM 'cancelled' AND NEW.status='cancelled'
 AND OLD.status='accepted' AND NEW.driver_id IS NOT NULL
 AND auth.uid()=NEW.passenger_id THEN
  penalty:=round(NEW.agreed_fare*0.20)::bigint;
  platform_share:=round(penalty*0.10)::bigint;
  driver_share:=penalty-platform_share;
  IF NEW.payment_method='wallet' THEN
   INSERT INTO public.wallet_accounts(user_id) VALUES(NEW.driver_id) ON CONFLICT DO NOTHING;
   INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
   VALUES(NEW.driver_id,driver_share,'cancellation_penalty',NEW.id,'۹۰٪ سهم راننده از جریمه لغو مسافر')
   ON CONFLICT DO NOTHING;
   IF FOUND THEN
    UPDATE public.wallet_accounts SET balance=balance+driver_share,updated_at=now() WHERE user_id=NEW.driver_id;
    UPDATE public.platform_revenue SET balance=balance+platform_share,updated_at=now() WHERE id=true;
   END IF;
   UPDATE public.wallet_accounts SET balance=balance+(NEW.agreed_fare-penalty)+NEW.prior_debt_amount,updated_at=now()
   WHERE user_id=NEW.passenger_id;
   INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
   VALUES(NEW.passenger_id,NEW.agreed_fare-penalty+NEW.prior_debt_amount,'trip_refund',NEW.id,'بازپرداخت پس از کسر جریمه لغو');
  ELSE
   INSERT INTO public.passenger_cancellation_debts(passenger_id,source_trip_id,driver_id,penalty_amount,platform_amount,driver_amount)
   VALUES(NEW.passenger_id,NEW.id,NEW.driver_id,penalty,platform_share,driver_share)
   ON CONFLICT(source_trip_id) DO NOTHING;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.process_passenger_cancellation_penalty() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS passenger_cancellation_penalty ON public.trips;
CREATE TRIGGER passenger_cancellation_penalty AFTER UPDATE OF status ON public.trips
 FOR EACH ROW EXECUTE FUNCTION public.process_passenger_cancellation_penalty();

-- On the next completed trip, cash-collected carry-forward debts are paid to their original drivers.
CREATE OR REPLACE FUNCTION public.settle_passenger_cancellation_debts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d record;
BEGIN
 IF OLD.status IS DISTINCT FROM 'done' AND NEW.status='done' AND NEW.prior_debt_amount>0 THEN
  FOR d IN SELECT * FROM public.passenger_cancellation_debts
   WHERE passenger_id=NEW.passenger_id AND status='open' FOR UPDATE
  LOOP
   INSERT INTO public.wallet_accounts(user_id) VALUES(d.driver_id) ON CONFLICT DO NOTHING;
   INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
   VALUES(d.driver_id,d.driver_amount,'cancellation_penalty',d.source_trip_id,'سهم راننده از جریمه لغو قبلی')
   ON CONFLICT DO NOTHING;
   IF FOUND THEN
    UPDATE public.wallet_accounts SET balance=balance+d.driver_amount,updated_at=now() WHERE user_id=d.driver_id;
    UPDATE public.platform_revenue SET balance=balance+d.platform_amount,updated_at=now() WHERE id=true;
   END IF;
   UPDATE public.passenger_cancellation_debts SET status='settled',settled_by_trip_id=NEW.id,settled_at=now() WHERE id=d.id;
  END LOOP;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.settle_passenger_cancellation_debts() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS settle_passenger_debts_on_trip_done ON public.trips;
CREATE TRIGGER settle_passenger_debts_on_trip_done AFTER UPDATE OF status ON public.trips
 FOR EACH ROW EXECUTE FUNCTION public.settle_passenger_cancellation_debts();

-- Restore outstanding debt to passenger wallet if a wallet-paid next trip is cancelled.
CREATE OR REPLACE FUNCTION public.restore_prior_debt_on_wallet_cancel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF OLD.status IS DISTINCT FROM 'cancelled' AND NEW.status='cancelled'
 AND OLD.status='accepted' AND NEW.payment_method='wallet' AND NEW.prior_debt_amount>0
 AND auth.uid()=NEW.passenger_id THEN
  UPDATE public.wallet_accounts SET balance=balance+NEW.prior_debt_amount,updated_at=now()
  WHERE user_id=NEW.passenger_id;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.restore_prior_debt_on_wallet_cancel() FROM PUBLIC,anon,authenticated;
-- Prior debt is restored by process_passenger_cancellation_penalty in the same refund.
