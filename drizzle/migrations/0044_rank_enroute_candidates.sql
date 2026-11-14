-- Rank nearby private requests by both pickup proximity and destination proximity to the primary pickup.
CREATE OR REPLACE FUNCTION public.driver_enroute_candidates(p_primary_trip uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE p public.trips; loc public.trip_locations; candidates jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_driver_fully_approved(auth.uid()) THEN RAISE EXCEPTION 'فقط راننده تأییدشده می‌تواند درخواست‌های بین‌راهی را ببیند'; END IF;
 IF EXISTS (SELECT 1 FROM public.enroute_trip_links WHERE secondary_trip_id=p_primary_trip AND driver_id=auth.uid() AND state IN ('accepted','ongoing')) THEN
  RAISE EXCEPTION 'ابتدا مسافر بین‌راهی فعلی را به مقصد برسانید و سپس سفر اصلی را ادامه دهید';
 END IF;
 SELECT * INTO p FROM public.trips WHERE id=p_primary_trip AND driver_id=auth.uid() AND status='accepted';
 IF NOT FOUND THEN RAISE EXCEPTION 'ابتدا باید یک سفر اختصاصی پذیرفته‌شده داشته باشید'; END IF;
 SELECT * INTO loc FROM public.trip_locations WHERE trip_id=p_primary_trip AND user_id=auth.uid() ORDER BY updated_at DESC LIMIT 1;
 IF NOT FOUND OR loc.updated_at<now()-interval '10 minutes' THEN RETURN jsonb_build_object('location',NULL,'active',NULL,'candidates','[]'::jsonb); END IF;
 SELECT jsonb_agg(jsonb_build_object('id',t.id,'passengerName',t.passenger_name,'origin',t.origin,'destination',t.destination,
  'originLat',t.origin_lat,'originLng',t.origin_lng,'destinationLat',t.destination_lat,'destinationLng',t.destination_lng,
  'departureAt',t.departure_at,'km',t.km,'fare',t.agreed_fare)) INTO candidates
 FROM (
  SELECT t.* FROM public.trips t
  WHERE t.status='pending' AND t.passenger_id<>auth.uid() AND t.id<>p_primary_trip AND t.departure_at>now()
   AND t.origin_lat IS NOT NULL AND t.origin_lng IS NOT NULL AND t.destination_lat IS NOT NULL AND t.destination_lng IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.enroute_trip_links l WHERE l.secondary_trip_id=t.id AND l.state IN ('accepted','ongoing'))
  ORDER BY
   ((t.origin_lat-loc.latitude)^2 + ((t.origin_lng-loc.longitude)*0.8)^2)
   + ((t.destination_lat-p.origin_lat)^2 + ((t.destination_lng-p.origin_lng)*0.8)^2)
  LIMIT 50
 ) t;
 RETURN jsonb_build_object('location',jsonb_build_object('lat',loc.latitude,'lng',loc.longitude,'updatedAt',loc.updated_at),
  'active',(SELECT jsonb_build_object('id',l.id,'secondaryTripId',l.secondary_trip_id,'passengerName',t.passenger_name,'origin',t.origin,'destination',t.destination,
   'detourKm',l.detour_km,'detourMinutes',l.detour_minutes,'state',l.state)
   FROM public.enroute_trip_links l JOIN public.trips t ON t.id=l.secondary_trip_id
   WHERE l.primary_trip_id=p_primary_trip AND l.state IN ('accepted','ongoing') ORDER BY l.created_at DESC LIMIT 1),
  'candidates',coalesce(candidates,'[]'::jsonb));
END;$fn$;