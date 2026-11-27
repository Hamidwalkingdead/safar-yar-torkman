-- Anonymous sessions are useful for the pre-login shell, but must never
-- create trips, upload driver documents, obtain the driver role, or become
-- approved drivers before the phone number is verified by Supabase Auth/OTPY.

CREATE OR REPLACE FUNCTION public.enforce_verified_phone_for_trip_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = NEW.passenger_id AND p.phone_verified IS TRUE
  ) THEN
    RAISE EXCEPTION 'برای ثبت سفر ابتدا شماره همراه خود را با پیامک تأیید کنید';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.enforce_verified_phone_for_trip_owner() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trips_require_verified_phone ON public.trips;
CREATE TRIGGER trips_require_verified_phone
BEFORE INSERT OR UPDATE OF passenger_id ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.enforce_verified_phone_for_trip_owner();

CREATE OR REPLACE FUNCTION public.enforce_verified_phone_for_shared_ride_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = NEW.owner_id AND p.phone_verified IS TRUE
  ) THEN
    RAISE EXCEPTION 'برای ساخت سفر اشتراکی ابتدا شماره همراه خود را با پیامک تأیید کنید';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.enforce_verified_phone_for_shared_ride_owner() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS shared_rides_require_verified_phone ON public.shared_rides;
CREATE TRIGGER shared_rides_require_verified_phone
BEFORE INSERT OR UPDATE OF owner_id ON public.shared_rides
FOR EACH ROW EXECUTE FUNCTION public.enforce_verified_phone_for_shared_ride_owner();

CREATE OR REPLACE FUNCTION public.enforce_verified_phone_for_driver_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NEW.role = 'driver'::public.app_role
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.id = NEW.user_id AND p.phone_verified IS TRUE
     ) THEN
    RAISE EXCEPTION 'برای ثبت‌نام راننده ابتدا شماره همراه خود را با پیامک تأیید کنید';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.enforce_verified_phone_for_driver_role() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS user_roles_driver_requires_verified_phone ON public.user_roles;
CREATE TRIGGER user_roles_driver_requires_verified_phone
BEFORE INSERT OR UPDATE OF role ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.enforce_verified_phone_for_driver_role();

CREATE OR REPLACE FUNCTION public.enforce_verified_phone_for_driver_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NEW.status = 'approved'
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.id = NEW.user_id AND p.phone_verified IS TRUE
     ) THEN
    RAISE EXCEPTION 'تأیید راننده بدون تأیید شماره همراه مجاز نیست';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.enforce_verified_phone_for_driver_approval() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS driver_verifications_require_verified_phone ON public.driver_verifications;
CREATE TRIGGER driver_verifications_require_verified_phone
BEFORE INSERT OR UPDATE OF status ON public.driver_verifications
FOR EACH ROW EXECUTE FUNCTION public.enforce_verified_phone_for_driver_approval();

-- Defense in depth: previously approved but unverified driver profiles
-- must not be able to accept trips or shared rides.
CREATE OR REPLACE FUNCTION public.is_driver_fully_approved(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, storage
AS $fn$
  SELECT p_user IS NOT NULL
    AND public.has_role(p_user, 'driver')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.driver_verifications v ON v.user_id = p.id
      WHERE p.id = p_user
        AND p.phone_verified IS TRUE
        AND v.status = 'approved'
        AND length(trim(p.first_name)) >= 2
        AND length(trim(p.last_name)) >= 2
        AND length(trim(p.display_name)) >= 2
        AND p.phone ~ '^09[0-9]{9}$'
        AND public.has_emergency_phone(p_user)
        AND length(trim(p.car)) >= 2
        AND length(trim(p.plate)) >= 2
        AND (
          SELECT count(DISTINCT d.kind)
          FROM public.driver_documents d
          JOIN storage.objects o
            ON o.bucket_id = 'driver-documents' AND o.name = d.path
          WHERE d.user_id = p_user
            AND d.kind IN (
              'car_card', 'insurance', 'insurance_certificate',
              'license', 'car_inside', 'car_outside', 'selfie'
            )
        ) = 7
    );
$fn$;

-- A verified phone is required before driver document uploads consume storage.
DROP POLICY IF EXISTS driver_docs_insert ON storage.objects;
CREATE POLICY driver_docs_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'driver-documents'
  AND (storage.foldername(name))[1] = (select auth.uid())::text
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (select auth.uid()) AND p.phone_verified IS TRUE
  )
);

DROP POLICY IF EXISTS driver_docs_update ON storage.objects;
CREATE POLICY driver_docs_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'driver-documents'
  AND (storage.foldername(name))[1] = (select auth.uid())::text
)
WITH CHECK (
  bucket_id = 'driver-documents'
  AND (storage.foldername(name))[1] = (select auth.uid())::text
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (select auth.uid()) AND p.phone_verified IS TRUE
  )
);

DROP POLICY IF EXISTS own_doc_insert ON public.driver_documents;
CREATE POLICY own_doc_insert ON public.driver_documents
FOR INSERT TO authenticated
WITH CHECK (
  user_id = (select auth.uid())
  AND split_part(path, '/', 1) = (select auth.uid())::text
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (select auth.uid()) AND p.phone_verified IS TRUE
  )
);

DROP POLICY IF EXISTS own_doc_update ON public.driver_documents;
CREATE POLICY own_doc_update ON public.driver_documents
FOR UPDATE TO authenticated
USING (user_id = (select auth.uid()))
WITH CHECK (
  user_id = (select auth.uid())
  AND split_part(path, '/', 1) = (select auth.uid())::text
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (select auth.uid()) AND p.phone_verified IS TRUE
  )
);
