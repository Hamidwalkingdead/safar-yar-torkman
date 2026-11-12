-- Extend the existing Supabase profile with real identity and emergency contact fields.
ALTER TABLE public.profiles
 ADD COLUMN IF NOT EXISTS first_name text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS last_name text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS emergency_phone text NOT NULL DEFAULT '';

DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profiles_first_name_length_check') THEN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_first_name_length_check CHECK (length(first_name) <= 80);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profiles_last_name_length_check') THEN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_last_name_length_check CHECK (length(last_name) <= 80);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profiles_emergency_phone_check') THEN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_emergency_phone_check
   CHECK (emergency_phone='' OR emergency_phone ~ '^09[0-9]{9}$');
 END IF;
END $$;

-- Changes to any verified identity/contact detail invalidate driver approval.
CREATE OR REPLACE FUNCTION public.reset_driver_verification_on_profile_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF (NEW.display_name,NEW.phone,NEW.car,NEW.plate,NEW.first_name,NEW.last_name,NEW.emergency_phone)
    IS DISTINCT FROM
    (OLD.display_name,OLD.phone,OLD.car,OLD.plate,OLD.first_name,OLD.last_name,OLD.emergency_phone) THEN
  INSERT INTO public.driver_verifications(user_id,status,reviewed_by,reviewed_at,note,updated_at)
  VALUES(NEW.id,'pending',NULL,NULL,'اطلاعات هویتی یا تماس تغییر کرده و نیازمند بررسی مجدد است',now())
  ON CONFLICT(user_id) DO UPDATE SET
   status='pending',reviewed_by=NULL,reviewed_at=NULL,
   note='اطلاعات هویتی یا تماس تغییر کرده و نیازمند بررسی مجدد است',updated_at=now();
 END IF;
 RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_reset_driver_verification ON public.profiles;
CREATE TRIGGER profiles_reset_driver_verification
AFTER UPDATE OF display_name,phone,car,plate,first_name,last_name,emergency_phone
ON public.profiles FOR EACH ROW
EXECUTE FUNCTION public.reset_driver_verification_on_profile_change();

-- Require real name and an emergency contact before granting driver role.
CREATE OR REPLACE FUNCTION public.register_driver() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.profiles
  WHERE id=auth.uid()
   AND length(trim(first_name))>=2
   AND length(trim(last_name))>=2
   AND length(trim(display_name))>=2
   AND phone ~ '^09[0-9]{9}$'
   AND emergency_phone ~ '^09[0-9]{9}$'
   AND length(trim(car))>=2
   AND length(trim(plate))>=2
 ) THEN
  RAISE EXCEPTION 'نام، نام خانوادگی، نام نمایشی، شماره همراه، شماره اضطراری و مشخصات خودرو را کامل کنید';
 END IF;

 IF (SELECT count(*) FROM public.driver_documents d JOIN storage.objects o
     ON o.bucket_id='driver-documents' AND o.name=d.path WHERE d.user_id=auth.uid()) < 7 THEN
  RAISE EXCEPTION 'بارگذاری هر هفت مدرک و عکس الزامی است';
 END IF;

 INSERT INTO public.user_roles(user_id,role)
 VALUES(auth.uid(),'driver') ON CONFLICT DO NOTHING;

 INSERT INTO public.driver_verifications(user_id,status,note,updated_at)
 VALUES(auth.uid(),'pending','مدارک برای بررسی مدیر ارسال شد',now())
 ON CONFLICT(user_id) DO UPDATE SET
  status='pending',reviewed_by=NULL,reviewed_at=NULL,
  note='مدارک برای بررسی مدیر ارسال شد',updated_at=now();
END;
$$;
REVOKE ALL ON FUNCTION public.register_driver() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_driver() TO authenticated;

-- Enforce identity and emergency contact completion at the trusted trip boundary.
CREATE OR REPLACE FUNCTION public.create_trip(
 p_origin text,
 p_destination text,
 p_departure timestamptz,
 p_km numeric,
 p_night boolean,
 p_mountain boolean,
 p_suggested integer DEFAULT NULL,
 p_payment_method text DEFAULT 'cash',
 p_ride_type text DEFAULT 'intercity'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
 rid uuid;
 server_night boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.profiles
  WHERE id=auth.uid()
   AND length(trim(first_name))>=2
   AND length(trim(last_name))>=2
   AND length(trim(display_name))>=2
   AND phone ~ '^09[0-9]{9}$'
   AND emergency_phone ~ '^09[0-9]{9}$'
 ) THEN
  RAISE EXCEPTION 'برای ثبت سفر، نام واقعی، نام خانوادگی، نام نمایشی و شماره اضطراری را در پروفایل کامل کنید';
 END IF;

 IF p_departure IS NULL THEN
  RAISE EXCEPTION 'زمان حرکت نامعتبر است';
 END IF;
 IF p_ride_type IS NULL OR p_ride_type NOT IN ('urban','intercity') THEN
  RAISE EXCEPTION 'نوع سفر نامعتبر است';
 END IF;

 server_night :=
  EXTRACT(HOUR FROM p_departure AT TIME ZONE 'Asia/Tehran') >= 22
  OR EXTRACT(HOUR FROM p_departure AT TIME ZONE 'Asia/Tehran') < 6;

 rid := public.create_trip(
  p_origin,p_destination,p_departure,p_km,server_night,
  p_mountain,p_suggested,p_payment_method
 );

 UPDATE public.trips SET ride_type=p_ride_type WHERE id=rid;
 RETURN rid;
END;
$$;

REVOKE ALL ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer,text,text)
 FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer,text,text)
 TO authenticated;
