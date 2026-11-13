-- Encrypt emergency contacts with a project-managed secret.
-- The key is stored in Supabase Vault; only privileged database functions can read it.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $extension$
DECLARE schema_name text;
BEGIN
  SELECT n.nspname INTO schema_name
  FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
  WHERE e.extname='pgcrypto';
  IF schema_name IS DISTINCT FROM 'extensions' THEN
    ALTER EXTENSION pgcrypto SET SCHEMA extensions;
  END IF;
END;
$extension$;

DO $vault$
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NULL
     OR to_regprocedure('vault.create_secret(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Supabase Vault must be enabled before encrypting emergency contacts';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name='safar_yar_emergency_phone_key'
  ) THEN
    PERFORM vault.create_secret(
      encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex'),
      'safar_yar_emergency_phone_key',
      'Encryption key for Safar Yar emergency phone numbers'
    );
  END IF;
END;
$vault$;

CREATE TABLE IF NOT EXISTS public.profile_private_data (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  emergency_phone_ciphertext text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_private_data_ciphertext_check
    CHECK (emergency_phone_ciphertext IS NULL OR length(emergency_phone_ciphertext)>0)
);
ALTER TABLE public.profile_private_data ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_private_data FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.emergency_phone_encryption_key()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public, extensions, vault
AS $fn$
  SELECT decrypted_secret FROM vault.decrypted_secrets
  WHERE name='safar_yar_emergency_phone_key' LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.emergency_phone_encryption_key() FROM PUBLIC, anon, authenticated;

