-- Six required driver documents; one insurance policy replaces two old insurance items.
ALTER TABLE public.driver_documents DISABLE TRIGGER driver_documents_reset_verification;
DELETE FROM public.driver_documents cert USING public.driver_documents policy
WHERE cert.user_id=policy.user_id AND cert.kind='insurance_certificate' AND policy.kind='insurance';
UPDATE public.driver_documents SET kind='insurance' WHERE kind='insurance_certificate';
ALTER TABLE public.driver_documents ENABLE TRIGGER driver_documents_reset_verification;

ALTER TABLE public.driver_documents DROP CONSTRAINT IF EXISTS driver_documents_kind_check;
ALTER TABLE public.driver_documents ADD CONSTRAINT driver_documents_kind_check
CHECK (kind IN ('car_card','insurance','license','car_inside','car_outside','selfie'));

CREATE OR REPLACE FUNCTION public.is_driver_fully_approved(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,storage AS $$
 SELECT p_user IS NOT NULL AND public.has_role(p_user,'driver')
 AND EXISTS (
  SELECT 1 FROM public.profiles p JOIN public.driver_verifications v ON v.user_id=p.id
  WHERE p.id=p_user AND p.phone_verified IS TRUE AND v.status='approved'
   AND length(trim(p.first_name))>=2 AND length(trim(p.last_name))>=2
   AND length(trim(p.display_name))>=2 AND p.phone ~ '^09[0-9]{9}$'
   AND public.has_emergency_phone(p_user)
   AND length(trim(p.car))>=2 AND length(trim(p.plate))>=2
   AND (SELECT count(DISTINCT d.kind) FROM public.driver_documents d
    JOIN storage.objects o ON o.bucket_id='driver-documents' AND o.name=d.path
    WHERE d.user_id=p_user
     AND d.kind IN ('car_card','insurance','license','car_inside','car_outside','selfie'))=6
 );
$$;

CREATE OR REPLACE FUNCTION public.admin_review_driver(p_user uuid,p_status text,p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage AS $$
DECLARE doc_count integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'دسترسی مدیر لازم است'; END IF;
 IF p_status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'وضعیت نامعتبر است'; END IF;
 IF p_status='approved' AND NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id=p_user AND p.phone_verified IS TRUE
   AND length(trim(p.first_name))>=2 AND length(trim(p.last_name))>=2
   AND length(trim(p.display_name))>=2 AND p.phone ~ '^09[0-9]{9}$'
   AND public.has_emergency_phone(p_user) AND length(trim(p.car))>=2 AND length(trim(p.plate))>=2
 ) THEN RAISE EXCEPTION 'اطلاعات هویتی، شماره تأییدشده، شماره اضطراری و مشخصات خودرو کامل نیست'; END IF;
 SELECT count(DISTINCT d.kind) INTO doc_count FROM public.driver_documents d
 JOIN storage.objects o ON o.bucket_id='driver-documents' AND o.name=d.path
 WHERE d.user_id=p_user AND d.kind IN ('car_card','insurance','license','car_inside','car_outside','selfie');
 IF p_status='approved' AND doc_count<>6 THEN RAISE EXCEPTION 'هر شش مدرک الزامی باید بارگذاری شده باشند'; END IF;
 INSERT INTO public.driver_verifications(user_id,status,reviewed_by,reviewed_at,note,updated_at)
 VALUES(p_user,p_status,auth.uid(),now(),left(coalesce(p_note,''),500),now())
 ON CONFLICT(user_id) DO UPDATE SET status=EXCLUDED.status,reviewed_by=EXCLUDED.reviewed_by,
 reviewed_at=EXCLUDED.reviewed_at,note=EXCLUDED.note,updated_at=now();
END; $$;

DO $migration$
DECLARE fn regprocedure;
BEGIN
 FOREACH fn IN ARRAY ARRAY[
  'public.change_trip_status(uuid,text)'::regprocedure,
  'public.accept_shared_ride(uuid)'::regprocedure,
  'public.driver_shared_requests()'::regprocedure
 ] LOOP
  EXECUTE replace(pg_get_functiondef(fn),'هفت مدرک','شش مدرک');
 END LOOP;
END; $migration$;
