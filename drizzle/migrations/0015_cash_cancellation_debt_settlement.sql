-- Cash debt is collected by the driver in cash: only the platform's 10% is debited
-- from the driver's wallet. Wallet-paid debt is split into a 90% wallet credit and 10% revenue.
CREATE OR REPLACE FUNCTION public.settle_passenger_cancellation_debts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d record;
BEGIN
 IF OLD.status IS DISTINCT FROM 'done' AND NEW.status='done' AND NEW.prior_debt_amount>0 THEN
  FOR d IN SELECT * FROM public.passenger_cancellation_debts
   WHERE passenger_id=NEW.passenger_id AND status='open' FOR UPDATE
  LOOP
   INSERT INTO public.wallet_accounts(user_id) VALUES(d.driver_id) ON CONFLICT DO NOTHING;
   IF NEW.payment_method='wallet' THEN
    INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
    VALUES(d.driver_id,d.driver_amount,'cancellation_penalty',d.source_trip_id,'سهم راننده از جریمه لغو قبلی')
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
     UPDATE public.wallet_accounts SET balance=balance+d.driver_amount,updated_at=now() WHERE user_id=d.driver_id;
     UPDATE public.platform_revenue SET balance=balance+d.platform_amount,updated_at=now() WHERE id=true;
    END IF;
   ELSE
    -- The driver already collected the full debt in cash; remit the platform's 10% only.
    INSERT INTO public.wallet_transactions(user_id,amount,kind,reference_id,description)
    VALUES(d.driver_id,-d.platform_amount,'commission',d.source_trip_id,'۱۰٪ سهم سامانه از جریمه نقدی لغو قبلی')
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
     UPDATE public.wallet_accounts SET balance=balance-d.platform_amount,updated_at=now() WHERE user_id=d.driver_id;
     UPDATE public.platform_revenue SET balance=balance+d.platform_amount,updated_at=now() WHERE id=true;
    END IF;
   END IF;
   UPDATE public.passenger_cancellation_debts
   SET status='settled',settled_by_trip_id=NEW.id,settled_at=now() WHERE id=d.id;
  END LOOP;
 END IF;
 RETURN NEW;
END; $$;

-- Reserve enough of the driver's commission allowance for the platform share of cash debts.
CREATE OR REPLACE FUNCTION public.check_driver_commission_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE available_balance bigint; committed_commission bigint; debt_platform_share bigint;
BEGIN
 IF OLD.status IS DISTINCT FROM 'accepted' AND NEW.status='accepted'
 AND NEW.driver_id IS NOT NULL AND NEW.payment_method='cash' THEN
  INSERT INTO public.wallet_accounts(user_id) VALUES(NEW.driver_id) ON CONFLICT DO NOTHING;
  SELECT balance INTO available_balance FROM public.wallet_accounts WHERE user_id=NEW.driver_id FOR UPDATE;
  SELECT coalesce(sum(commission),0) INTO committed_commission FROM public.trips
   WHERE driver_id=NEW.driver_id AND payment_method='cash'
   AND status IN ('accepted','ongoing') AND id<>NEW.id;
  SELECT coalesce(sum(platform_amount),0) INTO debt_platform_share
   FROM public.passenger_cancellation_debts
   WHERE passenger_id=NEW.passenger_id AND status='open';
  IF available_balance-committed_commission-NEW.commission-debt_platform_share < -100000 THEN
   RAISE EXCEPTION 'با احتساب کمیسیون سفر و سهم سامانه از بدهی قبلی، سقف بدهی کیف پول راننده رد می‌شود';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