-- The legacy plaintext column is intentionally always empty after this migration.
CREATE OR REPLACE FUNCTION public.reset_driver_verification_on_profile_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $fn$
BEGIN
  IF (NEW.display_name, NEW.phone, NEW.car, NEW.plate, NEW.first_name, NEW.last_name)
     IS DISTINCT FROM
     (OLD.display_name, OLD.phone, OLD.car, OLD.plate, OLD.first_name, OLD.last_name) THEN
    INSERT INTO public.driver_verifications(
      user_id, status, reviewed_by, reviewed_at, note, updated_at
    )
    VALUES (
      NEW.id, 'pending', NULL, NULL,
      'اطلاعات هویتی یا تماس تغییر کرده و نیازمند بررسی مجدد است', now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET status='pending', reviewed_by=NULL, reviewed_at=NULL,
        note='اطلاعات هویتی یا تماس تغییر کرده و نیازمند بررسی مجدد است',
        updated_at=now();
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reset_driver_verification_on_profile_change() FROM PUBLIC, anon, authenticated;

-- Migrate existing plaintext values before clearing the legacy column.
INSERT INTO public.profile_private_data(user_id, emergency_phone_ciphertext, updated_at)
SELECT p.id,
       encode(extensions.pgp_sym_encrypt(
         p.emergency_phone,
         public.emergency_phone_encryption_key(),
         'cipher-algo=aes256'
       ), 'base64'),
       now()
FROM public.profiles p
WHERE coalesce(trim(p.emergency_phone), '') <> ''
ON CONFLICT (user_id) DO UPDATE
SET emergency_phone_ciphertext=EXCLUDED.emergency_phone_ciphertext,
    updated_at=EXCLUDED.updated_at;

UPDATE public.profiles SET emergency_phone=''
WHERE coalesce(emergency_phone, '') <> '';

CREATE OR REPLACE FUNCTION public.encrypt_profile_emergency_phone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, extensions
AS $fn$
DECLARE previous_phone text; supplied_phone text;
BEGIN
  supplied_phone := nullif(trim(coalesce(NEW.emergency_phone, '')), '');
  IF TG_OP='UPDATE' THEN
    SELECT extensions.pgp_sym_decrypt(
      decode(d.emergency_phone_ciphertext, 'base64'),
      public.emergency_phone_encryption_key()
    ) INTO previous_phone
    FROM public.profile_private_data d WHERE d.user_id=NEW.id;
  END IF;

  -- An empty profile field does not silently erase an existing contact.
  -- Removal is an explicit action through clear_my_emergency_phone().
  IF supplied_phone IS NOT NULL THEN
    IF supplied_phone !~ '^09[0-9]{9}$' THEN
      RAISE EXCEPTION 'شماره تماس اضطراری باید یک شماره همراه معتبر ایران باشد';
    END IF;
    IF previous_phone IS DISTINCT FROM supplied_phone THEN
      INSERT INTO public.profile_private_data(user_id, emergency_phone_ciphertext, updated_at)
      VALUES (
        NEW.id,
        encode(extensions.pgp_sym_encrypt(
          supplied_phone,
          public.emergency_phone_encryption_key(),
          'cipher-algo=aes256'
        ), 'base64'),
        now()
      )
      ON CONFLICT (user_id) DO UPDATE
      SET emergency_phone_ciphertext=EXCLUDED.emergency_phone_ciphertext,
          updated_at=EXCLUDED.updated_at;

      IF TG_OP='UPDATE' THEN
        UPDATE public.driver_verifications
        SET status='pending', reviewed_by=NULL, reviewed_at=NULL,
            note='شماره تماس اضطراری تغییر کرده و نیازمند بررسی دوباره است',
            updated_at=now()
        WHERE user_id=NEW.id AND status='approved';
      END IF;
    END IF;
  END IF;
  NEW.emergency_phone := '';
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.encrypt_profile_emergency_phone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_encrypt_emergency_phone ON public.profiles;
CREATE TRIGGER profiles_encrypt_emergency_phone
BEFORE INSERT OR UPDATE OF emergency_phone ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.encrypt_profile_emergency_phone();

CREATE OR REPLACE FUNCTION public.get_my_emergency_phone()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public, extensions
AS $fn$
  SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE (
    SELECT extensions.pgp_sym_decrypt(
      decode(d.emergency_phone_ciphertext, 'base64'),
      public.emergency_phone_encryption_key()
    )
    FROM public.profile_private_data d
    WHERE d.user_id=auth.uid() AND d.emergency_phone_ciphertext IS NOT NULL
  ) END;
$fn$;
REVOKE ALL ON FUNCTION public.get_my_emergency_phone() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_emergency_phone() TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_my_emergency_phone()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'برای تغییر اطلاعات اضطراری وارد حساب شوید'; END IF;
  DELETE FROM public.profile_private_data WHERE user_id=auth.uid();
  UPDATE public.driver_verifications
  SET status='pending', reviewed_by=NULL, reviewed_at=NULL,
      note='شماره تماس اضطراری حذف شده و نیازمند ثبت دوباره است', updated_at=now()
  WHERE user_id=auth.uid() AND status='approved';
END;
$fn$;
REVOKE ALL ON FUNCTION public.clear_my_emergency_phone() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_my_emergency_phone() TO authenticated;

CREATE OR REPLACE FUNCTION public.has_emergency_phone(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $fn$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profile_private_data d
    WHERE d.user_id=p_user AND d.emergency_phone_ciphertext IS NOT NULL
      AND length(d.emergency_phone_ciphertext)>0
  );
$fn$;
REVOKE ALL ON FUNCTION public.has_emergency_phone(uuid) FROM PUBLIC, anon, authenticated;

-- Replace the legacy plaintext emergency-phone gate in the trusted trip RPC.
CREATE OR REPLACE FUNCTION public.create_trip(
  p_origin text,
  p_destination text,
  p_departure timestamptz,
  p_km numeric,
  p_night boolean,
  p_mountain boolean,
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_destination_lat double precision,
  p_destination_lng double precision,
  p_suggested integer DEFAULT NULL,
  p_payment_method text DEFAULT 'cash',
  p_ride_type text DEFAULT 'intercity'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $fn$
DECLARE rid uuid; server_night boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id=auth.uid()
      AND length(trim(first_name))>=2
      AND length(trim(last_name))>=2
      AND length(trim(display_name))>=2
      AND phone ~ '^09[0-9]{9}$'
  ) OR NOT public.has_emergency_phone(auth.uid()) THEN
    RAISE EXCEPTION 'برای ثبت سفر، نام واقعی، نام خانوادگی، نام نمایشی و شماره اضطراری را در پروفایل کامل کنید';
  END IF;
  IF p_departure IS NULL THEN RAISE EXCEPTION 'زمان حرکت نامعتبر است'; END IF;
  IF p_ride_type IS NULL OR p_ride_type NOT IN ('urban','intercity','suburban') THEN
    RAISE EXCEPTION 'نوع سفر نامعتبر است';
  END IF;
  IF p_origin_lat IS NULL OR p_origin_lng IS NULL
     OR p_destination_lat IS NULL OR p_destination_lng IS NULL
     OR p_origin_lat NOT BETWEEN 24 AND 40.5 OR p_destination_lat NOT BETWEEN 24 AND 40.5
     OR p_origin_lng NOT BETWEEN 43 AND 64 OR p_destination_lng NOT BETWEEN 43 AND 64
     OR (p_origin_lat=p_destination_lat AND p_origin_lng=p_destination_lng) THEN
    RAISE EXCEPTION 'مختصات مبدأ یا مقصد نامعتبر است';
  END IF;
  server_night :=
    EXTRACT(HOUR FROM p_departure AT TIME ZONE 'Asia/Tehran') >= 22
    OR EXTRACT(HOUR FROM p_departure AT TIME ZONE 'Asia/Tehran') < 6;
  rid := public.create_trip(
    p_origin,p_destination,p_departure,p_km,server_night,
    p_mountain,p_suggested,p_payment_method
  );
  UPDATE public.trips
  SET ride_type=p_ride_type,
      origin_lat=p_origin_lat,
      origin_lng=p_origin_lng,
      destination_lat=p_destination_lat,
      destination_lng=p_destination_lng
  WHERE id=rid;
  RETURN rid;
END;
$fn$;
REVOKE ALL ON FUNCTION public.create_trip(
  text,text,timestamptz,numeric,boolean,boolean,
  double precision,double precision,double precision,double precision,
  integer,text,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_trip(
  text,text,timestamptz,numeric,boolean,boolean,
  double precision,double precision,double precision,double precision,
  integer,text,text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_driver_fully_approved(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public, storage
AS $fn$
  SELECT p_user IS NOT NULL
    AND public.has_role(p_user, 'driver')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.driver_verifications v ON v.user_id=p.id
      WHERE p.id=p_user AND v.status='approved'
        AND length(trim(p.first_name))>=2
        AND length(trim(p.last_name))>=2
        AND length(trim(p.display_name))>=2
        AND p.phone ~ '^09[0-9]{9}$'
        AND public.has_emergency_phone(p_user)
        AND length(trim(p.car))>=2 AND length(trim(p.plate))>=2
        AND (
          SELECT count(DISTINCT d.kind)
          FROM public.driver_documents d
          JOIN storage.objects o ON o.bucket_id='driver-documents' AND o.name=d.path
          WHERE d.user_id=p_user
            AND d.kind IN (
              'car_card', 'insurance', 'insurance_certificate',
              'license', 'car_inside', 'car_outside', 'selfie'
            )
        )=7
    );
$fn$;
REVOKE ALL ON FUNCTION public.is_driver_fully_approved(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_driver(
  p_user uuid, p_status text, p_note text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, storage
AS $fn$
DECLARE doc_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'دسترسی مدیر لازم است';
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'وضعیت نامعتبر است';
  END IF;
  IF p_status='approved' AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=p_user
      AND length(trim(p.first_name))>=2
      AND length(trim(p.last_name))>=2
      AND length(trim(p.display_name))>=2
      AND p.phone ~ '^09[0-9]{9}$'
      AND public.has_emergency_phone(p_user)
      AND length(trim(p.car))>=2 AND length(trim(p.plate))>=2
  ) THEN
    RAISE EXCEPTION 'اطلاعات هویتی، شماره اضطراری و مشخصات خودرو کامل نیست';
  END IF;

  SELECT count(DISTINCT d.kind) INTO doc_count
  FROM public.driver_documents d
  JOIN storage.objects o ON o.bucket_id='driver-documents' AND o.name=d.path
  WHERE d.user_id=p_user
    AND d.kind IN (
      'car_card', 'insurance', 'insurance_certificate',
      'license', 'car_inside', 'car_outside', 'selfie'
    );
  IF p_status='approved' AND doc_count<>7 THEN
    RAISE EXCEPTION 'همه هفت مدرک الزامی باید بارگذاری شده باشند';
  END IF;

  INSERT INTO public.driver_verifications(
    user_id, status, reviewed_by, reviewed_at, note, updated_at
  )
  VALUES(p_user, p_status, auth.uid(), now(), left(coalesce(p_note, ''), 500), now())
  ON CONFLICT(user_id) DO UPDATE
  SET status=EXCLUDED.status, reviewed_by=EXCLUDED.reviewed_by,
      reviewed_at=EXCLUDED.reviewed_at, note=EXCLUDED.note, updated_at=now();
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_review_driver(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_driver(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_driver()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, storage
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=auth.uid()
      AND length(trim(p.first_name))>=2
      AND length(trim(p.last_name))>=2
      AND length(trim(p.display_name))>=2
      AND p.phone ~ '^09[0-9]{9}$'
      AND length(trim(p.car))>=2 AND length(trim(p.plate))>=2
  ) OR NOT public.has_emergency_phone(auth.uid()) THEN
    RAISE EXCEPTION 'نام، نام خانوادگی، نام نمایشی، شماره همراه، شماره اضطراری و مشخصات خودرو را کامل کنید';
  END IF;

  IF (
    SELECT count(DISTINCT d.kind)
    FROM public.driver_documents d
    JOIN storage.objects o ON o.bucket_id='driver-documents' AND o.name=d.path
    WHERE d.user_id=auth.uid()
      AND d.kind IN (
        'car_card', 'insurance', 'insurance_certificate',
        'license', 'car_inside', 'car_outside', 'selfie'
      )
  ) <> 7 THEN
    RAISE EXCEPTION 'بارگذاری هر هفت مدرک و عکس الزامی است';
  END IF;

  INSERT INTO public.user_roles(user_id, role)
  VALUES(auth.uid(), 'driver') ON CONFLICT DO NOTHING;
  INSERT INTO public.driver_verifications(user_id, status, note, updated_at)
  VALUES(auth.uid(), 'pending', 'مدارک برای بررسی مدیر ارسال شد', now())
  ON CONFLICT(user_id) DO UPDATE
  SET status='pending', reviewed_by=NULL, reviewed_at=NULL,
      note='مدارک برای بررسی مدیر ارسال شد', updated_at=now();
END;
$fn$;
REVOKE ALL ON FUNCTION public.register_driver() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_driver() TO authenticated;

CREATE OR REPLACE FUNCTION public.require_passenger_emergency_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $fn$
BEGIN
  IF NOT public.has_emergency_phone(NEW.passenger_id) THEN
    RAISE EXCEPTION 'برای ثبت سفر ابتدا شماره تماس اضطراری را در پروفایل ثبت کنید';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.require_passenger_emergency_contact() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trips_require_emergency_contact ON public.trips;
CREATE TRIGGER trips_require_emergency_contact
BEFORE INSERT ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.require_passenger_emergency_contact();

CREATE OR REPLACE FUNCTION public.require_shared_ride_emergency_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $fn$
BEGIN
  IF NOT public.has_emergency_phone(NEW.owner_id) THEN
    RAISE EXCEPTION 'برای ثبت سفر اشتراکی ابتدا شماره تماس اضطراری را در پروفایل ثبت کنید';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.require_shared_ride_emergency_contact() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS shared_rides_require_emergency_contact ON public.shared_rides;
CREATE TRIGGER shared_rides_require_emergency_contact
BEFORE INSERT ON public.shared_rides
FOR EACH ROW EXECUTE FUNCTION public.require_shared_ride_emergency_contact();
