-- Manual driver commission accounting and card-to-card settlement.
-- This ledger is independent of the optional wallet/payment gateway.

CREATE TABLE IF NOT EXISTS public.platform_commission_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  driver_debt_limit bigint NOT NULL DEFAULT 100000 CHECK (driver_debt_limit BETWEEN 10000 AND 1000000000),
  settlement_card_number text NOT NULL DEFAULT '' CHECK (settlement_card_number = '' OR settlement_card_number ~ '^[0-9]{16}$'),
  settlement_card_holder text NOT NULL DEFAULT '' CHECK (length(settlement_card_holder) <= 120),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
INSERT INTO public.platform_commission_settings(id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.driver_commission_accounts (
  driver_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  outstanding bigint NOT NULL DEFAULT 0 CHECK (outstanding >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_commission_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount bigint NOT NULL CHECK (amount > 0),
  receipt_path text NOT NULL,
  transfer_reference text NOT NULL CHECK (length(trim(transfer_reference)) BETWEEN 4 AND 100),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  review_note text
);
CREATE INDEX IF NOT EXISTS driver_commission_settlements_driver_created
  ON public.driver_commission_settlements(driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS driver_commission_settlements_status_created
  ON public.driver_commission_settlements(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.driver_commission_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount bigint NOT NULL CHECK (amount <> 0),
  kind text NOT NULL CHECK (kind IN ('trip_commission','settlement')),
  trip_id uuid REFERENCES public.trips(id),
  settlement_id uuid REFERENCES public.driver_commission_settlements(id),
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind='trip_commission' AND amount > 0 AND trip_id IS NOT NULL AND settlement_id IS NULL)
    OR
    (kind='settlement' AND amount < 0 AND settlement_id IS NOT NULL AND trip_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS driver_commission_trip_once
  ON public.driver_commission_transactions(trip_id) WHERE kind='trip_commission';
CREATE UNIQUE INDEX IF NOT EXISTS driver_commission_settlement_once
  ON public.driver_commission_transactions(settlement_id) WHERE kind='settlement';
CREATE INDEX IF NOT EXISTS driver_commission_transactions_driver_created
  ON public.driver_commission_transactions(driver_id, created_at DESC);

ALTER TABLE public.platform_commission_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_commission_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_commission_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_commission_transactions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.platform_commission_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.driver_commission_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.driver_commission_settlements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.driver_commission_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.platform_commission_settings, public.driver_commission_accounts,
  public.driver_commission_settlements, public.driver_commission_transactions TO authenticated;
GRANT ALL ON public.platform_commission_settings, public.driver_commission_accounts,
  public.driver_commission_settlements, public.driver_commission_transactions TO service_role;

CREATE POLICY commission_settings_admin_read ON public.platform_commission_settings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY driver_commission_account_read ON public.driver_commission_accounts
  FOR SELECT TO authenticated USING (driver_id=auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY driver_commission_settlement_read ON public.driver_commission_settlements
  FOR SELECT TO authenticated USING (driver_id=auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY driver_commission_transaction_read ON public.driver_commission_transactions
  FOR SELECT TO authenticated USING (driver_id=auth.uid() OR public.has_role(auth.uid(),'admin'));

INSERT INTO public.driver_commission_accounts(driver_id,outstanding)
SELECT driver_id, coalesce(sum(commission),0)::bigint
FROM public.trips
WHERE status='done' AND payment_method='cash' AND driver_id IS NOT NULL AND commission>0
GROUP BY driver_id
ON CONFLICT (driver_id) DO UPDATE
SET outstanding=EXCLUDED.outstanding, updated_at=now();

INSERT INTO public.driver_commission_transactions(driver_id,amount,kind,trip_id,description)
SELECT driver_id, commission::bigint, 'trip_commission', id, 'کمیسیون سفر نقدی (ثبت سوابق قبلی)'
FROM public.trips
WHERE status='done' AND payment_method='cash' AND driver_id IS NOT NULL AND commission>0
ON CONFLICT DO NOTHING;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('commission-settlement-receipts','commission-settlement-receipts',false,8388608,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=8388608,allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS commission_receipts_driver_insert ON storage.objects;
CREATE POLICY commission_receipts_driver_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id='commission-settlement-receipts'
    AND (storage.foldername(name))[1]=(auth.uid())::text
    AND public.has_role(auth.uid(),'driver')
  );
DROP POLICY IF EXISTS commission_receipts_owner_read ON storage.objects;
CREATE POLICY commission_receipts_owner_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id='commission-settlement-receipts'
    AND (
      (storage.foldername(name))[1]=(auth.uid())::text
      OR public.has_role(auth.uid(),'admin')
    )
  );

CREATE OR REPLACE FUNCTION public.get_driver_commission_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
DECLARE v_limit bigint; v_outstanding bigint; v_reserved bigint; v_pending bigint;
        v_card text; v_holder text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'driver') THEN
    RAISE EXCEPTION 'حساب راننده لازم است';
  END IF;
  SELECT driver_debt_limit,settlement_card_number,settlement_card_holder
    INTO v_limit,v_card,v_holder
  FROM public.platform_commission_settings WHERE id=true;
  SELECT coalesce(outstanding,0) INTO v_outstanding
    FROM public.driver_commission_accounts WHERE driver_id=auth.uid();
  v_outstanding:=coalesce(v_outstanding,0);
  SELECT coalesce(sum(commission),0)::bigint INTO v_reserved
    FROM public.trips
    WHERE driver_id=auth.uid() AND payment_method='cash'
      AND status IN ('accepted','ongoing');
  SELECT coalesce(sum(amount),0)::bigint INTO v_pending
    FROM public.driver_commission_settlements
    WHERE driver_id=auth.uid() AND status='pending';
  RETURN jsonb_build_object(
    'limit',coalesce(v_limit,100000),
    'outstanding',v_outstanding,
    'reserved',coalesce(v_reserved,0),
    'pendingSettlement',coalesce(v_pending,0),
    'available',greatest(coalesce(v_limit,100000)-v_outstanding-coalesce(v_reserved,0),0),
    'settlementCardNumber',coalesce(v_card,''),
    'settlementCardHolder',coalesce(v_holder,'')
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_driver_commission_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_driver_commission_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_driver_commission_settings(
  p_limit bigint,p_card_number text,p_card_holder text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'دسترسی مدیر لازم است';
  END IF;
  IF p_limit IS NULL OR p_limit<10000 OR p_limit>1000000000 THEN
    RAISE EXCEPTION 'سقف بدهی باید بین ۱۰ هزار تا یک میلیارد تومان باشد';
  END IF;
  IF coalesce(p_card_number,'')<>'' AND p_card_number !~ '^[0-9]{16}$' THEN
    RAISE EXCEPTION 'شماره کارت مقصد باید ۱۶ رقم باشد';
  END IF;
  IF length(coalesce(p_card_holder,''))>120 THEN RAISE EXCEPTION 'نام صاحب کارت بیش از حد طولانی است'; END IF;
  UPDATE public.platform_commission_settings
  SET driver_debt_limit=p_limit,
      settlement_card_number=coalesce(p_card_number,''),
      settlement_card_holder=coalesce(trim(p_card_holder),''),
      updated_at=now(),updated_by=auth.uid()
  WHERE id=true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_set_driver_commission_settings(bigint,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_driver_commission_settings(bigint,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_driver_commission_settlement(
  p_amount bigint,p_receipt_path text,p_transfer_reference text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,storage
AS $fn$
DECLARE v_outstanding bigint; v_pending bigint; v_card text; rid uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'driver') THEN
    RAISE EXCEPTION 'فقط راننده می‌تواند درخواست تسویه ثبت کند';
  END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_amount>1000000000
     OR p_transfer_reference IS NULL OR length(trim(p_transfer_reference)) NOT BETWEEN 4 AND 100
     OR p_receipt_path IS NULL OR (storage.foldername(p_receipt_path))[1]<>(auth.uid())::text THEN
    RAISE EXCEPTION 'مبلغ، شناسه پیگیری و رسید معتبر لازم است';
  END IF;
  SELECT settlement_card_number INTO v_card FROM public.platform_commission_settings WHERE id=true;
  IF coalesce(v_card,'')='' THEN RAISE EXCEPTION 'اطلاعات کارت مقصد هنوز توسط مدیر ثبت نشده است'; END IF;
  INSERT INTO public.driver_commission_accounts(driver_id) VALUES(auth.uid()) ON CONFLICT DO NOTHING;
  SELECT outstanding INTO v_outstanding FROM public.driver_commission_accounts WHERE driver_id=auth.uid() FOR UPDATE;
  SELECT coalesce(sum(amount),0) INTO v_pending FROM public.driver_commission_settlements
    WHERE driver_id=auth.uid() AND status='pending';
  IF p_amount>v_outstanding-v_pending THEN RAISE EXCEPTION 'مبلغ تسویه از بدهی کمیسیونِ تسویه‌نشده بیشتر است'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id='commission-settlement-receipts' AND name=p_receipt_path
  ) THEN RAISE EXCEPTION 'تصویر رسید واریز در فضای خصوصی ثبت نشده است'; END IF;
  INSERT INTO public.driver_commission_settlements(driver_id,amount,receipt_path,transfer_reference)
  VALUES(auth.uid(),p_amount,p_receipt_path,trim(p_transfer_reference))
  RETURNING id INTO rid;
  RETURN rid;
END;
$fn$;
REVOKE ALL ON FUNCTION public.request_driver_commission_settlement(bigint,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_driver_commission_settlement(bigint,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_driver_commission_settlement(
  p_request uuid,p_status text,p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
DECLARE s public.driver_commission_settlements; v_balance bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'دسترسی مدیر لازم است';
  END IF;
  IF p_status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'وضعیت بررسی نامعتبر است'; END IF;
  SELECT * INTO s FROM public.driver_commission_settlements WHERE id=p_request FOR UPDATE;
  IF NOT FOUND OR s.status<>'pending' THEN RAISE EXCEPTION 'درخواست قبلاً بررسی شده یا وجود ندارد'; END IF;
  IF p_status='approved' THEN
    SELECT outstanding INTO v_balance FROM public.driver_commission_accounts WHERE driver_id=s.driver_id FOR UPDATE;
    IF NOT FOUND OR v_balance<s.amount THEN RAISE EXCEPTION 'بدهی فعلی راننده برای این مبلغ کافی نیست'; END IF;
    UPDATE public.driver_commission_accounts SET outstanding=outstanding-s.amount,updated_at=now()
      WHERE driver_id=s.driver_id;
    INSERT INTO public.driver_commission_transactions(driver_id,amount,kind,settlement_id,description)
      VALUES(s.driver_id,-s.amount,'settlement',s.id,'تسویه کمیسیون با کارت‌به‌کارت');
  END IF;
  UPDATE public.driver_commission_settlements
  SET status=p_status,reviewed_at=now(),reviewed_by=auth.uid(),review_note=left(coalesce(p_note,''),500)
  WHERE id=p_request;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_review_driver_commission_settlement(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_review_driver_commission_settlement(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_driver_commission_on_trip_done()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
BEGIN
  IF OLD.status IS DISTINCT FROM 'done' AND NEW.status='done'
     AND NEW.payment_method='cash' AND NEW.driver_id IS NOT NULL AND NEW.commission>0 THEN
    INSERT INTO public.driver_commission_accounts(driver_id) VALUES(NEW.driver_id) ON CONFLICT DO NOTHING;
    INSERT INTO public.driver_commission_transactions(driver_id,amount,kind,trip_id,description)
      VALUES(NEW.driver_id,NEW.commission,'trip_commission',NEW.id,'کمیسیون ۱۰٪ سفر نقدی')
      ON CONFLICT DO NOTHING;
    IF FOUND THEN
      UPDATE public.driver_commission_accounts
      SET outstanding=outstanding+NEW.commission,updated_at=now()
      WHERE driver_id=NEW.driver_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_driver_commission_on_trip_done() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trip_done_record_driver_commission ON public.trips;
CREATE TRIGGER trip_done_record_driver_commission
  AFTER UPDATE OF status ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.record_driver_commission_on_trip_done();

CREATE OR REPLACE FUNCTION public.check_driver_commission_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
DECLARE v_limit bigint; v_outstanding bigint; v_reserved bigint;
BEGIN
  IF OLD.status IS DISTINCT FROM 'accepted' AND NEW.status='accepted'
     AND NEW.driver_id IS NOT NULL AND NEW.payment_method='cash' THEN
    INSERT INTO public.driver_commission_accounts(driver_id) VALUES(NEW.driver_id) ON CONFLICT DO NOTHING;
    SELECT outstanding INTO v_outstanding
      FROM public.driver_commission_accounts WHERE driver_id=NEW.driver_id FOR UPDATE;
    SELECT driver_debt_limit INTO v_limit
      FROM public.platform_commission_settings WHERE id=true;
    SELECT coalesce(sum(commission),0)::bigint INTO v_reserved
      FROM public.trips
      WHERE driver_id=NEW.driver_id AND payment_method='cash'
        AND status IN ('accepted','ongoing') AND id<>NEW.id;
    IF coalesce(v_outstanding,0)+coalesce(v_reserved,0)+NEW.commission>coalesce(v_limit,100000) THEN
      RAISE EXCEPTION 'سقف بدهی کمیسیون شما پر می‌شود؛ ابتدا با کارت‌به‌کارت تسویه و رسید را ثبت کنید';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.check_driver_commission_limit() FROM PUBLIC,anon,authenticated;
