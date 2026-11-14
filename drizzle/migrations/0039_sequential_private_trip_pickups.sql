-- Sequential private-trip pickup: one extra passenger at a time, never simultaneous.
CREATE TABLE IF NOT EXISTS public.enroute_trip_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  secondary_trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  detour_km numeric(6,2) NOT NULL CHECK (detour_km >= 0 AND detour_km <= 7),
  detour_minutes integer NOT NULL CHECK (detour_minutes > 0 AND detour_minutes <= 600),
  state text NOT NULL DEFAULT 'accepted' CHECK (state IN ('accepted','ongoing','done','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enroute_distinct_trips CHECK (primary_trip_id <> secondary_trip_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS enroute_one_active_secondary
  ON public.enroute_trip_links(secondary_trip_id) WHERE state IN ('accepted','ongoing');
CREATE UNIQUE INDEX IF NOT EXISTS enroute_one_active_per_primary
  ON public.enroute_trip_links(primary_trip_id) WHERE state IN ('accepted','ongoing');
CREATE INDEX IF NOT EXISTS enroute_driver_state_idx
  ON public.enroute_trip_links(driver_id,state,created_at DESC);

ALTER TABLE public.enroute_trip_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Trip parties can view sequential pickup links" ON public.enroute_trip_links;
CREATE POLICY "Trip parties can view sequential pickup links"
ON public.enroute_trip_links FOR SELECT TO authenticated
USING (
  driver_id = (select auth.uid())
  OR EXISTS (SELECT 1 FROM public.trips t WHERE t.id=secondary_trip_id AND t.passenger_id=(select auth.uid()))
  OR EXISTS (SELECT 1 FROM public.trips t WHERE t.id=primary_trip_id AND t.passenger_id=(select auth.uid()))
);
REVOKE ALL ON public.enroute_trip_links FROM anon, authenticated;
GRANT SELECT ON public.enroute_trip_links TO authenticated;

CREATE OR REPLACE FUNCTION public.driver_enroute_candidates(p_primary_trip uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
DECLARE p public.trips; loc public.trip_locations; candidates jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_driver_fully_approved(auth.uid()) THEN
    RAISE EXCEPTION 'فقط راننده تأییدشده می‌تواند درخواست‌های بین‌راهی را ببیند';
  END IF;
  SELECT * INTO p FROM public.trips WHERE id=p_primary_trip AND driver_id=auth.uid() AND status='accepted';
  IF NOT FOUND THEN RAISE EXCEPTION 'ابتدا باید یک سفر اختصاصی پذیرفته‌شده داشته باشید'; END IF;
  SELECT * INTO loc FROM public.trip_locations
   WHERE trip_id=p_primary_trip AND user_id=auth.uid()
   ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND OR loc.updated_at < now()-interval '10 minutes' THEN
    RETURN jsonb_build_object('location',NULL,'active',NULL,'candidates','[]'::jsonb);
  END IF;
  SELECT jsonb_agg(jsonb_build_object(
      'id',t.id,'passengerName',t.passenger_name,'origin',t.origin,'destination',t.destination,
      'originLat',t.origin_lat,'originLng',t.origin_lng,
      'destinationLat',t.destination_lat,'destinationLng',t.destination_lng,
      'departureAt',t.departure_at,'km',t.km,'fare',t.agreed_fare
    ) ORDER BY t.departure_at) INTO candidates
    FROM public.trips t
    WHERE t.status='pending' AND t.passenger_id<>auth.uid()
      AND t.id<>p_primary_trip AND t.departure_at>now()
      AND t.origin_lat IS NOT NULL AND t.origin_lng IS NOT NULL
      AND t.destination_lat IS NOT NULL AND t.destination_lng IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.enroute_trip_links l
        WHERE l.secondary_trip_id=t.id AND l.state IN ('accepted','ongoing'));
  RETURN jsonb_build_object(
    'location',jsonb_build_object('lat',loc.latitude,'lng',loc.longitude,'updatedAt',loc.updated_at),
    'active',(SELECT jsonb_build_object('id',l.id,'secondaryTripId',l.secondary_trip_id,
        'passengerName',t.passenger_name,'origin',t.origin,'destination',t.destination,
        'detourKm',l.detour_km,'detourMinutes',l.detour_minutes,'state',l.state)
      FROM public.enroute_trip_links l JOIN public.trips t ON t.id=l.secondary_trip_id
      WHERE l.primary_trip_id=p_primary_trip AND l.state IN ('accepted','ongoing')
      ORDER BY l.created_at DESC LIMIT 1),
    'candidates',coalesce(candidates,'[]'::jsonb)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.accept_enroute_trip(
  p_primary_trip uuid,p_secondary_trip uuid,p_detour_km numeric,p_detour_minutes integer
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
DECLARE p public.trips; s public.trips; rid uuid; loc public.trip_locations;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_driver_fully_approved(auth.uid()) THEN
    RAISE EXCEPTION 'پذیرش فقط برای راننده تأییدشده مجاز است';
  END IF;
  IF p_detour_km IS NULL OR p_detour_km<0 OR p_detour_km>7
     OR p_detour_minutes IS NULL OR p_detour_minutes<1 OR p_detour_minutes>600 THEN
    RAISE EXCEPTION 'انحراف مسیر باید حداکثر ۷ کیلومتر باشد';
  END IF;
  SELECT * INTO p FROM public.trips WHERE id=p_primary_trip FOR UPDATE;
  IF NOT FOUND OR p.driver_id<>auth.uid() OR p.status<>'accepted' THEN
    RAISE EXCEPTION 'سفر اصلی در وضعیت مجاز برای مسافرگیری بین‌راهی نیست';
  END IF;
  SELECT * INTO s FROM public.trips WHERE id=p_secondary_trip FOR UPDATE;
  IF NOT FOUND OR s.status<>'pending' OR s.passenger_id=auth.uid()
     OR s.departure_at<=now() OR s.origin_lat IS NULL OR s.destination_lat IS NULL THEN
    RAISE EXCEPTION 'درخواست مسافر بین‌راهی دیگر در دسترس نیست';
  END IF;
  SELECT * INTO loc FROM public.trip_locations
   WHERE trip_id=p_primary_trip AND user_id=auth.uid()
   ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND OR loc.updated_at<now()-interval '10 minutes' THEN
    RAISE EXCEPTION 'موقعیت زنده راننده تازه نیست؛ ابتدا موقعیت‌یابی را فعال کنید';
  END IF;
  IF EXISTS (SELECT 1 FROM public.enroute_trip_links
    WHERE primary_trip_id=p_primary_trip AND state IN ('accepted','ongoing')) THEN
    RAISE EXCEPTION 'ابتدا مسافر بین‌راهی فعلی را به مقصد برسانید';
  END IF;
  IF EXISTS (SELECT 1 FROM public.enroute_trip_links
    WHERE secondary_trip_id=p_secondary_trip AND state IN ('accepted','ongoing')) THEN
    RAISE EXCEPTION 'این درخواست قبلاً توسط راننده دیگری رزرو شده است';
  END IF;
  INSERT INTO public.enroute_trip_links(primary_trip_id,secondary_trip_id,driver_id,detour_km,detour_minutes)
  VALUES(p_primary_trip,p_secondary_trip,auth.uid(),p_detour_km,p_detour_minutes)
  RETURNING id INTO rid;
  UPDATE public.trips SET driver_id=auth.uid(),status='accepted',updated_at=now()
   WHERE id=p_secondary_trip;
  RETURN rid;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.driver_enroute_parent(p_secondary_trip uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
  SELECT primary_trip_id FROM public.enroute_trip_links
  WHERE secondary_trip_id=p_secondary_trip AND driver_id=auth.uid()
  ORDER BY created_at DESC LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public.sync_enroute_trip_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.enroute_trip_links
      SET state=CASE NEW.status WHEN 'ongoing' THEN 'ongoing' WHEN 'done' THEN 'done'
        WHEN 'cancelled' THEN 'cancelled' ELSE state END, updated_at=now()
    WHERE secondary_trip_id=NEW.id AND state IN ('accepted','ongoing');
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS sync_enroute_trip_link_after_status ON public.trips;
CREATE TRIGGER sync_enroute_trip_link_after_status
AFTER UPDATE OF status ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.sync_enroute_trip_link();

CREATE OR REPLACE FUNCTION public.change_trip_status(p_trip uuid,p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
DECLARE t public.trips;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ورود لازم است'; END IF;
 IF p_status='accepted' AND NOT public.is_driver_fully_approved(auth.uid()) THEN
  RAISE EXCEPTION 'پذیرش سفر فقط پس از تأیید مدیر و تکمیل هفت مدرک ممکن است';
 END IF;
 SELECT * INTO t FROM public.trips WHERE id=p_trip FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'سفر پیدا نشد'; END IF;
 IF p_status='accepted' THEN
  IF t.passenger_id=auth.uid() THEN RAISE EXCEPTION 'پذیرش درخواست خودتان مجاز نیست'; END IF;
  IF t.status<>'pending' THEN
   RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='این درخواست دیگر در انتظار نیست؛ ممکن است راننده دیگری آن را پذیرفته باشد. فهرست تازه شد.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.enroute_trip_links WHERE secondary_trip_id=p_trip AND state IN ('accepted','ongoing')) THEN
   RAISE EXCEPTION 'این درخواست برای مسافرگیری بین‌راهی رزرو شده است';
  END IF;
  IF t.departure_at<=now() THEN RAISE EXCEPTION 'زمان حرکت این سفر گذشته است'; END IF;
  UPDATE public.trips SET driver_id=auth.uid(),status='accepted',updated_at=now() WHERE id=p_trip;
 ELSIF p_status='ongoing' AND t.driver_id=auth.uid() AND t.status='accepted' THEN
  IF EXISTS (SELECT 1 FROM public.enroute_trip_links WHERE primary_trip_id=p_trip AND state IN ('accepted','ongoing')) THEN
   RAISE EXCEPTION 'ابتدا مسافر بین‌راهی را به مقصد برسانید؛ سپس سفر اصلی را آغاز کنید';
  END IF;
  UPDATE public.trips SET status=p_status,updated_at=now() WHERE id=p_trip;
 ELSIF (p_status='done' AND t.status='ongoing' AND t.driver_id=auth.uid())
    OR (p_status='cancelled' AND ((t.passenger_id=auth.uid() AND t.status IN ('pending','accepted')) OR (t.driver_id=auth.uid() AND t.status IN ('accepted','ongoing')))) THEN
  IF p_status='cancelled' AND EXISTS (SELECT 1 FROM public.enroute_trip_links WHERE primary_trip_id=p_trip AND state IN ('accepted','ongoing')) THEN
   RAISE EXCEPTION 'ابتدا وضعیت مسافر بین‌راهی را مشخص کنید';
  END IF;
  UPDATE public.trips SET status=p_status,updated_at=now() WHERE id=p_trip;
 ELSE
  RAISE EXCEPTION 'تغییر وضعیت این سفر مجاز نیست';
 END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.driver_enroute_candidates(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_enroute_candidates(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.accept_enroute_trip(uuid,uuid,numeric,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_enroute_trip(uuid,uuid,numeric,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.driver_enroute_parent(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_enroute_parent(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.sync_enroute_trip_link() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.change_trip_status(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.change_trip_status(uuid,text) TO authenticated;
