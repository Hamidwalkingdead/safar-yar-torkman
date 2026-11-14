-- Include shared rides in the same driver commission cap and manual settlement ledger.

ALTER TABLE public.driver_commission_transactions
  ADD COLUMN IF NOT EXISTS shared_ride_id uuid REFERENCES public.shared_rides(id);

ALTER TABLE public.driver_commission_transactions
  DROP CONSTRAINT IF EXISTS driver_commission_transactions_check;
ALTER TABLE public.driver_commission_transactions
  DROP CONSTRAINT IF EXISTS driver_commission_transactions_kind_check;
ALTER TABLE public.driver_commission_transactions
  ADD CONSTRAINT driver_commission_transactions_kind_check
  CHECK (kind IN ('trip_commission','shared_ride_commission','settlement'));
ALTER TABLE public.driver_commission_transactions
  ADD CONSTRAINT driver_commission_transactions_reference_check
  CHECK (
    (kind='trip_commission' AND amount>0 AND trip_id IS NOT NULL AND shared_ride_id IS NULL AND settlement_id IS NULL)
    OR
    (kind='shared_ride_commission' AND amount>0 AND trip_id IS NULL AND shared_ride_id IS NOT NULL AND settlement_id IS NULL)
    OR
    (kind='settlement' AND amount<0 AND trip_id IS NULL AND shared_ride_id IS NULL AND settlement_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS driver_commission_shared_ride_once
  ON public.driver_commission_transactions(shared_ride_id)
  WHERE kind='shared_ride_commission';

CREATE OR REPLACE FUNCTION public.get_driver_commission_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
DECLARE v_limit bigint; v_outstanding bigint; v_reserved bigint; v_pending bigint;
        v_card text; v_holder text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'driver') THEN
    RAISE EXCEPTION 'حساب راننده لازم است';
  END IF;
  SELECT driver_debt_limit,settlement_card_number,settlement_card_holder
    INTO v_limit,v_card,v_holder
  FROM public.platform_commission_settings WHERE id=true;
  SELECT coalesce(outstanding,0) INTO v_outstanding
    FROM public.driver_commission_accounts WHERE driver_id=auth.uid();
  v_outstanding:=coalesce(v_outstanding,0);
  SELECT (
    coalesce((SELECT sum(commission) FROM public.trips
      WHERE driver_id=auth.uid() AND payment_method='cash' AND status IN ('accepted','ongoing')),0)
    +
    coalesce((SELECT sum(round(total_fare*0.10)::bigint) FROM public.shared_rides
      WHERE driver_id=auth.uid() AND state IN ('open','locked','confirmed','ongoing')),0)
  )::bigint INTO v_reserved;
  SELECT coalesce(sum(amount),0)::bigint INTO v_pending
    FROM public.driver_commission_settlements
    WHERE driver_id=auth.uid() AND status='pending';
  RETURN jsonb_build_object(
    'limit',coalesce(v_limit,100000),
    'outstanding',v_outstanding,
    'reserved',coalesce(v_reserved,0),
    'pendingSettlement',coalesce(v_pending,0),
    'available',greatest(coalesce(v_limit,100000)-v_outstanding-coalesce(v_reserved,0),0),
    'settlementCardNumber',coalesce(v_card,''),
    'settlementCardHolder',coalesce(v_holder,'')
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_driver_commission_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_driver_commission_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.check_driver_commission_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
DECLARE v_limit bigint; v_outstanding bigint; v_reserved_trips bigint; v_reserved_shared bigint;
BEGIN
  IF OLD.status IS DISTINCT FROM 'accepted' AND NEW.status='accepted'
     AND NEW.driver_id IS NOT NULL AND NEW.payment_method='cash' THEN
    INSERT INTO public.driver_commission_accounts(driver_id) VALUES(NEW.driver_id) ON CONFLICT DO NOTHING;
    SELECT outstanding INTO v_outstanding
      FROM public.driver_commission_accounts WHERE driver_id=NEW.driver_id FOR UPDATE;
    SELECT driver_debt_limit INTO v_limit
      FROM public.platform_commission_settings WHERE id=true;
    SELECT coalesce(sum(commission),0)::bigint INTO v_reserved_trips
      FROM public.trips
      WHERE driver_id=NEW.driver_id AND payment_method='cash'
        AND status IN ('accepted','ongoing') AND id<>NEW.id;
    SELECT coalesce(sum(round(total_fare*0.10)::bigint),0)::bigint INTO v_reserved_shared
      FROM public.shared_rides
      WHERE driver_id=NEW.driver_id AND state IN ('open','locked','confirmed','ongoing');
    IF coalesce(v_outstanding,0)+coalesce(v_reserved_trips,0)+coalesce(v_reserved_shared,0)+NEW.commission>coalesce(v_limit,100000) THEN
      RAISE EXCEPTION 'سقف بدهی کمیسیون شما پر می‌شود؛ ابتدا با کارت‌به‌کارت تسویه و رسید را ثبت کنید';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.check_driver_commission_limit() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.check_shared_ride_driver_commission_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
DECLARE v_limit bigint; v_outstanding bigint; v_reserved_trips bigint; v_reserved_shared bigint;
        v_new_commission bigint;
BEGIN
  IF OLD.driver_id IS NULL AND NEW.driver_id IS NOT NULL THEN
    INSERT INTO public.driver_commission_accounts(driver_id) VALUES(NEW.driver_id) ON CONFLICT DO NOTHING;
    SELECT outstanding INTO v_outstanding
      FROM public.driver_commission_accounts WHERE driver_id=NEW.driver_id FOR UPDATE;
    SELECT driver_debt_limit INTO v_limit
      FROM public.platform_commission_settings WHERE id=true;
    SELECT coalesce(sum(commission),0)::bigint INTO v_reserved_trips
      FROM public.trips
      WHERE driver_id=NEW.driver_id AND payment_method='cash' AND status IN ('accepted','ongoing');
    SELECT coalesce(sum(round(total_fare*0.10)::bigint),0)::bigint INTO v_reserved_shared
      FROM public.shared_rides
      WHERE driver_id=NEW.driver_id AND state IN ('open','locked','confirmed','ongoing') AND id<>NEW.id;
    v_new_commission:=round(NEW.total_fare*0.10)::bigint;
    IF coalesce(v_outstanding,0)+coalesce(v_reserved_trips,0)+coalesce(v_reserved_shared,0)+v_new_commission>coalesce(v_limit,100000) THEN
      RAISE EXCEPTION 'سقف بدهی کمیسیون شما پر می‌شود؛ ابتدا با کارت‌به‌کارت تسویه و رسید را ثبت کنید';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.check_shared_ride_driver_commission_limit() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS shared_ride_driver_commission_limit ON public.shared_rides;
CREATE TRIGGER shared_ride_driver_commission_limit
  BEFORE UPDATE OF driver_id ON public.shared_rides
  FOR EACH ROW EXECUTE FUNCTION public.check_shared_ride_driver_commission_limit();

CREATE OR REPLACE FUNCTION public.record_driver_commission_on_shared_ride_done()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
DECLARE v_commission bigint;
BEGIN
  IF OLD.state IS DISTINCT FROM 'done' AND NEW.state='done'
     AND NEW.driver_id IS NOT NULL AND NEW.total_fare>0 THEN
    v_commission:=round(NEW.total_fare*0.10)::bigint;
    INSERT INTO public.driver_commission_accounts(driver_id) VALUES(NEW.driver_id) ON CONFLICT DO NOTHING;
    INSERT INTO public.driver_commission_transactions(driver_id,amount,kind,shared_ride_id,description)
      VALUES(NEW.driver_id,v_commission,'shared_ride_commission',NEW.id,'کمیسیون ۱۰٪ سفر اشتراکی')
      ON CONFLICT DO NOTHING;
    IF FOUND THEN
      UPDATE public.driver_commission_accounts
      SET outstanding=outstanding+v_commission,updated_at=now()
      WHERE driver_id=NEW.driver_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_driver_commission_on_shared_ride_done() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS shared_ride_done_record_driver_commission ON public.shared_rides;
CREATE TRIGGER shared_ride_done_record_driver_commission
  AFTER UPDATE OF state ON public.shared_rides
  FOR EACH ROW EXECUTE FUNCTION public.record_driver_commission_on_shared_ride_done();
