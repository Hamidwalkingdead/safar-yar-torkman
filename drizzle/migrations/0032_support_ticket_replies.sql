-- Private, auditable two-way support conversation.
CREATE TABLE IF NOT EXISTS public.support_ticket_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_ticket_replies_ticket_created_idx
  ON public.support_ticket_replies(ticket_id, created_at);
ALTER TABLE public.support_ticket_replies ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.support_ticket_replies TO authenticated;
DROP POLICY IF EXISTS support_replies_participant_read ON public.support_ticket_replies;
CREATE POLICY support_replies_participant_read ON public.support_ticket_replies
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id=ticket_id AND t.user_id=auth.uid())
    OR public.has_role(auth.uid(),'admin')
  );
REVOKE ALL ON public.support_ticket_replies FROM anon;

CREATE OR REPLACE FUNCTION public.reply_support_ticket(p_ticket uuid, p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.support_tickets; reply_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'برای ارسال پیام وارد حساب شوید'; END IF;
  IF p_body IS NULL OR length(trim(p_body)) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'متن پیام باید بین ۱ تا ۴۰۰۰ نویسه باشد';
  END IF;
  SELECT * INTO t FROM public.support_tickets WHERE id=p_ticket FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تیکت پیدا نشد'; END IF;
  IF t.user_id IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'دسترسی به این تیکت مجاز نیست';
  END IF;
  IF t.status='resolved' AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'این تیکت بسته شده است';
  END IF;
  INSERT INTO public.support_ticket_replies(ticket_id,sender_id,body)
  VALUES(p_ticket,auth.uid(),trim(p_body)) RETURNING id INTO reply_id;
  IF public.has_role(auth.uid(),'admin') THEN
    UPDATE public.support_tickets SET status='review' WHERE id=p_ticket;
  ELSE
    UPDATE public.support_tickets SET status='open' WHERE id=p_ticket;
  END IF;
  RETURN reply_id;
END; $$;
REVOKE ALL ON FUNCTION public.reply_support_ticket(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reply_support_ticket(uuid,text) TO authenticated;
