-- One-time state for setting the password of the pre-existing owner admin account.
-- Only the service-role Edge Function can read or mutate this row.
CREATE TABLE IF NOT EXISTS public.admin_password_bootstrap_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  used_at timestamptz,
  claim_id uuid
);

INSERT INTO public.admin_password_bootstrap_state (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.admin_password_bootstrap_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_password_bootstrap_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_password_bootstrap_state TO service_role;
