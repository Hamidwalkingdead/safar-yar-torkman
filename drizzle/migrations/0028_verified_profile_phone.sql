-- The primary phone is verified by Supabase Auth; profile edits must not be
-- able to replace it with an arbitrary, unverified number.
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
  WHERE u.id = NEW.id AND u.phone = NEW.phone
 ) THEN
  RAISE EXCEPTION 'شماره همراه باید از مسیر احراز هویت پیامکی حساب تغییر کند';
 END IF;
 RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_verified_phone ON public.profiles;
CREATE TRIGGER profiles_guard_verified_phone
BEFORE UPDATE OF phone ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.guard_profile_phone_change();
