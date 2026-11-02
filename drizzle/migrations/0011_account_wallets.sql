CREATE TABLE public.wallet_accounts (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 balance bigint NOT NULL DEFAULT 0 CHECK(balance>=0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.wallet_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 amount bigint NOT NULL CHECK(amount<>0),
 kind text NOT NULL CHECK(kind IN ('trip_earning','topup','withdrawal','refund','adjustment')),
 reference_id uuid,
 description text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wallet_trip_earning_once ON public.wallet_transactions(reference_id,kind) WHERE kind='trip_earning';
CREATE INDEX wallet_transactions_user_created ON public.wallet_transactions(user_id,created_at DESC);
ALTER TABLE public.wallet_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.wallet_accounts,public.wallet_transactions TO authenticated;
GRANT ALL ON public.wallet_accounts,public.wallet_transactions TO service_role;
CREATE POLICY wallet_self_read ON public.wallet_accounts FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY wallet_transactions_self_read ON public.wallet_transactions FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY wallet_admin_read ON public.wallet_accounts FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'));
CREATE POLICY wallet_transactions_admin_read ON public.wallet_transactions FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.create_wallet_for_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN INSERT INTO public.wallet_accounts(user_id) VALUES(NEW.id) ON CONFLICT DO NOTHING; RETURN NEW; END; $$;
REVOKE ALL ON FUNCTION public.create_wallet_for_user() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS auth_user_create_wallet ON auth.users;
CREATE TRIGGER auth_user_create_wallet AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.create_wallet_for_user();
INSERT INTO public.wallet_accounts(user_id) SELECT id FROM auth.users ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.credit_driver_wallet_on_trip_done() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF OLD.status IS DISTINCT FROM 'done' AND NEW.status='done' AND NEW.driver_id IS NOT NULL AND NEW.driver_net>0 THEN
  INSERT INTO public.wallet_accounts(user_id) VALUES(NEW.driver_id) ON CONFLICT DO NOTHING;
  INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
  VALUES(NEW.driver_id,NEW.driver_net,'trip_earning',NEW.id,'درآمد خالص سفر '||NEW.origin||' به '||NEW.destination)
  ON CONFLICT DO NOTHING;
  IF FOUND THEN
   UPDATE public.wallet_accounts SET balance=balance+NEW.driver_net,updated_at=now() WHERE user_id=NEW.driver_id;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.credit_driver_wallet_on_trip_done() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trip_done_wallet_credit ON public.trips;
CREATE TRIGGER trip_done_wallet_credit AFTER UPDATE OF status ON public.trips FOR EACH ROW EXECUTE FUNCTION public.credit_driver_wallet_on_trip_done();

CREATE TABLE public.wallet_withdrawal_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 amount bigint NOT NULL CHECK(amount>=50000),
 card_number text NOT NULL CHECK(card_number ~ '^[0-9]{16}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 note text
);
ALTER TABLE public.wallet_withdrawal_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.wallet_withdrawal_requests TO authenticated;
GRANT ALL ON public.wallet_withdrawal_requests TO service_role;
CREATE POLICY wallet_withdrawal_self_read ON public.wallet_withdrawal_requests FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY wallet_withdrawal_self_insert ON public.wallet_withdrawal_requests FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid() AND status='pending' AND reviewed_at IS NULL);

CREATE OR REPLACE FUNCTION public.request_wallet_withdrawal(p_amount bigint,p_card text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid;
BEGIN
 IF auth.uid() IS NULL OR p_amount<50000 OR p_card !~ '^[0-9]{16}$' THEN RAISE EXCEPTION 'مبلغ حداقل ۵۰ هزار تومان و شماره کارت ۱۶ رقمی لازم است'; END IF;
 INSERT INTO public.wallet_accounts(user_id) VALUES(auth.uid()) ON CONFLICT DO NOTHING;
 IF (SELECT balance FROM public.wallet_accounts WHERE user_id=auth.uid() FOR UPDATE)<p_amount THEN RAISE EXCEPTION 'موجودی کیف پول کافی نیست'; END IF;
 INSERT INTO public.wallet_withdrawal_requests(user_id,amount,card_number) VALUES(auth.uid(),p_amount,p_card) RETURNING id INTO rid;
 RETURN rid;
END; $$;
REVOKE ALL ON FUNCTION public.request_wallet_withdrawal(bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_wallet_withdrawal(bigint,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_wallet_withdrawal(p_request uuid,p_status text,p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w public.wallet_withdrawal_requests;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'دسترسی مدیر لازم است'; END IF;
 IF p_status NOT IN ('paid','rejected') THEN RAISE EXCEPTION 'وضعیت نامعتبر است'; END IF;
 SELECT * INTO w FROM public.wallet_withdrawal_requests WHERE id=p_request FOR UPDATE;
 IF NOT FOUND OR w.status<>'pending' THEN RAISE EXCEPTION 'درخواست قبلاً بررسی شده یا وجود ندارد'; END IF;
 IF p_status='paid' THEN
  UPDATE public.wallet_accounts SET balance=balance-w.amount,updated_at=now() WHERE user_id=w.user_id AND balance>=w.amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'موجودی کیف پول کافی نیست'; END IF;
  INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description) VALUES(w.user_id,-w.amount,'withdrawal',w.id,'برداشت از کیف پول');
 END IF;
 UPDATE public.wallet_withdrawal_requests SET status=p_status,reviewed_at=now(),note=left(coalesce(p_note,''),500) WHERE id=p_request;
END; $$;
REVOKE ALL ON FUNCTION public.admin_review_wallet_withdrawal(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_review_wallet_withdrawal(uuid,text,text) TO authenticated;