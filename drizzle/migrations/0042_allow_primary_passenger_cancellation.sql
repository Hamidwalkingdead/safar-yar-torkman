-- Preserve the primary passenger's ordinary right to cancel while a sequential pickup is underway.
CREATE OR REPLACE FUNCTION public.change_trip_status(p_trip uuid,p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE t public.trips;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ورود لازم است'; END IF;
 IF p_status='accepted' AND NOT public.is_driver_fully_approved(auth.uid()) THEN RAISE EXCEPTION 'پذیرش سفر فقط پس از تأیید مدیر و تکمیل هفت مدرک ممکن است'; END IF;
 SELECT * INTO t FROM public.trips WHERE id=p_trip FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'سفر پیدا نشد'; END IF;
 IF p_status='accepted' THEN
  IF t.passenger_id=auth.uid() THEN RAISE EXCEPTION 'پذیرش درخواست خودتان مجاز نیست'; END IF;
  IF t.status<>'pending' THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='این درخواست دیگر در انتظار نیست؛ ممکن است راننده دیگری آن را پذیرفته باشد. فهرست تازه شد.'; END IF;
  IF EXISTS (SELECT 1 FROM public.enroute_trip_links WHERE secondary_trip_id=p_trip AND state IN ('accepted','ongoing')) THEN RAISE EXCEPTION 'این درخواست برای مسافرگیری بین‌راهی رزرو شده است'; END IF;
  IF t.departure_at<=now() THEN RAISE EXCEPTION 'زمان حرکت این سفر گذشته است'; END IF;
  UPDATE public.trips SET driver_id=auth.uid(),status='accepted',updated_at=now() WHERE id=p_trip;
 ELSIF p_status='ongoing' AND t.driver_id=auth.uid() AND t.status='accepted' THEN
  IF EXISTS (SELECT 1 FROM public.enroute_trip_links WHERE primary_trip_id=p_trip AND state IN ('accepted','ongoing')) THEN RAISE EXCEPTION 'ابتدا مسافر بین‌راهی را به مقصد برسانید؛ سپس سفر اصلی را آغاز کنید'; END IF;
  UPDATE public.trips SET status=p_status,updated_at=now() WHERE id=p_trip;
 ELSIF (p_status='done' AND t.status='ongoing' AND t.driver_id=auth.uid())
    OR (p_status='cancelled' AND ((t.passenger_id=auth.uid() AND t.status IN ('pending','accepted')) OR (t.driver_id=auth.uid() AND t.status IN ('accepted','ongoing')))) THEN
  IF p_status='cancelled' AND t.driver_id=auth.uid()
     AND EXISTS (SELECT 1 FROM public.enroute_trip_links WHERE primary_trip_id=p_trip AND state IN ('accepted','ongoing')) THEN
   RAISE EXCEPTION 'راننده ابتدا باید وضعیت مسافر بین‌راهی را مشخص کند';
  END IF;
  UPDATE public.trips SET status=p_status,updated_at=now() WHERE id=p_trip;
 ELSE RAISE EXCEPTION 'تغییر وضعیت این سفر مجاز نیست'; END IF;
END;$fn$;
REVOKE ALL ON FUNCTION public.change_trip_status(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.change_trip_status(uuid,text) TO authenticated;