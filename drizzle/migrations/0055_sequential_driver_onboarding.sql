-- Sequential driver onboarding: verified phone -> identity -> vehicle -> six documents.
-- National IDs are encrypted with a dedicated Vault secret and never exposed in profiles.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS car_brand text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS car_color text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS car_model text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS car_year integer;

DO $$
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NULL
     OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Supabase Vault must be enabled before storing national IDs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='safar_yar_national_id_key') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'safar_yar_national_id_key',
      'Encryption key for Safar Yar driver national IDs',
      NULL
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.driver_identity_private (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  national_id_ciphertext text NOT NULL,
  national_id_hash text NOT NULL UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.driver_identity_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_identity_private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.national_id_encryption_key()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets
  WHERE name='safar_yar_national_id_key' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.national_id_encryption_key() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_my_driver_identity(p_national_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions
AS $$
DECLARE digits text; total integer:=0; remainder integer; expected integer; i integer; key_value text;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id=auth.uid() AND phone_verified IS TRUE
      AND phone ~ '^09[0-9]{9}$'
  ) THEN RAISE EXCEPTION 'ابتدا شماره همراه را با پیامک تأیید کنید'; END IF;
  digits := translate(coalesce(p_national_id,''),'۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩','01234567890123456789');
  digits := regexp_replace(digits,'\D','','g');
  IF digits !~ '^[0-9]{10}$' OR digits = repeat(substring(digits,1,1),10) THEN
    RAISE EXCEPTION 'کد ملی باید ۱۰ رقم معتبر باشد';
  END IF;
  FOR i IN 1..9 LOOP total := total + substring(digits,i,1)::integer * (11-i); END LOOP;
  remainder := total % 11;
  expected := CASE WHEN remainder < 2 THEN remainder ELSE 11-remainder END;
  IF expected <> substring(digits,10,1)::integer THEN
    RAISE EXCEPTION 'کد ملی معتبر نیست؛ رقم کنترل را بررسی کنید';
  END IF;
  key_value := public.national_id_encryption_key();
  INSERT INTO public.driver_identity_private(user_id,national_id_ciphertext,national_id_hash,updated_at)
  VALUES(
    auth.uid(),
    encode(extensions.pgp_sym_encrypt(digits,key_value,'cipher-algo=aes256'),'base64'),
    encode(extensions.hmac(convert_to(digits,'UTF8'),convert_to(key_value,'UTF8'),'sha256'),'hex'),
    now()
  )
  ON CONFLICT(user_id) DO UPDATE SET
    national_id_ciphertext=EXCLUDED.national_id_ciphertext,
    national_id_hash=EXCLUDED.national_id_hash,
    updated_at=now();
  UPDATE public.driver_verifications SET status='pending',reviewed_by=NULL,reviewed_at=NULL,
    note='اطلاعات هویتی تغییر کرده و نیازمند بررسی دوباره است',updated_at=now()
  WHERE user_id=auth.uid() AND status='approved';
END;
$$;
REVOKE ALL ON FUNCTION public.save_my_driver_identity(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_my_driver_identity(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_driver_national_id(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.driver_identity_private WHERE user_id=p_user
  );
$$;
REVOKE ALL ON FUNCTION public.has_driver_national_id(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.has_my_driver_identity()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$
  SELECT auth.uid() IS NOT NULL AND public.has_driver_national_id(auth.uid());
$$;
REVOKE ALL ON FUNCTION public.has_my_driver_identity() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.has_my_driver_identity() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_my_driver_fully_approved()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $ SELECT auth.uid() IS NOT NULL AND public.is_driver_fully_approved(auth.uid()); $;
REVOKE ALL ON FUNCTION public.is_my_driver_fully_approved() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_my_driver_fully_approved() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_driver_national_id(p_user uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions
AS $$
DECLARE result text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'دسترسی مدیر لازم است';
  END IF;
  SELECT extensions.pgp_sym_decrypt(decode(national_id_ciphertext,'base64'),
    public.national_id_encryption_key())
  INTO result FROM public.driver_identity_private WHERE user_id=p_user;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_driver_national_id(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_get_driver_national_id(uuid) TO authenticated;

-- National identity is now a mandatory part of driver approval and registration.
DO $$
DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('public.is_driver_fully_approved(uuid)'::regprocedure);
  definition := replace(definition,
    'AND public.has_emergency_phone(p_user)',
    'AND public.has_emergency_phone(p_user) AND public.has_driver_national_id(p_user)');
  EXECUTE definition;

  definition := pg_get_functiondef('public.admin_review_driver(uuid,text,text)'::regprocedure);
  definition := replace(definition,
    'AND public.has_emergency_phone(p_user)',
    'AND public.has_emergency_phone(p_user) AND public.has_driver_national_id(p_user)');
  EXECUTE definition;

  definition := pg_get_functiondef('public.save_my_driver_identity(text)'::regprocedure);
  definition := replace(definition,
    '  UPDATE public.driver_verifications SET status=''pending''',
    '  INSERT INTO public.driver_verifications(user_id,status,note,updated_at) VALUES(auth.uid(),''pending'',''ثبت‌نام راننده در حال تکمیل است'',now()) ON CONFLICT(user_id) DO NOTHING;' || chr(10) ||
    '  UPDATE public.driver_verifications SET status=''pending''');
  EXECUTE definition;

  definition := pg_get_functiondef('public.register_driver()'::regprocedure);
  definition := replace(definition,
    'AND length(trim(p.car))>=2 AND length(trim(p.plate))>=2',
    'AND length(trim(p.car))>=2 AND length(trim(p.plate))>=2 AND public.has_driver_national_id(auth.uid())');
  definition := replace(definition,
    'AND public.has_emergency_phone(auth.uid())',
    'AND public.has_emergency_phone(auth.uid()) AND public.has_driver_national_id(auth.uid())');
  EXECUTE definition;
END $;

-- All trusted driver gates require the four structured vehicle fields, not a free-text car label.
DO $vehicle$
DECLARE fn record; definition text;
BEGIN
  FOR fn IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f'
      AND p.proname IN ('admin_review_driver','is_driver_fully_approved','register_driver')
  LOOP
    definition := pg_get_functiondef(fn.oid);
    definition := regexp_replace(
      definition,
      $pattern$length\(trim\(p\.car\)\)\s*>=\s*2$pattern$,
      $replacement$length(trim(p.car)) >= 2 AND length(trim(p.car_brand)) >= 2 AND length(trim(p.car_color)) >= 2 AND length(trim(p.car_model)) >= 2 AND p.car_year BETWEEN 1300 AND 1500$replacement$,
      'g'
    );
    EXECUTE definition;
  END LOOP;
END $vehicle$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_car_year_check CHECK (car_year IS NULL OR car_year BETWEEN 1300 AND 1500);
