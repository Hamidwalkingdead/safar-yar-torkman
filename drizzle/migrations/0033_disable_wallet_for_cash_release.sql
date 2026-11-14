-- Wallet remains a dormant, opt-in integration. Cash trips must never require it.
CREATE TABLE IF NOT EXISTS public.platform_billing_features (
  id boolean PRIMARY KEY DEFAULT true CHECK (id=true),
  wallet_enabled boolean NOT NULL DEFAULT false,
  bank_gateway_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.platform_billing_features(id,wallet_enabled,bank_gateway_enabled)
VALUES(true,false,false) ON CONFLICT(id) DO NOTHING;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.trips WHERE payment_method='wallet' AND status IN ('pending','accepted','ongoing'))
     OR EXISTS (SELECT 1 FROM public.wallet_withdrawal_requests WHERE status='pending') THEN
    RAISE EXCEPTION 'ابتدا سفرهای کیف پولی فعال و درخواست‌های برداشت معوق را تعیین تکلیف کنید؛ کیف پول هنوز خاموش نشد';
  END IF;
END; $guard$;
ALTER TABLE public.platform_billing_features ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_billing_features FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.billing_wallet_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce((SELECT wallet_enabled FROM public.platform_billing_features WHERE id=true),false);
$$;
REVOKE ALL ON FUNCTION public.billing_wallet_enabled() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_wallet_enabled() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_billing_features()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('wallet',coalesce(wallet_enabled,false),'bankGateway',coalesce(bank_gateway_enabled,false))
  FROM public.platform_billing_features WHERE id=true;
