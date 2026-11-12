-- Replace the public shared-ride catalogue with private request matching.
CREATE OR REPLACE FUNCTION public.normalize_shared_place(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
 SELECT btrim(regexp_replace(
  replace(replace(replace(replace(coalesce(p_value,''),'ي','ی'),'ك','ک'),chr(8204),' '),chr(8207),' '),
  '[[:space:]،,؛]+',' ','g'
 ));
$$;
REVOKE ALL ON FUNCTION public.normalize_shared_place(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_shared_ride(
 p_origin text,
 p_destination text,
 p_departure timestamptz,
 p_fare integer,
 p_seats integer,
 p_type text,
 p_consent boolean
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
 rid uuid;
 occupied integer;
 normalized_origin text;
 normalized_destination text;
 route_day date;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ورود لازم است'; END IF;
 normalized_origin := public.normalize_shared_place(p_origin);
 normalized_destination := public.normalize_shared_place(p_destination);
 IF p_consent IS DISTINCT FROM true
 OR p_type IS DISTINCT FROM 'intercity'
 OR p_seats IS NULL OR p_seats NOT BETWEEN 1 AND 3
 OR p_fare IS NULL OR p_fare NOT BETWEEN 80000 AND 2147483647
 OR p_departure IS NULL OR p_departure <= now()
 OR length(trim(coalesce(p_origin,''))) NOT BETWEEN 2 AND 160
 OR length(trim(coalesce(p_destination,''))) NOT BETWEEN 2 AND 160
 OR length(normalized_origin) < 2
 OR length(normalized_destination) < 2
 OR normalized_origin = normalized_destination THEN
  RAISE EXCEPTION 'اطلاعات سفر اشتراکی معتبر نیست';
 END IF;
 route_day := (p_departure AT TIME ZONE 'Asia/Tehran')::date;

 -- Serialize requests for the same normalized route and Tehran-local day.
 PERFORM pg_advisory_xact_lock(hashtextextended(
  normalized_origin || '|' || normalized_destination || '|' || route_day::text, 0
 ));

 -- Repeated taps by the same passenger return their existing matching request.
 SELECT r.id INTO rid
 FROM public.shared_rides r
 JOIN public.shared_bookings b ON b.ride_id=r.id
 WHERE b.user_id=auth.uid()
   AND public.normalize_shared_place(r.origin)=normalized_origin
   AND public.normalize_shared_place(r.destination)=normalized_destination
   AND r.departure_at>now()
   AND r.state IN ('open','locked','confirmed')
   AND (r.departure_at AT TIME ZONE 'Asia/Tehran')::date=route_day
   AND abs(extract(epoch FROM (r.departure_at-p_departure))) <= 3600
 ORDER BY abs(extract(epoch FROM (r.departure_at-p_departure))),r.created_at
 LIMIT 1
 FOR UPDATE OF r;
 IF rid IS NOT NULL THEN RETURN rid; END IF;

 -- Automatically join the nearest open same-route request with spare capacity
 -- and a similar total fare. No public ride catalogue or manual join is needed.
 SELECT r.id,
  (SELECT coalesce(sum(b.seats),0)::int FROM public.shared_bookings b WHERE b.ride_id=r.id)
 INTO rid,occupied
 FROM public.shared_rides r
 WHERE r.state='open'
   AND r.departure_at>now()
   AND public.normalize_shared_place(r.origin)=normalized_origin
   AND public.normalize_shared_place(r.destination)=normalized_destination
   AND (r.departure_at AT TIME ZONE 'Asia/Tehran')::date=route_day
   AND abs(extract(epoch FROM (r.departure_at-p_departure))) <= 3600
   AND abs(r.total_fare::bigint-p_fare::bigint) <= greatest(5000::bigint,(p_fare::bigint*10)/100)
   AND NOT EXISTS (
    SELECT 1 FROM public.shared_bookings b
    WHERE b.ride_id=r.id AND b.user_id=auth.uid()
   )
   AND (SELECT coalesce(sum(b.seats),0)::int FROM public.shared_bookings b WHERE b.ride_id=r.id)+p_seats <= 3
 ORDER BY abs(extract(epoch FROM (r.departure_at-p_departure))),r.created_at
 LIMIT 1
 FOR UPDATE OF r SKIP LOCKED;

 IF rid IS NOT NULL THEN
  INSERT INTO public.shared_bookings(ride_id,user_id,seats)
  VALUES(rid,auth.uid(),p_seats);
  occupied := occupied+p_seats;
  IF occupied=3 THEN
   UPDATE public.shared_rides SET state='locked' WHERE id=rid;
  END IF;
  RETURN rid;
 END IF;

 INSERT INTO public.shared_rides(owner_id,origin,destination,departure_at,total_fare,state)
 VALUES(auth.uid(),trim(p_origin),trim(p_destination),p_departure,p_fare,
        CASE WHEN p_seats=3 THEN 'locked' ELSE 'open' END)
 RETURNING id INTO rid;
 INSERT INTO public.shared_bookings(ride_id,user_id,seats)
 VALUES(rid,auth.uid(),p_seats);
 RETURN rid;
END;
$$;
REVOKE ALL ON FUNCTION public.create_shared_ride(text,text,timestamptz,integer,integer,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_shared_ride(text,text,timestamptz,integer,integer,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.shared_listing()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=public
AS $$
 SELECT coalesce(jsonb_agg(item ORDER BY depart),'[]'::jsonb)
 FROM (
  SELECT r.departure_at depart,
   jsonb_build_object(
    'id',r.id,
    'origin',r.origin,
    'destination',r.destination,
    'departureAt',r.departure_at,
    'totalFare',r.total_fare,
    'state',r.state,
    'occupied',coalesce((SELECT sum(seats) FROM public.shared_bookings b WHERE b.ride_id=r.id),0),
    'isOwner',coalesce(r.owner_id=auth.uid(),false),
    'allConfirmed',NOT EXISTS(SELECT 1 FROM public.shared_bookings b WHERE b.ride_id=r.id AND NOT b.final_confirmed),
    'myBooking',(
      SELECT jsonb_build_object(
       'seats',b.seats,
       'confirmed',b.final_confirmed,
       'amount',(r.total_fare/n.cnt)*b.seats + greatest(0,least(
         b.seats,r.total_fare%n.cnt-coalesce((
          SELECT sum(p.seats) FROM public.shared_bookings p
          WHERE p.ride_id=r.id AND (p.created_at,p.id)<(b.created_at,b.id)
         ),0
       )))
      )
      FROM public.shared_bookings b
      CROSS JOIN LATERAL (SELECT sum(seats)::int cnt FROM public.shared_bookings WHERE ride_id=r.id) n
      WHERE b.ride_id=r.id AND b.user_id=auth.uid()
    ),
    'driverId',r.driver_id
   ) item
  FROM public.shared_rides r
  WHERE auth.uid() IS NOT NULL
    AND EXISTS(SELECT 1 FROM public.shared_bookings b WHERE b.ride_id=r.id AND b.user_id=auth.uid())
 ) s;
$$;
REVOKE ALL ON FUNCTION public.shared_listing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shared_listing() TO authenticated;

-- The UI no longer exposes manual public joining; requests are matched at creation.
REVOKE ALL ON FUNCTION public.join_shared_ride(uuid,integer,integer,boolean) FROM PUBLIC, anon, authenticated;
