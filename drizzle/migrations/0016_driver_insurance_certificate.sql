ALTER TABLE public.driver_documents DROP CONSTRAINT IF EXISTS driver_documents_kind_check;
ALTER TABLE public.driver_documents ADD CONSTRAINT driver_documents_kind_check
 CHECK (kind IN ('car_card','insurance','insurance_certificate','license','car_inside','car_outside','selfie'));

CREATE OR REPLACE FUNCTION public.register_driver() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.profiles WHERE id=auth.uid()
   AND length(trim(display_name))>=2 AND phone ~ '^09[0-9]{9}$'
   AND length(trim(car))>=2 AND length(trim(plate))>=2
 ) THEN RAISE EXCEPTION 'ابتدا نام، شماره تماس و مشخصات خودرو را کامل کنید'; END IF;
 IF (SELECT count(*) FROM public.driver_documents d JOIN storage.objects o
     ON o.bucket_id='driver-documents' AND o.name=d.path WHERE d.user_id=auth.uid()) < 7
 THEN RAISE EXCEPTION 'بارگذاری هر هفت مدرک و عکس الزامی است'; END IF;
 INSERT INTO public.user_roles(user_id,role) VALUES(auth.uid(),'driver') ON CONFLICT DO NOTHING;
 INSERT INTO public.driver_verifications(user_id,status,note,updated_at)
 VALUES(auth.uid(),'pending','مدارک برای بررسی مدیر ارسال شد',now())
 ON CONFLICT(user_id) DO UPDATE SET status='pending',reviewed_by=NULL,reviewed_at=NULL,
 note='مدارک برای بررسی مدیر ارسال شد',updated_at=now();
END; $$;
REVOKE ALL ON FUNCTION public.register_driver() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_driver() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_driver(p_user uuid,p_status text,p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE doc_count integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'دسترسی مدیر لازم است'; END IF;
 IF p_status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'وضعیت نامعتبر است'; END IF;
 SELECT count(DISTINCT kind) INTO doc_count FROM public.driver_documents
 WHERE user_id=p_user AND kind IN ('car_card','insurance','insurance_certificate','license','car_inside','car_outside','selfie');
 IF p_status='approved' AND doc_count<>7 THEN RAISE EXCEPTION 'همه هفت مدرک الزامی باید بارگذاری شده باشند'; END IF;
 INSERT INTO public.driver_verifications(user_id,status,reviewed_by,reviewed_at,note,updated_at)
 VALUES(p_user,p_status,auth.uid(),now(),left(coalesce(p_note,''),500),now())
 ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,reviewed_by=excluded.reviewed_by,
 reviewed_at=excluded.reviewed_at,note=excluded.note,updated_at=now();
END; $$;
REVOKE ALL ON FUNCTION public.admin_review_driver(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_review_driver(uuid,text,text) TO authenticated;
