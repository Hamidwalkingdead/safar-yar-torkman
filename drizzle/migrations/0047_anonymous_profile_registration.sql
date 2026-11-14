-- Allow passenger/driver registration without SMS by using Supabase anonymous sessions.
-- A self-entered phone is explicitly marked unverified; permanent phone identities remain Auth-controlled.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;

UPDATE public.profiles p
SET phone_verified = (u.phone_confirmed_at IS NOT NULL)
FROM auth.users u
WHERE u.id=p.id
  AND p.phone=public.normalize_iran_phone(u.phone);

CREATE OR REPLACE FUNCTION public.create_trip_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,auth
AS $fn$
BEGIN
  INSERT INTO public.profiles(id,phone,phone_verified)
  VALUES(NEW.id,public.normalize_iran_phone(NEW.phone),NEW.phone_confirmed_at IS NOT NULL)
  ON CONFLICT(id) DO UPDATE
    SET phone=EXCLUDED.phone,phone_verified=EXCLUDED.phone_verified;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.sync_verified_profile_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,auth
AS $fn$
BEGIN
  UPDATE public.profiles
  SET phone=public.normalize_iran_phone(NEW.phone),
      phone_verified=(NEW.phone_confirmed_at IS NOT NULL)
  WHERE id=NEW.id
    AND (
      phone IS DISTINCT FROM public.normalize_iran_phone(NEW.phone)
      OR phone_verified IS DISTINCT FROM (NEW.phone_confirmed_at IS NOT NULL)
    );
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sync_verified_profile_phone() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS auth_user_sync_verified_phone ON auth.users;
CREATE TRIGGER auth_user_sync_verified_phone
AFTER UPDATE OF phone,phone_confirmed_at ON auth.users
FOR EACH ROW
WHEN (
  OLD.phone IS DISTINCT FROM NEW.phone
  OR OLD.phone_confirmed_at IS DISTINCT FROM NEW.phone_confirmed_at
)
EXECUTE FUNCTION public.sync_verified_profile_phone();

CREATE OR REPLACE FUNCTION public.guard_profile_phone_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,auth
AS $fn$
DECLARE v_auth_phone text; v_verified boolean;
BEGIN
  IF NEW.phone IS DISTINCT FROM OLD.phone THEN
    IF auth.uid()=NEW.id
       AND coalesce((auth.jwt()->>'is_anonymous')::boolean,false) THEN
      IF NEW.phone !~ '^09[0-9]{9}$' THEN
        RAISE EXCEPTION 'شماره همراه معتبر ایران وارد کنید';
      END IF;
      NEW.phone_verified:=false;
    ELSE
      SELECT public.normalize_iran_phone(u.phone),u.phone_confirmed_at IS NOT NULL
      INTO v_auth_phone,v_verified
      FROM auth.users u WHERE u.id=NEW.id;
      IF v_auth_phone IS NULL OR v_auth_phone<>NEW.phone THEN
        RAISE EXCEPTION 'شماره همراه حساب دائمی فقط از مسیر احراز هویت قابل تغییر است';
      END IF;
      NEW.phone_verified:=coalesce(v_verified,false);
    END IF;
  ELSIF NEW.phone_verified IS DISTINCT FROM OLD.phone_verified THEN
    IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(),'admin') THEN
      RAISE EXCEPTION 'وضعیت تأیید شماره همراه قابل تغییر دستی نیست';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.guard_profile_phone_change() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS profiles_guard_verified_phone ON public.profiles;
CREATE TRIGGER profiles_guard_verified_phone
BEFORE UPDATE OF phone,phone_verified ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_phone_change();
