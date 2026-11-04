-- Public shared-ride discovery is exposed through the SECURITY DEFINER
-- shared_listing() RPC, which returns only the intended listing fields.
-- Do not expose the underlying table (including owner_id) through PostgREST.
REVOKE SELECT ON TABLE public.shared_rides FROM anon, authenticated;
DROP POLICY IF EXISTS "Public safe shared listings" ON public.shared_rides;
