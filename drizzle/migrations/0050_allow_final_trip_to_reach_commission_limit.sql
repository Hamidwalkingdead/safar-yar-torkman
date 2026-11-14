-- Treat the configured commission limit as the point at which new trips pause:
-- allow the final trip while current accrued + already accepted commission is still below the limit.
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
    IF coalesce(v_outstanding,0)+coalesce(v_reserved_trips,0)+coalesce(v_reserved_shared,0)>=coalesce(v_limit,100000) THEN
      RAISE EXCEPTION 'سقف بدهی کمیسیون شما تکمیل شده است؛ ابتدا با کارت‌به‌کارت تسویه و رسید را ثبت کنید';
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
    IF coalesce(v_outstanding,0)+coalesce(v_reserved_trips,0)+coalesce(v_reserved_shared,0)>=coalesce(v_limit,100000) THEN
      RAISE EXCEPTION 'سقف بدهی کمیسیون شما تکمیل شده است؛ ابتدا با کارت‌به‌کارت تسویه و رسید را ثبت کنید';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.check_shared_ride_driver_commission_limit() FROM PUBLIC,anon,authenticated;
