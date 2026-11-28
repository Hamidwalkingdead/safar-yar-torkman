-- Anonymous pre-OTP sessions must not create support tickets or withdrawal requests.
DROP POLICY IF EXISTS own_ticket_insert ON public.support_tickets;
CREATE POLICY own_ticket_insert
ON public.support_tickets
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = (select auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (select auth.uid()) AND p.phone_verified IS TRUE
  )
  AND category IN ('کرایه','رفتار راننده','رفتار مسافر','اشیای گمشده','ایمنی','سایر')
);
COMMENT ON POLICY own_ticket_insert ON public.support_tickets IS
  'Only phone-verified users may create support tickets in the supported categories.';

DROP POLICY IF EXISTS wallet_withdrawal_self_insert ON public.wallet_withdrawal_requests;
CREATE POLICY wallet_withdrawal_self_insert
ON public.wallet_withdrawal_requests
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = (select auth.uid())
  AND status = 'pending'
  AND reviewed_at IS NULL
  AND public.billing_wallet_enabled()
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (select auth.uid()) AND p.phone_verified IS TRUE
  )
  AND EXISTS (
    SELECT 1 FROM public.wallet_accounts w
    WHERE w.user_id = (select auth.uid()) AND w.balance >= amount
  )
);
COMMENT ON POLICY wallet_withdrawal_self_insert ON public.wallet_withdrawal_requests IS
  'Only phone-verified account owners with sufficient wallet balance may create pending withdrawal requests.';

CREATE OR REPLACE FUNCTION public.request_wallet_withdrawal(p_amount bigint, p_card text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE rid uuid; current_balance bigint;
BEGIN
  IF NOT public.billing_wallet_enabled() THEN
    RAISE EXCEPTION 'کیف پول در نسخه فعلی غیرفعال است';
  END IF;
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.phone_verified IS TRUE
  ) THEN
    RAISE EXCEPTION 'ورود و تأیید شماره تلفن لازم است';
  END IF;
  IF p_amount < 50000 OR p_card !~ '^[0-9]{16}$' THEN
    RAISE EXCEPTION 'مبلغ حداقل ۵۰ هزار تومان و شماره کارت ۱۶ رقمی لازم است';
  END IF;
  INSERT INTO public.wallet_accounts(user_id)
  VALUES(auth.uid()) ON CONFLICT DO NOTHING;
  SELECT balance INTO current_balance
  FROM public.wallet_accounts
  WHERE user_id = auth.uid()
  FOR UPDATE;
  IF coalesce(current_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'موجودی کیف پول کافی نیست';
  END IF;
  INSERT INTO public.wallet_withdrawal_requests(user_id, amount, card_number)
  VALUES(auth.uid(), p_amount, p_card)
  RETURNING id INTO rid;
  RETURN rid;
END;
$function$;
