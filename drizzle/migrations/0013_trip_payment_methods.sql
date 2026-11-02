-- Payment methods and escrow settlement.
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash'
 CHECK(payment_method IN ('cash','wallet'));

ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_kind_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_kind_check
 CHECK(kind IN ('trip_earning','topup','withdrawal','refund','adjustment','commission','trip_payment','trip_refund'));
CREATE UNIQUE INDEX IF NOT EXISTS wallet_trip_payment_once ON public.wallet_transactions(reference_id,kind)
 WHERE kind IN ('trip_payment','trip_refund','trip_earning','commission');

CREATE TABLE IF NOT EXISTS public.platform_revenue (
 id boolean PRIMARY KEY DEFAULT true CHECK(id=true),
 balance bigint NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.platform_revenue(id,balance) VALUES(true,0) ON CONFLICT(id) DO NOTHING;
ALTER TABLE public.platform_revenue ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.platform_revenue TO authenticated;
CREATE POLICY platform_revenue_admin_read ON public.platform_revenue FOR SELECT TO authenticated
 USING(public.has_role(auth.uid(),'admin'));

-- Replace create_trip with a payment-aware version. Wallet fares are reserved atomically.
CREATE OR REPLACE FUNCTION public.create_trip(
 p_origin text,p_destination text,p_departure timestamptz,p_km numeric,p_night boolean,
 p_mountain boolean,p_suggested integer DEFAULT NULL,p_payment_method text DEFAULT 'cash'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid; profile public.profiles; fare integer; calculated integer; bal bigint;
BEGIN
 SELECT * INTO profile FROM public.profiles WHERE id=auth.uid();
 IF auth.uid() IS NULL OR NOT FOUND OR length(trim(profile.display_name))<2 OR profile.phone !~ '^09[0-9]{9}$'
 THEN RAISE EXCEPTION 'ابتدا پروفایل و شماره تماس را کامل کنید'; END IF;
 IF p_origin IS NULL OR p_destination IS NULL OR trim(p_origin)=trim(p_destination) OR p_departure IS NULL
 OR p_km IS NULL OR p_km<=0 OR p_km>3000 OR p_night IS NULL OR p_mountain IS NULL
 OR (p_suggested IS NOT NULL AND p_suggested<80000)
 OR p_payment_method NOT IN ('cash','wallet') THEN RAISE EXCEPTION 'اطلاعات سفر یا روش پرداخت نامعتبر است'; END IF;
 calculated:=public.trip_fare(p_km,p_night,p_mountain); fare:=coalesce(p_suggested,calculated);
 IF p_payment_method='wallet' THEN
  INSERT INTO public.wallet_accounts(user_id) VALUES(auth.uid()) ON CONFLICT DO NOTHING;
  SELECT balance INTO bal FROM public.wallet_accounts WHERE user_id=auth.uid() FOR UPDATE;
  IF bal<fare THEN RAISE EXCEPTION 'موجودی کیف پول برای پرداخت کل کرایه کافی نیست'; END IF;
  UPDATE public.wallet_accounts SET balance=balance-fare,updated_at=now() WHERE user_id=auth.uid();
 END IF;
 INSERT INTO public.trips(passenger_id,passenger_name,origin,destination,departure_at,km,night,mountain,calculated,suggested,agreed_fare,commission,driver_net,payment_method)
 VALUES(auth.uid(),profile.display_name,trim(p_origin),trim(p_destination),p_departure,p_km,p_night,p_mountain,calculated,p_suggested,fare,round(fare*0.1)::integer,fare-round(fare*0.1)::integer,p_payment_method)
 RETURNING id INTO rid;
 IF p_payment_method='wallet' THEN
  INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
  VALUES(auth.uid(),-fare,'trip_payment',rid,'پرداخت کرایه و رزرو مبلغ سفر');
 END IF;
 RETURN rid;
END; $$;
REVOKE ALL ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer,text) TO authenticated;
-- Retire the old overload so clients cannot bypass the payment-method argument.
DROP FUNCTION IF EXISTS public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer);

