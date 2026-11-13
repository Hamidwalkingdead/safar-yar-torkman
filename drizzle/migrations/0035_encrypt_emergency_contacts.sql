-- Encrypt emergency contacts with a per-project key managed by Supabase Vault.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $vault$
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NULL
     OR to_regprocedure('vault.create_secret(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Supabase Vault must be enabled before encrypting emergency contacts';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name='safar_yar_emergency_phone_key'
  ) THEN
    PERFORM vault.create_secret(
      encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()),'hex'),
      'safar_yar_emergency_phone_key',
      'AES key for encrypted passenger emergency contact numbers'
    );
  END IF;
END; $vault$;

REVOKE ALL ON TABLE vault.decrypted_secrets FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION vault.create_secret(text,text,text) FROM PUBLIC,anon,authenticated;

CREATE TABLE IF NOT EXISTS public.profile_private_data (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  emergency_phone_ciphertext text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (emergency_phone_ciphertext IS NULL OR length(emergency_phone_ciphertext)>0)
);
ALTER TABLE public.profile_private_data ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_private_data FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.emergency_phone_encryption_key()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions,vault AS $fn$
  SELECT decrypted_secret FROM vault.decrypted_secrets
  WHERE name='safar_yar_emergency_phone_key';
$fn$;
REVOKE ALL ON FUNCTION public.emergency_phone_encryption_key() FROM PUBLIC,anon,authenticated;

-- Encrypt existing profile values before clearing the legacy plaintext column.
INSERT INTO public.profile_private_data(user_id,emergency_phone_ciphertext,updated_at)
SELECT p.id,
       encode(pgp_sym_encrypt(p.emergency_phone,public.emergency_phone_encryption_key(),'cipher-algo=aes256'),'base64'),
       now()
FROM public.profiles p
WHERE coalesce(trim(p.emergency_phone),'')<>''
ON CONFLICT(user_id) DO UPDATE
SET emergency_phone_ciphertext=EXCLUDED.emergency_phone_ciphertext,updated_at=now();
UPDATE public.profiles SET emergency_phone='' WHERE coalesce(emergency_phone,'')<>'';

CREATE OR REPLACE FUNCTION public.encrypt_profile_emergency_phone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $fn$
DECLARE previous_phone text;
BEGIN
  IF coalesce(trim(NEW.emergency_phone),'')<>'' THEN
    IF TG_OP='UPDATE' THEN
      SELECT pgp_sym_decrypt(decode(d.emergency_phone_ciphertext,'base64'),public.emergency_phone_encryption_key())
      INTO previous_phone
      FROM public.profile_private_data d WHERE d.user_id=NEW.id;
    END IF;
    INSERT INTO public.profile_private_data(user_id,emergency_phone_ciphertext,updated_at)
    VALUES(
      NEW.id,
      encode(pgp_sym_encrypt(trim(NEW.emergency_phone),public.emergency_phone_encryption_key(),'cipher-algo=aes256'),'base64'),
      now()
    )
    ON CONFLICT(user_id) DO UPDATE
    SET emergency_phone_ciphertext=EXCLUDED.emergency_phone_ciphertext,updated_at=now();
    IF TG_OP='UPDATE' AND previous_phone IS DISTINCT FROM trim(NEW.emergency_phone) THEN
      UPDATE public.driver_verifications
      SET status='pending',note='شماره تماس اضطراری تغییر کرده و نیازمند بررسی دوباره است',updated_at=now()
      WHERE user_id=NEW.id AND status='approved';
    END IF;
    NEW.emergency_phone:='';
  END IF;
  RETURN NEW;
END; $fn$;
REVOKE ALL ON FUNCTION public.encrypt_profile_emergency_phone() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS profiles_encrypt_emergency_phone ON public.profiles;
CREATE TRIGGER profiles_encrypt_emergency_phone
BEFORE INSERT OR UPDATE OF emergency_phone ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.encrypt_profile_emergency_phone();

