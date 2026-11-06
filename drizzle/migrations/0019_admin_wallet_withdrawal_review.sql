-- Allow administrators to review withdrawal requests without exposing them to users.
-- The card number is available only to authenticated admins through this policy.
DROP POLICY IF EXISTS admin_wallet_withdrawal_read ON public.wallet_withdrawal_requests;
CREATE POLICY admin_wallet_withdrawal_read
ON public.wallet_withdrawal_requests
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

REVOKE ALL ON FUNCTION public.admin_review_wallet_withdrawal(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_wallet_withdrawal(uuid,text,text) TO authenticated;