-- Cash: driver received the fare directly, so only commission is debited.
CREATE OR REPLACE FUNCTION public.process_cash_trip_commission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_balance bigint;
BEGIN
 IF OLD.status IS DISTINCT FROM 'done' AND NEW.status='done' AND NEW.payment_method='cash'
 AND NEW.driver_id IS NOT NULL AND NEW.commission>0 THEN
  INSERT INTO public.wallet_accounts(user_id) VALUES(NEW.driver_id) ON CONFLICT DO NOTHING;
  SELECT balance INTO current_balance FROM public.wallet_accounts WHERE user_id=NEW.driver_id FOR UPDATE;
  IF current_balance-NEW.commission < -100000 THEN
   RAISE EXCEPTION 'سقف بدهی کمیسیون ۱۰۰ هزار تومان است؛ ابتدا کیف پول را تسویه کنید';
  END IF;
  INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
  VALUES(NEW.driver_id,-NEW.commission,'commission',NEW.id,'کمیسیون ۱۰٪ سفر نقدی') ON CONFLICT DO NOTHING;
  IF FOUND THEN UPDATE public.wallet_accounts SET balance=balance-NEW.commission,updated_at=now() WHERE user_id=NEW.driver_id; END IF;
 END IF;
 RETURN NEW;
END; $$;

-- Wallet: passenger paid/escrowed the full fare at request time; settle 90/10 on completion.
CREATE OR REPLACE FUNCTION public.settle_wallet_trip() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF OLD.status IS DISTINCT FROM 'done' AND NEW.status='done' AND NEW.payment_method='wallet' THEN
  INSERT INTO public.wallet_accounts(user_id) VALUES(NEW.driver_id) ON CONFLICT DO NOTHING;
  INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
  VALUES(NEW.driver_id,NEW.driver_net,'trip_earning',NEW.id,'سهم راننده از پرداخت کیف پول') ON CONFLICT DO NOTHING;
  IF FOUND THEN
   UPDATE public.wallet_accounts SET balance=balance+NEW.driver_net,updated_at=now() WHERE user_id=NEW.driver_id;
   UPDATE public.platform_revenue SET balance=balance+NEW.commission,updated_at=now() WHERE id=true;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.settle_wallet_trip() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trip_done_wallet_settlement ON public.trips;
CREATE TRIGGER trip_done_wallet_settlement AFTER UPDATE OF status ON public.trips
 FOR EACH ROW EXECUTE FUNCTION public.settle_wallet_trip();

-- Refund wallet escrow if a wallet-paid trip is cancelled before completion.
CREATE OR REPLACE FUNCTION public.refund_cancelled_wallet_trip() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF OLD.status IS DISTINCT FROM 'cancelled' AND NEW.status='cancelled' AND NEW.payment_method='wallet' THEN
  INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
  VALUES(NEW.passenger_id,NEW.agreed_fare,'trip_refund',NEW.id,'بازپرداخت کرایه سفر لغوشده') ON CONFLICT DO NOTHING;
  IF FOUND THEN
   UPDATE public.wallet_accounts SET balance=balance+NEW.agreed_fare,updated_at=now() WHERE user_id=NEW.passenger_id;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.refund_cancelled_wallet_trip() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trip_cancel_wallet_refund ON public.trips;
CREATE TRIGGER trip_cancel_wallet_refund AFTER UPDATE OF status ON public.trips
 FOR EACH ROW EXECUTE FUNCTION public.refund_cancelled_wallet_trip();

-- Only cash trips consume the driver's commission-debt allowance at acceptance.
CREATE OR REPLACE FUNCTION public.check_driver_commission_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $
DECLARE available_balance bigint; committed_commission bigint;
BEGIN
 IF OLD.status IS DISTINCT FROM 'accepted' AND NEW.status='accepted'
 AND NEW.driver_id IS NOT NULL AND NEW.payment_method='cash' THEN
  INSERT INTO public.wallet_accounts(user_id) VALUES(NEW.driver_id) ON CONFLICT DO NOTHING;
  SELECT balance INTO available_balance FROM public.wallet_accounts WHERE user_id=NEW.driver_id FOR UPDATE;
  SELECT coalesce(sum(commission),0) INTO committed_commission FROM public.trips
   WHERE driver_id=NEW.driver_id AND payment_method='cash' AND status IN ('accepted','ongoing') AND id<>NEW.id;
  IF available_balance-committed_commission-NEW.commission < -100000 THEN
   RAISE EXCEPTION 'با احتساب سفرهای پذیرفته‌شده، بدهی کمیسیون از سقف ۱۰۰ هزار تومان عبور می‌کند';
  END IF;
 END IF;
 RETURN NEW;
END; $;
