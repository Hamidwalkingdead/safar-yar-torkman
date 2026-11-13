-- Tighten exposed SECURITY DEFINER RPC permissions and pin helper search paths.
ALTER FUNCTION public.normalize_iran_phone(text)
  SET search_path=public, pg_catalog;
ALTER FUNCTION public.normalize_shared_place(text)
  SET search_path=public, pg_catalog;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=public
AS $fn$
  SELECT auth.uid() IS NOT NULL
    AND (
      _user_id=auth.uid()
      OR coalesce(current_setting('request.jwt.claim.role',true)='service_role',false)
      OR EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id=auth.uid() AND role='admin'
      )
    )
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id=_user_id AND role=_role
    );
$fn$;
REVOKE ALL ON FUNCTION public.has_role(uuid,public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid,public.app_role) TO authenticated;

-- These are trigger-only functions, never client-callable RPCs.
REVOKE ALL ON FUNCTION public.create_trip_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_trip_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_driver_verification_on_document_change() FROM PUBLIC, anon, authenticated;

-- Shared ride actions are available only to authenticated participants.
REVOKE ALL ON FUNCTION public.confirm_shared_price(uuid,integer,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_shared_price(uuid,integer,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.lock_shared_ride(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_shared_ride(uuid) TO authenticated;
