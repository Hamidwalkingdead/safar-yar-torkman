-- Reassert the administrator-approved driver boundary at every driver entry point.
-- Approval is valid only while identity, vehicle details and all seven stored documents remain present.
CREATE OR REPLACE FUNCTION public.is_driver_fully_approved(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
 SELECT p_user IS NOT NULL
  AND public.has_role(p_user,'driver')
  AND EXISTS (
   SELECT 1
   FROM public.profiles p
   JOIN public.driver_verifications v ON v.user_id=p.id
   WHERE p.id=p_user
    AND v.status='approved'
    AND length(trim(p.first_name))>=2
    AND length(trim(p.last_name))>=2
    AND length(trim(p.display_name))>=2
    AND p.phone ~ '^09[0-9]{9}$'
    AND p.emergency_phone ~ '^09[0-9]{9}$'
    AND length(trim(p.car))>=2
    AND length(trim(p.plate))>=2
    AND (
     SELECT count(DISTINCT d.kind)
     FROM public.driver_documents d
     JOIN storage.objects o
       ON o.bucket_id='driver-documents'
      AND o.name=d.path
     WHERE d.user_id=p_user
      AND d.kind IN ('car_card','insurance','insurance_certificate','license','car_inside','car_outside','selfie')
    ) = 7
  );
$$;
REVOKE ALL ON FUNCTION public.is_driver_fully_approved(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.change_trip_status(p_trip uuid,p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
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
  IF t.departure_at<=now() THEN RAISE EXCEPTION 'زمان حرکت این سفر گذشته است'; END IF;
  UPDATE public.trips SET driver_id=auth.uid(),status='accepted',updated_at=now() WHERE id=p_trip;
 ELSIF (p_status='ongoing' AND t.status='accepted' AND t.driver_id=auth.uid())
    OR (p_status='done' AND t.status='ongoing' AND t.driver_id=auth.uid())
    OR (p_status='cancelled' AND ((t.passenger_id=auth.uid() AND t.status IN ('pending','accepted')) OR (t.driver_id=auth.uid() AND t.status IN ('accepted','ongoing')))) THEN
  UPDATE public.trips SET status=p_status,updated_at=now() WHERE id=p_trip;
 ELSE
  RAISE EXCEPTION 'تغییر وضعیت این سفر مجاز نیست';
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.change_trip_status(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_trip_status(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_shared_ride(p_ride uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE r public.shared_rides;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_driver_fully_approved(auth.uid()) THEN
  RAISE EXCEPTION 'پذیرش سفر اشتراکی فقط برای راننده تأییدشده و دارای هفت مدرک مجاز است';
 END IF;
 SELECT * INTO r FROM public.shared_rides WHERE id=p_ride FOR UPDATE;
 IF NOT FOUND OR r.departure_at<=now() OR r.driver_id IS NOT NULL OR r.state NOT IN ('open','locked','confirmed') THEN
  RAISE EXCEPTION 'این درخواست قبلاً پذیرفته شده یا دیگر فعال نیست';
 END IF;
 UPDATE public.shared_rides SET driver_id=auth.uid(),driver_accepted_at=now() WHERE id=p_ride;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_shared_ride(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_shared_ride(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.driver_shared_requests()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_driver_fully_approved(auth.uid()) THEN
  RAISE EXCEPTION 'فقط راننده تأییدشده با هفت مدرک کامل می‌تواند درخواست‌ها را ببیند';
 END IF;
 RETURN coalesce((
  SELECT jsonb_agg(jsonb_build_object(
   'id',r.id,
   'origin',r.origin,
   'destination',r.destination,
   'departureAt',r.departure_at,
   'totalFare',r.total_fare,
   'state',r.state,
   'occupied',coalesce((SELECT sum(b.seats) FROM public.shared_bookings b WHERE b.ride_id=r.id),0),
   'ownerName',p.display_name,
   'driverId',r.driver_id
  ) ORDER BY r.departure_at)
  FROM public.shared_rides r
  JOIN public.profiles p ON p.id=r.owner_id
  WHERE r.departure_at>now()
   AND r.driver_id IS NULL
   AND r.state IN ('open','locked','confirmed')
 ),'[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.driver_shared_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_shared_requests() TO authenticated;
