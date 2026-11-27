-- All new shared bookings must pass through the route-aware Edge Function.
REVOKE ALL ON FUNCTION public.create_shared_ride(text,text,timestamptz,integer,integer,text,boolean) FROM PUBLIC,anon,authenticated;

-- A passenger may have only one active shared booking at a time.
CREATE OR REPLACE FUNCTION public.prevent_duplicate_active_shared_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.shared_bookings b
    JOIN public.shared_rides r ON r.id=b.ride_id
    WHERE b.user_id=NEW.user_id
      AND r.departure_at>now()
      AND r.state IN ('open','locked','confirmed','ongoing')
  ) THEN
    RAISE EXCEPTION 'شما یک درخواست اشتراکی فعال دارید؛ ابتدا وضعیت همان درخواست را مشخص کنید';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_duplicate_active_shared_booking ON public.shared_bookings;
CREATE TRIGGER prevent_duplicate_active_shared_booking
BEFORE INSERT ON public.shared_bookings
FOR EACH ROW EXECUTE FUNCTION public.prevent_duplicate_active_shared_booking();

REVOKE ALL ON FUNCTION public.prevent_duplicate_active_shared_booking() FROM PUBLIC,anon,authenticated;
