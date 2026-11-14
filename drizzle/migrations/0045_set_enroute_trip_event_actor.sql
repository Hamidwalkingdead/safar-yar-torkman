-- Route detour is verified server-side; clients cannot forge a 7 km allowance.
CREATE OR REPLACE FUNCTION public.accept_enroute_trip_verified(
 p_driver_id uuid,p_primary_trip uuid,p_secondary_trip uuid,p_detour_km numeric,p_detour_minutes integer
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
DECLARE p public.trips; s public.trips; loc public.trip_locations; rid uuid;
BEGIN
 IF p_driver_id IS NULL OR NOT public.is_driver_fully_approved(p_driver_id) THEN
  RAISE EXCEPTION 'پذیرش فقط برای راننده تأییدشده مجاز است';
 END IF;
 IF p_detour_km IS NULL OR p_detour_km<0 OR p_detour_km>7
   OR p_detour_minutes IS NULL OR p_detour_minutes<1 OR p_detour_minutes>600 THEN
  RAISE EXCEPTION 'انحراف مسیر باید حداکثر ۷ کیلومتر باشد';
 END IF;
 SELECT * INTO p FROM public.trips WHERE id=p_primary_trip FOR UPDATE;
 IF NOT FOUND OR p.driver_id<>p_driver_id OR p.status<>'accepted' THEN
  RAISE EXCEPTION 'سفر اصلی در وضعیت مجاز برای مسافرگیری بین‌راهی نیست';
 END IF;
 IF EXISTS (SELECT 1 FROM public.enroute_trip_links WHERE secondary_trip_id=p_primary_trip AND driver_id=p_driver_id AND state IN ('accepted','ongoing')) THEN
  RAISE EXCEPTION 'این سفر خودش مسافر بین‌راهی است و نمی‌تواند سفر اصلی جدیدی باشد';
 END IF;
 SELECT * INTO s FROM public.trips WHERE id=p_secondary_trip FOR UPDATE;
 IF NOT FOUND OR s.status<>'pending' OR s.passenger_id=p_driver_id OR s.departure_at<=now()
  OR s.origin_lat IS NULL OR s.origin_lng IS NULL OR s.destination_lat IS NULL OR s.destination_lng IS NULL THEN
  RAISE EXCEPTION 'درخواست مسافر بین‌راهی دیگر در دسترس نیست';
 END IF;
 SELECT * INTO loc FROM public.trip_locations WHERE trip_id=p_primary_trip AND user_id=p_driver_id ORDER BY updated_at DESC LIMIT 1;
 IF NOT FOUND OR loc.updated_at<now()-interval '10 minutes' THEN
  RAISE EXCEPTION 'موقعیت زنده راننده تازه نیست؛ ابتدا موقعیت‌یابی را فعال کنید';
 END IF;
 IF EXISTS (SELECT 1 FROM public.enroute_trip_links WHERE primary_trip_id=p_primary_trip AND state IN ('accepted','ongoing')) THEN
  RAISE EXCEPTION 'ابتدا مسافر بین‌راهی فعلی را به مقصد برسانید';
 END IF;
 IF EXISTS (SELECT 1 FROM public.enroute_trip_links WHERE secondary_trip_id=p_secondary_trip AND state IN ('accepted','ongoing')) THEN
  RAISE EXCEPTION 'این درخواست قبلاً توسط راننده دیگری رزرو شده است';
 END IF;
 -- The RPC runs with the service-role JWT. Attribute the trip event to the
 -- verified driver so record_trip_event() never receives a NULL auth.uid().
 PERFORM set_config('request.jwt.claim.sub',p_driver_id::text,true);
 INSERT INTO public.enroute_trip_links(primary_trip_id,secondary_trip_id,driver_id,detour_km,detour_minutes)
 VALUES(p_primary_trip,p_secondary_trip,p_driver_id,p_detour_km,p_detour_minutes) RETURNING id INTO rid;
 UPDATE public.trips SET driver_id=p_driver_id,status='accepted',updated_at=now() WHERE id=p_secondary_trip;
 RETURN rid;
END;
$fn$;
REVOKE ALL ON FUNCTION public.accept_enroute_trip(uuid,uuid,numeric,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.accept_enroute_trip_verified(uuid,uuid,uuid,numeric,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accept_enroute_trip_verified(uuid,uuid,uuid,numeric,integer) TO service_role;
