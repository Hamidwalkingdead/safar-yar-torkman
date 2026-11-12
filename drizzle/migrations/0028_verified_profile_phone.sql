-- Normalize the verified Supabase Auth phone into the local Iranian format used by profiles.
CREATE OR REPLACE FUNCTION public.normalize_iran_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE digits text := regexp_replace(coalesce(p_phone,''),'\\D','','g');
BEGIN
 IF digits ~ '^09[0-9]{9}$' THEN RETURN digits; END IF;
 IF digits ~ '^9[0-9]{9}$' THEN RETURN '0' || digits; END IF;
 IF digits ~ '^989[0-9]{9}$' THEN RETURN '0' || right(digits,10); END IF;
 IF digits ~ '^00989[0-9]{9}$' THEN RETURN '0' || right(digits,10); END IF;
 RETURN '';
END;
$$;
REVOKE ALL ON FUNCTION public.normalize_iran_phone(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_trip_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
 INSERT INTO public.profiles(id,phone)
 VALUES(NEW.id,public.normalize_iran_phone(NEW.phone))
 ON CONFLICT(id) DO UPDATE SET phone=excluded.phone;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_verified_profile_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
 UPDATE public.profiles
 SET phone=public.normalize_iran_phone(NEW.phone)
 WHERE id=NEW.id
   AND phone IS DISTINCT FROM public.normalize_iran_phone(NEW.phone);
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_verified_profile_phone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS auth_user_sync_verified_phone ON auth.users;
CREATE TRIGGER auth_user_sync_verified_phone
AFTER UPDATE OF phone ON auth.users
FOR EACH ROW
WHEN (OLD.phone IS DISTINCT FROM NEW.phone)
EXECUTE FUNCTION public.sync_verified_profile_phone();

CREATE OR REPLACE FUNCTION public.guard_profile_phone_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
 IF NEW.phone IS DISTINCT FROM OLD.phone
 AND NOT EXISTS (
  SELECT 1 FROM auth.users u
  WHERE u.id = NEW.id
    AND public.normalize_iran_phone(u.phone) = NEW.phone
    AND NEW.phone ~ '^09[0-9]{9}$'
 ) THEN
  RAISE EXCEPTION 'شماره همراه باید از مسیر احراز هویت پیامکی حساب تغییر کند';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_profile_phone_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_guard_verified_phone ON public.profiles;
CREATE TRIGGER profiles_guard_verified_phone
BEFORE UPDATE OF phone ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.guard_profile_phone_change();
