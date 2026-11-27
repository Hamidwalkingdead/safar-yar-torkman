-- A verified mobile number identifies exactly one passenger account.
-- Unverified legacy rows may contain duplicates and are deliberately excluded.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_verified_phone_unique
  ON public.profiles (phone)
  WHERE phone_verified IS TRUE AND phone <> '';
