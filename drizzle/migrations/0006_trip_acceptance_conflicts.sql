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
  IF t.departure_at<=now() THEN RAISE EXCEPTION 'زمان حرکت این سفر گذشته است'; END IF;
  UPDATE public.trips SET driver_id=auth.uid(),status='accepted',updated_at=now() WHERE id=p_trip;
 ELSIF (p_status='ongoing' AND t.status='accepted' AND t.driver_id=auth.uid()) OR (p_status='done' AND t.status='ongoing' AND t.driver_id=auth.uid()) OR (p_status='cancelled' AND ((t.passenger_id=auth.uid() AND t.status IN ('pending','accepted')) OR (t.driver_id=auth.uid() AND t.status IN ('accepted','ongoing')))) THEN
  UPDATE public.trips SET status=p_status,updated_at=now() WHERE id=p_trip;
 ELSE RAISE EXCEPTION 'تغییر وضعیت این سفر مجاز نیست'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.change_trip_status(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_trip_status(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.trip_contacts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_contacts(uuid) TO authenticated;