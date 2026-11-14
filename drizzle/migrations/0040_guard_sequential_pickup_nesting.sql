-- A trip already linked as a sequential passenger must not become a new parent trip.
CREATE OR REPLACE FUNCTION public.driver_enroute_candidates(p_primary_trip uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE p public.trips; loc public.trip_locations; candidates jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_driver_fully_approved(auth.uid()) THEN
  RAISE EXCEPTION 'فقط راننده تأییدشده می‌تواند درخواست‌های بین‌راهی را ببیند';
 END IF;
 IF EXISTS (SELECT 1 FROM public.enroute_trip_links WHERE secondary_trip_id=p_primary_trip AND driver_id=auth.uid() AND state IN ('accepted','ongoing')) THEN
  RAISE EXCEPTION 'ابتدا مسافر بین‌راهی فعلی را به مقصد برسانید و سپس سفر اصلی را ادامه دهید';
 END IF;
 SELECT * INTO p FROM public.trips WHERE id=p_primary_trip AND driver_id=auth.uid() AND status='accepted';
 IF NOT FOUND THEN RAISE EXCEPTION 'ابتدا باید یک سفر اختصاصی پذیرفته‌شده داشته باشید'; END IF;
 SELECT * INTO loc FROM public.trip_locations WHERE trip_id=p_primary_trip AND user_id=auth.uid() ORDER BY updated_at DESC LIMIT 1;
 IF NOT FOUND OR loc.updated_at<now()-interval '10 minutes' THEN
  RETURN jsonb_build_object('location',NULL,'active',NULL,'candidates','[]'::jsonb);
 END IF;
 SELECT jsonb_agg(jsonb_build_object('id',t.id,'passengerName',t.passenger_name,'origin',t.origin,'destination',t.destination,
  'originLat',t.origin_lat,'originLng',t.origin_lng,'destinationLat',t.destination_lat,'destinationLng',t.destination_lng,
  'departureAt',t.departure_at,'km',t.km,'fare',t.agreed_fare) ORDER BY t.departure_at) INTO candidates
 FROM public.trips t WHERE t.status='pending' AND t.passenger_id<>auth.uid() AND t.id<>p_primary_trip AND t.departure_at>now()
 AND t.origin_lat IS NOT NULL AND t.origin_lng IS NOT NULL AND t.destination_lat IS NOT NULL AND t.destination_lng IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM public.enroute_trip_links l WHERE l.secondary_trip_id=t.id AND l.state IN ('accepted','ongoing'));
 RETURN jsonb_build_object('location',jsonb_build_object('lat',loc.latitude,'lng',loc.longitude,'updatedAt',loc.updated_at),
 'active',(SELECT jsonb_build_object('id',l.id,'secondaryTripId',l.secondary_trip_id,'passengerName',t.passenger_name,'origin',t.origin,'destination',t.destination,
 'detourKm',l.detour_km,'detourMinutes',l.detour_minutes,'state',l.state) FROM public.enroute_trip_links l JOIN public.trips t ON t.id=l.secondary_trip_id
 WHERE l.primary_trip_id=p_primary_trip AND l.state IN ('accepted','ongoing') ORDER BY l.created_at DESC LIMIT 1),
 'candidates',coalesce(candidates,'[]'::jsonb));
END;$fn$;

CREATE OR REPLACE FUNCTION public.accept_enroute_trip(p_primary_trip uuid,p_secondary_trip uuid,p_detour_km numeric,p_detour_minutes integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE p public.trips; s public.trips; rid uuid; loc public.trip_locations;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_driver_fully_approved(auth.uid()) THEN RAISE EXCEPTION 'پذیرش فقط برای راننده تأییدشده مجاز است'; END IF;
 IF p_detour_km IS NULL OR p_detour_km<0 OR p_detour_km>7 OR p_detour_minutes IS NULL OR p_detour_minutes<1 OR p_detour_minutes>600 THEN
  RAISE EXCEPTION 'انحراف مسیر باید حداکثر ۷ کیلومتر باشد';
 END IF;
 SELECT * INTO p FROM public.trips WHERE id=p_primary_trip FOR UPDATE;
 IF NOT FOUND OR p.driver_id<>auth.uid() OR p.status<>'accepted' THEN RAISE EXCEPTION 'سفر اصلی در وضعیت مجاز برای مسافرگیری بین‌راهی نیست'; END IF;
 IF EXISTS (SELECT 1 FROM public.enroute_trip_links WHERE secondary_trip_id=p_primary_trip AND driver_id=auth.uid() AND state IN ('accepted','ongoing')) THEN
  RAISE EXCEPTION 'این سفر خودش مسافر بین‌راهی است و نمی‌تواند سفر اصلی جدیدی باشد';
 END IF;
 SELECT * INTO s FROM public.trips WHERE id=p_secondary_trip FOR UPDATE;
 IF NOT FOUND OR s.status<>'pending' OR s.passenger_id=auth.uid() OR s.departure_at<=now()
  OR s.origin_lat IS NULL OR s.origin_lng IS NULL OR s.destination_lat IS NULL OR s.destination_lng IS NULL THEN
  RAISE EXCEPTION 'درخواست مسافر بین‌راهی دیگر در دسترس نیست';
 END IF;
 SELECT * INTO loc FROM public.trip_locations WHERE trip_id=p_primary_trip AND user_id=auth.uid() ORDER BY updated_at DESC LIMIT 1;
 IF NOT FOUND OR loc.updated_at<now()-interval '10 minutes' THEN RAISE EXCEPTION 'موقعیت زنده راننده تازه نیست؛ ابتدا موقعیت‌یابی را فعال کنید'; END IF;
 IF EXISTS (SELECT 1 FROM public.enroute_trip_links WHERE primary_trip_id=p_primary_trip AND state IN ('accepted','ongoing')) THEN
  RAISE EXCEPTION 'ابتدا مسافر بین‌راهی فعلی را به مقصد برسانید';
 END IF;
 IF EXISTS (SELECT 1 FROM public.enroute_trip_links WHERE secondary_trip_id=p_secondary_trip AND state IN ('accepted','ongoing')) THEN
  RAISE EXCEPTION 'این درخواست قبلاً توسط راننده دیگری رزرو شده است';
 END IF;
 INSERT INTO public.enroute_trip_links(primary_trip_id,secondary_trip_id,driver_id,detour_km,detour_minutes)
 VALUES(p_primary_trip,p_secondary_trip,auth.uid(),p_detour_km,p_detour_minutes) RETURNING id INTO rid;
 UPDATE public.trips SET driver_id=auth.uid(),status='accepted',updated_at=now() WHERE id=p_secondary_trip;
 RETURN rid;
END;$fn$;