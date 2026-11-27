-- Registration, approval and trip acceptance all require the same six uploaded document kinds.
CREATE OR REPLACE FUNCTION public.register_driver()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,storage
AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.phone_verified IS TRUE
   AND length(trim(p.first_name))>=2 AND length(trim(p.last_name))>=2
   AND length(trim(p.display_name))>=2 AND p.phone ~ '^09[0-9]{9}$'
   AND length(trim(p.car))>=2 AND length(trim(p.plate))>=2
 ) OR NOT public.has_emergency_phone(auth.uid()) THEN
  RAISE EXCEPTION 'نام، نام خانوادگی، نام نمایشی، شماره تأییدشده، شماره اضطراری و مشخصات خودرو را کامل کنید';
 END IF;
 IF (SELECT count(DISTINCT d.kind) FROM public.driver_documents d
  JOIN storage.objects o ON o.bucket_id='driver-documents' AND o.name=d.path
  WHERE d.user_id=auth.uid()
   AND d.kind IN ('car_card','insurance','license','car_inside','car_outside','selfie')) <> 6 THEN
  RAISE EXCEPTION 'بارگذاری هر شش مدرک الزامی است';
 END IF;
 INSERT INTO public.user_roles(user_id,role) VALUES(auth.uid(),'driver') ON CONFLICT DO NOTHING;
 INSERT INTO public.driver_verifications(user_id,status,note,updated_at)
 VALUES(auth.uid(),'pending','مدارک برای بررسی مدیر ارسال شد',now())
 ON CONFLICT(user_id) DO UPDATE SET status='pending',reviewed_by=NULL,reviewed_at=NULL,
 note='مدارک برای بررسی مدیر ارسال شد',updated_at=now();
END;
$$;
