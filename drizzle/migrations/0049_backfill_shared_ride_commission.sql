-- Backfill any completed shared rides that predate the shared-ride commission ledger.
INSERT INTO public.driver_commission_accounts(driver_id,outstanding)
SELECT driver_id,coalesce(sum(round(total_fare*0.10)::bigint),0)::bigint
FROM public.shared_rides
WHERE state='done' AND driver_id IS NOT NULL AND total_fare>0
GROUP BY driver_id
ON CONFLICT (driver_id) DO UPDATE
SET outstanding=public.driver_commission_accounts.outstanding+EXCLUDED.outstanding,
    updated_at=now();

INSERT INTO public.driver_commission_transactions(driver_id,amount,kind,shared_ride_id,description)
SELECT driver_id,round(total_fare*0.10)::bigint,'shared_ride_commission',id,'کمیسیون ۱۰٪ سفر اشتراکی (ثبت سوابق قبلی)'
FROM public.shared_rides
WHERE state='done' AND driver_id IS NOT NULL AND total_fare>0
ON CONFLICT DO NOTHING;