CREATE OR REPLACE FUNCTION public.get_my_emergency_phone()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions AS $fn$
  SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE (
    SELECT pgp_sym_decrypt(decode(d.emergency_phone_ciphertext,'base64'),public.emergency_phone_encryption_key())
    FROM public.profile_private_data d WHERE d.user_id=auth.uid()
  ) END;
$fn$;
REVOKE ALL ON FUNCTION public.get_my_emergency_phone() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_emergency_phone() TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_my_emergency_phone()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'برای تغییر اطلاعات اضطراری وارد حساب شوید'; END IF;
  DELETE FROM public.profile_private_data WHERE user_id=auth.uid();
  UPDATE public.driver_verifications
  SET status='pending',note='شماره تماس اضطراری حذف شده و نیازمند ثبت دوباره است',updated_at=now()
  WHERE user_id=auth.uid() AND status='approved';
END; $fn$;
REVOKE ALL ON FUNCTION public.clear_my_emergency_phone() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.clear_my_emergency_phone() TO authenticated;

CREATE OR REPLACE FUNCTION public.has_emergency_phone(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profile_private_data d
    WHERE d.user_id=p_user AND d.emergency_phone_ciphertext IS NOT NULL
  );
$fn$;
REVOKE ALL ON FUNCTION public.has_emergency_phone(uuid) FROM PUBLIC,anon,authenticated;

-- Keep the administrator approval boundary while checking the encrypted field.
CREATE OR REPLACE FUNCTION public.is_driver_fully_approved(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,storage AS $fn$
  SELECT p_user IS NOT NULL
    AND public.has_role(p_user,'driver')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.driver_verifications v ON v.user_id=p.id
      WHERE p.id=p_user
        AND v.status='approved'
        AND length(trim(p.first_name))>=2
        AND length(trim(p.last_name))>=2
        AND length(trim(p.display_name))>=2
        AND p.phone ~ '^09[0-9]{9}$'
        AND public.has_emergency_phone(p_user)
        AND length(trim(p.car))>=2
        AND length(trim(p.plate))>=2
        AND (
          SELECT count(DISTINCT d.kind)
          FROM public.driver_documents d
          JOIN storage.objects o ON o.bucket_id='driver-documents' AND o.name=d.path
          WHERE d.user_id=p_user
            AND d.kind IN ('car_card','insurance','insurance_certificate','license','car_inside','car_outside','selfie')
        )=7
    );
$fn$;
REVOKE ALL ON FUNCTION public.is_driver_fully_approved(uuid) FROM PUBLIC,anon,authenticated;

-- The passenger and shared-ride owners must have an encrypted emergency contact.
CREATE OR REPLACE FUNCTION public.require_passenger_emergency_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
  IF NOT public.has_emergency_phone(NEW.passenger_id) THEN
    RAISE EXCEPTION 'برای ثبت سفر ابتدا شماره تماس اضطراری را در پروفایل ثبت کنید';
  END IF;
  RETURN NEW;
END; $fn$;
REVOKE ALL ON FUNCTION public.require_passenger_emergency_contact() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trips_require_emergency_contact ON public.trips;
CREATE TRIGGER trips_require_emergency_contact
BEFORE INSERT ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.require_passenger_emergency_contact();

CREATE OR REPLACE FUNCTION public.require_shared_ride_emergency_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
  IF NOT public.has_emergency_phone(NEW.owner_id) THEN
    RAISE EXCEPTION 'برای ثبت سفر اشتراکی ابتدا شماره تماس اضطراری را در پروفایل ثبت کنید';
  END IF;
  RETURN NEW;
END; $fn$;
REVOKE ALL ON FUNCTION public.require_shared_ride_emergency_contact() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS shared_rides_require_emergency_contact ON public.shared_rides;
CREATE TRIGGER shared_rides_require_emergency_contact
BEFORE INSERT ON public.shared_rides
FOR EACH ROW EXECUTE FUNCTION public.require_shared_ride_emergency_contact();