$$;
REVOKE ALL ON FUNCTION public.get_billing_features() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_billing_features() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_billing_features(
  p_wallet_enabled boolean,
  p_bank_gateway_enabled boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'دسترسی مدیر لازم است'; END IF;
  IF p_bank_gateway_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'درگاه بانکی تا پیاده‌سازی و آزمون اتصال‌دهنده واقعی قابل فعال‌سازی نیست';
  END IF;
  IF p_wallet_enabled IS DISTINCT FROM true AND EXISTS (
    SELECT 1 FROM public.trips WHERE payment_method='wallet' AND status IN ('pending','accepted','ongoing')
  ) THEN RAISE EXCEPTION 'تا پایان یا لغو سفرهای کیف پولی فعال، خاموش‌کردن کیف پول مجاز نیست'; END IF;
  UPDATE public.platform_billing_features
  SET wallet_enabled=p_wallet_enabled,bank_gateway_enabled=false,updated_at=now()
  WHERE id=true;
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_billing_features(boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_billing_features(boolean,boolean) TO authenticated;

-- Do not create wallet accounts for every new auth user in the cash-only release.
DROP TRIGGER IF EXISTS auth_user_create_wallet ON auth.users;

-- Block wallet-paid trips at the database boundary, even if a stale client calls the RPC.
CREATE OR REPLACE FUNCTION public.enforce_trip_billing_mode()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.payment_method='wallet' AND NOT public.billing_wallet_enabled() THEN
    RAISE EXCEPTION 'پرداخت کیف پول در نسخه فعلی غیرفعال است؛ پرداخت نقدی به راننده انجام می‌شود';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.enforce_trip_billing_mode() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trips_billing_mode_guard ON public.trips;
CREATE TRIGGER trips_billing_mode_guard BEFORE INSERT OR UPDATE OF payment_method ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.enforce_trip_billing_mode();

-- Legacy wallet-only settlement functions also fail closed while the feature is off.
CREATE OR REPLACE FUNCTION public.settle_wallet_trip()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $func$
BEGIN
  IF NOT public.billing_wallet_enabled() THEN RETURN NEW; END IF;
  IF OLD.status IS DISTINCT FROM 'done' AND NEW.status='done' AND NEW.payment_method='wallet' THEN
    INSERT INTO public.wallet_accounts(user_id) VALUES(NEW.driver_id) ON CONFLICT DO NOTHING;
    INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
    VALUES(NEW.driver_id,NEW.driver_net,'trip_earning',NEW.id,'سهم راننده از پرداخت کیف پول') ON CONFLICT DO NOTHING;
    IF FOUND THEN
      UPDATE public.wallet_accounts SET balance=balance+NEW.driver_net,updated_at=now() WHERE user_id=NEW.driver_id;
      UPDATE public.platform_revenue SET balance=balance+NEW.commission,updated_at=now() WHERE id=true;
    END IF;
  END IF;
  RETURN NEW;
END; $func$;

CREATE OR REPLACE FUNCTION public.process_passenger_cancellation_penalty()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $func$
DECLARE penalty bigint; platform_share bigint; driver_share bigint; passenger_cancel boolean;
BEGIN
  IF NEW.payment_method='wallet' AND NOT public.billing_wallet_enabled() THEN
    RAISE EXCEPTION 'عملیات کیف پول در نسخه فعلی غیرفعال است';
  END IF;
  IF OLD.status IS DISTINCT FROM 'cancelled' AND NEW.status='cancelled' AND NEW.payment_method='wallet' THEN
    passenger_cancel := auth.uid()=NEW.passenger_id AND OLD.status='accepted' AND NEW.driver_id IS NOT NULL;
    IF passenger_cancel THEN
      penalty:=round(NEW.agreed_fare*0.20)::bigint;
      platform_share:=round(penalty*0.10)::bigint;
      driver_share:=penalty-platform_share;
      INSERT INTO public.wallet_accounts(user_id) VALUES(NEW.driver_id) ON CONFLICT DO NOTHING;
      INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
      VALUES(NEW.driver_id,driver_share,'cancellation_penalty',NEW.id,'۹۰٪ سهم راننده از جریمه لغو مسافر') ON CONFLICT DO NOTHING;
      IF FOUND THEN
        UPDATE public.wallet_accounts SET balance=balance+driver_share,updated_at=now() WHERE user_id=NEW.driver_id;
        UPDATE public.platform_revenue SET balance=balance+platform_share,updated_at=now() WHERE id=true;
      END IF;
      UPDATE public.wallet_accounts SET balance=balance+(NEW.agreed_fare-penalty)+NEW.prior_debt_amount,updated_at=now()
      WHERE user_id=NEW.passenger_id;
      INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
      VALUES(NEW.passenger_id,NEW.agreed_fare-penalty+NEW.prior_debt_amount,'trip_refund',NEW.id,'بازپرداخت پس از کسر جریمه لغو');
    ELSE
      UPDATE public.wallet_accounts SET balance=balance+NEW.agreed_fare+NEW.prior_debt_amount,updated_at=now()
      WHERE user_id=NEW.passenger_id;
      INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
      VALUES(NEW.passenger_id,NEW.agreed_fare+NEW.prior_debt_amount,'trip_refund',NEW.id,'بازپرداخت کامل سفر لغوشده');
    END IF;
  ELSIF OLD.status IS DISTINCT FROM 'cancelled' AND NEW.status='cancelled'
    AND OLD.status='accepted' AND NEW.driver_id IS NOT NULL
    AND auth.uid()=NEW.passenger_id AND NEW.payment_method='cash' THEN
    penalty:=round(NEW.agreed_fare*0.20)::bigint;
    platform_share:=round(penalty*0.10)::bigint;
    driver_share:=penalty-platform_share;
    INSERT INTO public.passenger_cancellation_debts(passenger_id,source_trip_id,driver_id,penalty_amount,platform_amount,driver_amount)
    VALUES(NEW.passenger_id,NEW.id,NEW.driver_id,penalty,platform_share,driver_share)
    ON CONFLICT(source_trip_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $func$;

-- Cash commission is recorded on the trip, not debited from a driver's wallet.
CREATE OR REPLACE FUNCTION public.process_cash_trip_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_balance bigint;
BEGIN
  IF NOT public.billing_wallet_enabled() THEN RETURN NEW; END IF;
  IF OLD.status IS DISTINCT FROM 'done' AND NEW.status='done'
     AND NEW.payment_method='cash' AND NEW.driver_id IS NOT NULL AND NEW.commission>0 THEN
    INSERT INTO public.wallet_accounts(user_id) VALUES(NEW.driver_id) ON CONFLICT DO NOTHING;
    SELECT balance INTO current_balance FROM public.wallet_accounts WHERE user_id=NEW.driver_id FOR UPDATE;
    IF current_balance-NEW.commission < -100000 THEN RAISE EXCEPTION 'سقف بدهی کمیسیون ۱۰۰ هزار تومان است؛ ابتدا کیف پول را تسویه کنید'; END IF;
    INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
    VALUES(NEW.driver_id,-NEW.commission,'commission',NEW.id,'کمیسیون ۱۰٪ سفر نقدی') ON CONFLICT DO NOTHING;
    IF FOUND THEN
      UPDATE public.wallet_accounts SET balance=balance-NEW.commission,updated_at=now() WHERE user_id=NEW.driver_id;
      UPDATE public.platform_revenue SET balance=balance+NEW.commission,updated_at=now() WHERE id=true;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- Acceptance must not be blocked by an inactive wallet/debt-limit subsystem.
CREATE OR REPLACE FUNCTION public.check_driver_commission_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE available_balance bigint; committed_commission bigint; debt_platform_share bigint;
BEGIN
  IF NOT public.billing_wallet_enabled() THEN RETURN NEW; END IF;
  IF OLD.status IS DISTINCT FROM 'accepted' AND NEW.status='accepted'
     AND NEW.driver_id IS NOT NULL AND NEW.payment_method='cash' THEN
    INSERT INTO public.wallet_accounts(user_id) VALUES(NEW.driver_id) ON CONFLICT DO NOTHING;
    SELECT balance INTO available_balance FROM public.wallet_accounts WHERE user_id=NEW.driver_id FOR UPDATE;
    SELECT coalesce(sum(commission),0) INTO committed_commission FROM public.trips
      WHERE driver_id=NEW.driver_id AND payment_method='cash' AND status IN ('accepted','ongoing') AND id<>NEW.id;
    SELECT coalesce(sum(platform_amount),0) INTO debt_platform_share FROM public.passenger_cancellation_debts
      WHERE passenger_id=NEW.passenger_id AND status='open';
    IF available_balance-committed_commission-NEW.commission-debt_platform_share < -100000 THEN
      RAISE EXCEPTION 'با احتساب کمیسیون سفر و سهم سامانه از بدهی قبلی، سقف بدهی کیف پول راننده رد می‌شود';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- In cash-only mode the driver collects the prior cancellation debt in cash.
-- Mark it settled without creating or debiting wallet entries.
CREATE OR REPLACE FUNCTION public.settle_passenger_cancellation_debts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d record;
BEGIN
  IF OLD.status IS DISTINCT FROM 'done' AND NEW.status='done' AND NEW.prior_debt_amount>0 THEN
    FOR d IN SELECT * FROM public.passenger_cancellation_debts
      WHERE passenger_id=NEW.passenger_id AND status='open' FOR UPDATE
    LOOP
      IF public.billing_wallet_enabled() THEN
        INSERT INTO public.wallet_accounts(user_id) VALUES(d.driver_id) ON CONFLICT DO NOTHING;
        IF NEW.payment_method='wallet' THEN
          INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
          VALUES(d.driver_id,d.driver_amount,'cancellation_penalty',d.source_trip_id,'سهم راننده از جریمه لغو قبلی') ON CONFLICT DO NOTHING;
          IF FOUND THEN
            UPDATE public.wallet_accounts SET balance=balance+d.driver_amount,updated_at=now() WHERE user_id=d.driver_id;
            UPDATE public.platform_revenue SET balance=balance+d.platform_amount,updated_at=now() WHERE id=true;
          END IF;
        ELSE
          INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
          VALUES(d.driver_id,-d.platform_amount,'commission',d.source_trip_id,'۱۰٪ سهم سامانه از جریمه نقدی لغو قبلی') ON CONFLICT DO NOTHING;
          IF FOUND THEN
            UPDATE public.wallet_accounts SET balance=balance-d.platform_amount,updated_at=now() WHERE user_id=d.driver_id;
            UPDATE public.platform_revenue SET balance=balance+d.platform_amount,updated_at=now() WHERE id=true;
          END IF;
        END IF;
      END IF;
      UPDATE public.passenger_cancellation_debts
      SET status='settled',settled_by_trip_id=NEW.id,settled_at=now() WHERE id=d.id;
    END LOOP;
  END IF;
  RETURN NEW;
END; $$;

-- Keep wallet-only RPCs for future releases, but fail closed while disabled.
CREATE OR REPLACE FUNCTION public.request_wallet_withdrawal(p_amount bigint,p_card text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid;
BEGIN
  IF NOT public.billing_wallet_enabled() THEN RAISE EXCEPTION 'کیف پول در نسخه فعلی غیرفعال است'; END IF;
  IF auth.uid() IS NULL OR p_amount<50000 OR p_card !~ '^[0-9]{16}$' THEN RAISE EXCEPTION 'مبلغ حداقل ۵۰ هزار تومان و شماره کارت ۱۶ رقمی لازم است'; END IF;
  INSERT INTO public.wallet_accounts(user_id) VALUES(auth.uid()) ON CONFLICT DO NOTHING;
  IF (SELECT balance FROM public.wallet_accounts WHERE user_id=auth.uid() FOR UPDATE)<p_amount THEN RAISE EXCEPTION 'موجودی کیف پول کافی نیست'; END IF;
  INSERT INTO public.wallet_withdrawal_requests(user_id,amount,card_number) VALUES(auth.uid(),p_amount,p_card) RETURNING id INTO rid;
  RETURN rid;
END; $$;
REVOKE ALL ON FUNCTION public.request_wallet_withdrawal(bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_wallet_withdrawal(bigint,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_wallet_withdrawal(p_request uuid,p_status text,p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w public.wallet_withdrawal_requests;
BEGIN
  IF NOT public.billing_wallet_enabled() THEN RAISE EXCEPTION 'کیف پول در نسخه فعلی غیرفعال است'; END IF;
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

-- Wallet data is invisible to both users and admins while the integration is disabled.
DROP POLICY IF EXISTS wallet_self_read ON public.wallet_accounts;
CREATE POLICY wallet_self_read ON public.wallet_accounts FOR SELECT TO authenticated USING (user_id=auth.uid() AND public.billing_wallet_enabled());
DROP POLICY IF EXISTS wallet_admin_read ON public.wallet_accounts;
CREATE POLICY wallet_admin_read ON public.wallet_accounts FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') AND public.billing_wallet_enabled());
DROP POLICY IF EXISTS wallet_transactions_self_read ON public.wallet_transactions;
CREATE POLICY wallet_transactions_self_read ON public.wallet_transactions FOR SELECT TO authenticated USING (user_id=auth.uid() AND public.billing_wallet_enabled());
DROP POLICY IF EXISTS wallet_transactions_admin_read ON public.wallet_transactions;
CREATE POLICY wallet_transactions_admin_read ON public.wallet_transactions FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') AND public.billing_wallet_enabled());
DROP POLICY IF EXISTS wallet_withdrawal_self_read ON public.wallet_withdrawal_requests;
CREATE POLICY wallet_withdrawal_self_read ON public.wallet_withdrawal_requests FOR SELECT TO authenticated USING (user_id=auth.uid() AND public.billing_wallet_enabled());
DROP POLICY IF EXISTS wallet_withdrawal_self_insert ON public.wallet_withdrawal_requests;
CREATE POLICY wallet_withdrawal_self_insert ON public.wallet_withdrawal_requests FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid() AND status='pending' AND reviewed_at IS NULL AND public.billing_wallet_enabled());
DROP POLICY IF EXISTS admin_wallet_withdrawal_read ON public.wallet_withdrawal_requests;
CREATE POLICY admin_wallet_withdrawal_read ON public.wallet_withdrawal_requests FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') AND public.billing_wallet_enabled());
DROP POLICY IF EXISTS platform_revenue_admin_read ON public.platform_revenue;
CREATE POLICY platform_revenue_admin_read ON public.platform_revenue FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') AND public.billing_wallet_enabled());
