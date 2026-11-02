ALTER TABLE public.shared_rides ADD COLUMN IF NOT EXISTS driver_id uuid REFERENCES public.profiles(id);
ALTER TABLE public.shared_rides ADD COLUMN IF NOT EXISTS driver_accepted_at timestamptz;
CREATE INDEX IF NOT EXISTS shared_rides_driver_idx ON public.shared_rides(driver_id);

CREATE OR REPLACE FUNCTION public.driver_shared_requests() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'driver') OR NOT EXISTS (
  SELECT 1 FROM public.profiles WHERE id=auth.uid() AND length(trim(display_name))>=2 AND phone ~ '^09[0-9]{9}$' AND length(trim(car))>=2 AND length(trim(plate))>=2
 ) THEN RAISE EXCEPTION 'ابتدا ثبت‌نام و مشخصات راننده را کامل کنید'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
  'id',r.id,'origin',r.origin,'destination',r.destination,'departureAt',r.departure_at,
  'totalFare',r.total_fare,'state',r.state,'occupied',coalesce((SELECT sum(b.seats) FROM public.shared_bookings b WHERE b.ride_id=r.id),0),
  'ownerName',p.display_name,'driverId',r.driver_id
 ) ORDER BY r.departure_at) FROM public.shared_rides r JOIN public.profiles p ON p.id=r.owner_id
 WHERE r.departure_at>now() AND r.driver_id IS NULL AND r.state IN ('open','locked','confirmed')), '[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.driver_shared_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_shared_requests() TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_shared_ride(p_ride uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.shared_rides;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'driver') OR NOT EXISTS (
  SELECT 1 FROM public.profiles WHERE id=auth.uid() AND length(trim(display_name))>=2 AND phone ~ '^09[0-9]{9}$' AND length(trim(car))>=2 AND length(trim(plate))>=2
 ) THEN RAISE EXCEPTION 'ابتدا ثبت‌نام و مشخصات راننده را کامل کنید'; END IF;
 SELECT * INTO r FROM public.shared_rides WHERE id=p_ride FOR UPDATE;
 IF NOT FOUND OR r.departure_at<=now() OR r.driver_id IS NOT NULL OR r.state NOT IN ('open','locked','confirmed') THEN
  RAISE EXCEPTION 'این درخواست قبلاً پذیرفته شده یا دیگر فعال نیست';
 END IF;
 UPDATE public.shared_rides SET driver_id=auth.uid(),driver_accepted_at=now() WHERE id=p_ride;
END; $$;
REVOKE ALL ON FUNCTION public.accept_shared_ride(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_shared_ride(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.shared_driver_status(p_ride uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.shared_rides r LEFT JOIN public.shared_bookings b ON b.ride_id=r.id
  WHERE r.id=p_ride AND (r.owner_id=auth.uid() OR b.user_id=auth.uid())
 ) THEN RAISE EXCEPTION 'دسترسی مجاز نیست'; END IF;
 SELECT CASE WHEN r.driver_id IS NULL THEN NULL ELSE jsonb_build_object(
  'name',p.display_name,'car',p.car,'plate',p.plate,'acceptedAt',r.driver_accepted_at
 ) END INTO result FROM public.shared_rides r LEFT JOIN public.profiles p ON p.id=r.driver_id WHERE r.id=p_ride;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.shared_driver_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shared_driver_status(uuid) TO authenticated;
