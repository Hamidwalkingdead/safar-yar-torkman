ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS driver_code text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_driver_code_unique
  ON public.profiles (driver_code)
  WHERE driver_code IS NOT NULL;

COMMENT ON COLUMN public.profiles.driver_code IS
  'Permanent public driver username; unique and separate from phone number.';
