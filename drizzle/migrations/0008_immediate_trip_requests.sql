-- Standard trips are requests for pickup now, not scheduled departures.
CREATE OR REPLACE FUNCTION public.create_trip(p_origin text,p_destination text,p_departure timestamptz,p_km numeric,p_night boolean,p_mountain boolean,p_suggested integer DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid; profile public.profiles; fare integer; calculated integer;
BEGIN
 SELECT * INTO profile FROM public.profiles WHERE id=auth.uid();
 IF auth.uid() IS NULL OR NOT FOUND OR length(trim(profile.display_name))<2 OR profile.phone !~ '^09[0-9]{9}$' THEN RAISE EXCEPTION 'ابتدا پروفایل و شماره تماس را کامل کنید'; END IF;
 IF p_origin IS NULL OR p_destination IS NULL OR trim(p_origin)=trim(p_destination) OR p_departure IS NULL OR p_km IS NULL OR p_km<=0 OR p_km>3000 OR p_night IS NULL OR p_mountain IS NULL OR (p_suggested IS NOT NULL AND p_suggested<80000) THEN RAISE EXCEPTION 'اطلاعات سفر نامعتبر است'; END IF;
 calculated:=public.trip_fare(p_km,p_night,p_mountain); fare:=coalesce(p_suggested,calculated);
 INSERT INTO public.trips(passenger_id,passenger_name,origin,destination,departure_at,km,night,mountain,calculated,suggested,agreed_fare,commission,driver_net) VALUES(auth.uid(),profile.display_name,trim(p_origin),trim(p_destination),p_departure,p_km,p_night,p_mountain,calculated,p_suggested,fare,round(fare*0.1)::integer,fare-round(fare*0.1)::integer) RETURNING id INTO rid;
 RETURN rid;
END; $$;

CREATE OR REPLACE FUNCTION public.change_trip_status(p_trip uuid,p_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.trips;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ورود لازم است'; END IF;
 IF p_status='accepted' AND (NOT public.has_role(auth.uid(),'driver') OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND length(trim(display_name))>=2 AND phone ~ '^09[0-9]{9}$' AND length(trim(car))>=2 AND length(trim(plate))>=2)) THEN RAISE EXCEPTION 'ابتدا ثبت‌نام و مشخصات راننده را کامل کنید'; END IF;
 SELECT * INTO t FROM public.trips WHERE id=p_trip FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'سفر پیدا نشد'; END IF;
 IF p_status='accepted' THEN
  IF t.passenger_id=auth.uid() THEN RAISE EXCEPTION 'پذیرش درخواست خودتان مجاز نیست'; END IF;
  IF t.status<>'pending' THEN RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='این درخواست دیگر در انتظار نیست؛ ممکن است راننده دیگری آن را پذیرفته باشد. فهرست تازه شد.'; END IF;
  UPDATE public.trips SET driver_id=auth.uid(),status='accepted',updated_at=now() WHERE id=p_trip;
 ELSIF (p_status='ongoing' AND t.status='accepted' AND t.driver_id=auth.uid()) OR (p_status='done' AND t.status='ongoing' AND t.driver_id=auth.uid()) OR (p_status='cancelled' AND ((t.passenger_id=auth.uid() AND t.status IN ('pending','accepted')) OR (t.driver_id=auth.uid() AND t.status IN ('accepted','ongoing')))) THEN
  UPDATE public.trips SET status=p_status,updated_at=now() WHERE id=p_trip;
 ELSE RAISE EXCEPTION 'تغییر وضعیت این سفر مجاز نیست'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.change_trip_status(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_trip_status(uuid,text) TO authenticated;
