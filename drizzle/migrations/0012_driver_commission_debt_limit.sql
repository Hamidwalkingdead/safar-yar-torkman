-- Driver commission wallet: cash fares are paid directly to the driver.
-- The platform only deducts its 10% commission; the driver may owe up to 100,000 toman.
ALTER TABLE public.wallet_accounts DROP CONSTRAINT IF EXISTS wallet_accounts_balance_check;
ALTER TABLE public.wallet_accounts ADD CONSTRAINT wallet_balance_floor CHECK (balance >= -100000);

ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_kind_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_kind_check
 CHECK (kind IN ('trip_earning','topup','withdrawal','refund','adjustment','commission'));
CREATE UNIQUE INDEX IF NOT EXISTS wallet_trip_commission_once
 ON public.wallet_transactions(reference_id,kind) WHERE kind='commission';

CREATE OR REPLACE FUNCTION public.process_cash_trip_commission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_balance bigint;
BEGIN
 IF OLD.status IS DISTINCT FROM 'done' AND NEW.status='done'
    AND NEW.driver_id IS NOT NULL AND NEW.commission>0 THEN
  INSERT INTO public.wallet_accounts(user_id) VALUES(NEW.driver_id) ON CONFLICT DO NOTHING;
  SELECT balance INTO current_balance FROM public.wallet_accounts WHERE user_id=NEW.driver_id FOR UPDATE;
  IF current_balance-NEW.commission < -100000 THEN
   RAISE EXCEPTION 'سقف بدهی کمیسیون ۱۰۰ هزار تومان است؛ ابتدا کیف پول را تسویه کنید';
  END IF;
  INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
  VALUES(NEW.driver_id,-NEW.commission,'commission',NEW.id,'کمیسیون ۱۰٪ سفر نقدی')
  ON CONFLICT DO NOTHING;
  IF FOUND THEN
   UPDATE public.wallet_accounts SET balance=balance-NEW.commission,updated_at=now()
   WHERE user_id=NEW.driver_id;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.process_cash_trip_commission() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trip_done_wallet_credit ON public.trips;
DROP TRIGGER IF EXISTS trip_done_cash_commission ON public.trips;
CREATE TRIGGER trip_done_cash_commission AFTER UPDATE OF status ON public.trips
 FOR EACH ROW EXECUTE FUNCTION public.process_cash_trip_commission();

-- Do not let a driver accept a trip if its commission would exceed the debt limit.
CREATE OR REPLACE FUNCTION public.check_driver_commission_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE available_balance bigint;
BEGIN
 IF OLD.status IS DISTINCT FROM 'accepted' AND NEW.status='accepted' AND NEW.driver_id IS NOT NULL THEN
  INSERT INTO public.wallet_accounts(user_id) VALUES(NEW.driver_id) ON CONFLICT DO NOTHING;
  SELECT balance INTO available_balance FROM public.wallet_accounts WHERE user_id=NEW.driver_id FOR UPDATE;
  IF available_balance-NEW.commission < -100000 THEN
   RAISE EXCEPTION 'با پذیرش این سفر بدهی کمیسیون از ۱۰۰ هزار تومان بیشتر می‌شود؛ ابتدا کیف پول را تسویه کنید';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.check_driver_commission_limit() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trips_driver_commission_limit ON public.trips;
CREATE TRIGGER trips_driver_commission_limit BEFORE UPDATE OF status ON public.trips
 FOR EACH ROW EXECUTE FUNCTION public.check_driver_commission_limit();
