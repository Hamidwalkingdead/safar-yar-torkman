-- Admin-managed pricing, commission, and night window.
ALTER TABLE public.platform_commission_settings
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5,4) NOT NULL DEFAULT 0.1000,
  ADD COLUMN IF NOT EXISTS minimum_fare bigint NOT NULL DEFAULT 80000,
  ADD COLUMN IF NOT EXISTS standard_per_km bigint NOT NULL DEFAULT 14000,
  ADD COLUMN IF NOT EXISTS mountain_per_km bigint NOT NULL DEFAULT 16000,
  ADD COLUMN IF NOT EXISTS night_surcharge_per_km bigint NOT NULL DEFAULT 1500,
  ADD COLUMN IF NOT EXISTS long_distance_threshold_km integer NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS long_distance_per_km bigint NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS night_start_hour smallint NOT NULL DEFAULT 22,
  ADD COLUMN IF NOT EXISTS night_end_hour smallint NOT NULL DEFAULT 6;

ALTER TABLE public.platform_commission_settings
  DROP CONSTRAINT IF EXISTS platform_commission_settings_commission_rate_check,
  ADD CONSTRAINT platform_commission_settings_commission_rate_check CHECK (commission_rate BETWEEN 0 AND 0.50),
  DROP CONSTRAINT IF EXISTS platform_commission_settings_minimum_fare_check,
  ADD CONSTRAINT platform_commission_settings_minimum_fare_check CHECK (minimum_fare BETWEEN 10000 AND 100000000),
  DROP CONSTRAINT IF EXISTS platform_commission_settings_standard_per_km_check,
  ADD CONSTRAINT platform_commission_settings_standard_per_km_check CHECK (standard_per_km BETWEEN 1000 AND 10000000),
  DROP CONSTRAINT IF EXISTS platform_commission_settings_mountain_per_km_check,
  ADD CONSTRAINT platform_commission_settings_mountain_per_km_check CHECK (mountain_per_km BETWEEN 1000 AND 10000000),
  DROP CONSTRAINT IF EXISTS platform_commission_settings_night_surcharge_per_km_check,
  ADD CONSTRAINT platform_commission_settings_night_surcharge_per_km_check CHECK (night_surcharge_per_km BETWEEN 0 AND 10000000),
  DROP CONSTRAINT IF EXISTS platform_commission_settings_long_distance_threshold_km_check,
  ADD CONSTRAINT platform_commission_settings_long_distance_threshold_km_check CHECK (long_distance_threshold_km BETWEEN 1 AND 3000),
  DROP CONSTRAINT IF EXISTS platform_commission_settings_long_distance_per_km_check,
  ADD CONSTRAINT platform_commission_settings_long_distance_per_km_check CHECK (long_distance_per_km BETWEEN 0 AND 10000000),
  DROP CONSTRAINT IF EXISTS platform_commission_settings_night_hours_check,
  ADD CONSTRAINT platform_commission_settings_night_hours_check CHECK (night_start_hour BETWEEN 1 AND 23 AND night_end_hour BETWEEN 0 AND 22 AND night_start_hour > night_end_hour);

CREATE OR REPLACE FUNCTION public.get_public_pricing_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'commission_rate', commission_rate,
    'minimum_fare', minimum_fare,
    'standard_per_km', standard_per_km,
    'mountain_per_km', mountain_per_km,
    'night_surcharge_per_km', night_surcharge_per_km,
    'long_distance_threshold_km', long_distance_threshold_km,
    'long_distance_per_km', long_distance_per_km,
    'night_start_hour', night_start_hour,
    'night_end_hour', night_end_hour
  )
  FROM public.platform_commission_settings
  WHERE id = true;
$$;
REVOKE ALL ON FUNCTION public.get_public_pricing_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_pricing_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_platform_settings(
  p_driver_debt_limit bigint,
  p_card_number text,
  p_card_holder text,
  p_commission_rate numeric,
  p_minimum_fare bigint,
  p_standard_per_km bigint,
  p_mountain_per_km bigint,
  p_night_surcharge_per_km bigint,
  p_long_distance_threshold_km integer,
  p_long_distance_per_km bigint,
  p_night_start_hour smallint,
  p_night_end_hour smallint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'دسترسی مدیر لازم است';
  END IF;
  IF p_driver_debt_limit IS NULL OR p_driver_debt_limit NOT BETWEEN 10000 AND 1000000000 THEN
    RAISE EXCEPTION 'سقف بدهی کمیسیون نامعتبر است';
  END IF;
  IF coalesce(p_card_number, '') <> '' AND p_card_number !~ '^[0-9]{16}$' THEN
    RAISE EXCEPTION 'شماره کارت مقصد باید ۱۶ رقم باشد';
  END IF;
  IF length(coalesce(p_card_holder, '')) > 120 THEN
    RAISE EXCEPTION 'نام صاحب کارت بیش از حد طولانی است';
  END IF;
  IF p_commission_rate IS NULL OR p_commission_rate NOT BETWEEN 0 AND 0.50
     OR p_minimum_fare IS NULL OR p_minimum_fare NOT BETWEEN 10000 AND 100000000
     OR p_standard_per_km IS NULL OR p_standard_per_km NOT BETWEEN 1000 AND 10000000
     OR p_mountain_per_km IS NULL OR p_mountain_per_km NOT BETWEEN 1000 AND 10000000
     OR p_night_surcharge_per_km IS NULL OR p_night_surcharge_per_km NOT BETWEEN 0 AND 10000000
     OR p_long_distance_threshold_km IS NULL OR p_long_distance_threshold_km NOT BETWEEN 1 AND 3000
     OR p_long_distance_per_km IS NULL OR p_long_distance_per_km NOT BETWEEN 0 AND 10000000
     OR p_night_start_hour IS NULL OR p_night_start_hour NOT BETWEEN 1 AND 23
     OR p_night_end_hour IS NULL OR p_night_end_hour NOT BETWEEN 0 AND 22
     OR p_night_start_hour <= p_night_end_hour THEN
    RAISE EXCEPTION 'یکی از تعرفه‌ها یا ساعت شب نامعتبر است؛ ساعت شروع شب باید از ساعت پایان بیشتر باشد';
  END IF;

  UPDATE public.platform_commission_settings
  SET driver_debt_limit = p_driver_debt_limit,
      settlement_card_number = coalesce(p_card_number, ''),
      settlement_card_holder = coalesce(trim(p_card_holder), ''),
      commission_rate = p_commission_rate,
      minimum_fare = p_minimum_fare,
      standard_per_km = p_standard_per_km,
      mountain_per_km = p_mountain_per_km,
      night_surcharge_per_km = p_night_surcharge_per_km,
      long_distance_threshold_km = p_long_distance_threshold_km,
      long_distance_per_km = p_long_distance_per_km,
      night_start_hour = p_night_start_hour,
      night_end_hour = p_night_end_hour,
      updated_at = now(),
      updated_by = auth.uid()
  WHERE id = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'ردیف تنظیمات سامانه پیدا نشد'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_platform_settings(bigint,text,text,numeric,bigint,bigint,bigint,bigint,integer,bigint,smallint,smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_platform_settings(bigint,text,text,numeric,bigint,bigint,bigint,bigint,integer,bigint,smallint,smallint) TO authenticated;

-- This function is now STABLE because its result is read from the live settings row.
CREATE OR REPLACE FUNCTION public.trip_fare(p_km numeric, p_night boolean, p_mountain boolean)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT greatest(
    coalesce((SELECT minimum_fare FROM public.platform_commission_settings WHERE id = true), 80000),
    round(
      p_km * CASE WHEN p_mountain
        THEN coalesce((SELECT mountain_per_km FROM public.platform_commission_settings WHERE id = true), 16000)
        ELSE coalesce((SELECT standard_per_km FROM public.platform_commission_settings WHERE id = true), 14000)
      END
      + CASE WHEN p_night THEN p_km * coalesce((SELECT night_surcharge_per_km FROM public.platform_commission_settings WHERE id = true), 1500) ELSE 0 END
      + greatest(0, p_km - coalesce((SELECT long_distance_threshold_km FROM public.platform_commission_settings WHERE id = true), 300))
        * coalesce((SELECT long_distance_per_km FROM public.platform_commission_settings WHERE id = true), 1000)
    )::integer
  );
$$;

-- Replace the fixed 10% commission in the canonical trip creator.
DO $$
DECLARE definition text;
BEGIN
  definition := pg_get_functiondef(
    'public.create_trip(text,text,timestamp with time zone,numeric,boolean,boolean,integer,text)'::regprocedure
  );
  definition := replace(definition,
    'round(fare*0.1)::integer',
    'round(fare*coalesce((SELECT commission_rate FROM public.platform_commission_settings WHERE id=true),0.1))::integer'
  );
  definition := replace(definition,
    'fare-round(fare*0.1)',
    'fare-round(fare*coalesce((SELECT commission_rate FROM public.platform_commission_settings WHERE id=true),0.1))'
  );
  EXECUTE definition;

  definition := pg_get_functiondef(
    'public.create_trip(text,text,timestamp with time zone,numeric,boolean,boolean,double precision,double precision,double precision,double precision,integer,text,text)'::regprocedure
  );
  definition := replace(definition,
    'EXTRACT(HOUR FROM p_departure AT TIME ZONE ''Asia/Tehran'') >= 22',
    'EXTRACT(HOUR FROM p_departure AT TIME ZONE ''Asia/Tehran'') >= (SELECT night_start_hour FROM public.platform_commission_settings WHERE id=true)'
  );
  definition := replace(definition,
    'EXTRACT(HOUR FROM p_departure AT TIME ZONE ''Asia/Tehran'') < 6',
    'EXTRACT(HOUR FROM p_departure AT TIME ZONE ''Asia/Tehran'') < (SELECT night_end_hour FROM public.platform_commission_settings WHERE id=true)'
  );
  EXECUTE definition;
END;
$$;

-- Keep the driver approach leg of shared rides aligned with the editable tariff.
DO $$
DECLARE definition text;
BEGIN
  definition := pg_get_functiondef(
    'public.accept_shared_ride_with_approach(uuid,uuid,double precision,double precision,numeric)'::regprocedure
  );
  definition := replace(definition,
    'EXTRACT(HOUR FROM r.departure_at AT TIME ZONE ''Asia/Tehran'')>=22',
    'EXTRACT(HOUR FROM r.departure_at AT TIME ZONE ''Asia/Tehran'') >= (SELECT night_start_hour FROM public.platform_commission_settings WHERE id=true)'
  );
  definition := replace(definition,
    'EXTRACT(HOUR FROM r.departure_at AT TIME ZONE ''Asia/Tehran'')<6',
    'EXTRACT(HOUR FROM r.departure_at AT TIME ZONE ''Asia/Tehran'') < (SELECT night_end_hour FROM public.platform_commission_settings WHERE id=true)'
  );
  definition := replace(definition, 'p_approach_km*14000',
    'p_approach_km*(SELECT standard_per_km FROM public.platform_commission_settings WHERE id=true)');
  definition := replace(definition, 'p_approach_km*1500',
    'p_approach_km*(SELECT night_surcharge_per_km FROM public.platform_commission_settings WHERE id=true)');
  definition := replace(definition, 'p_approach_km-300',
    'p_approach_km-(SELECT long_distance_threshold_km FROM public.platform_commission_settings WHERE id=true)');
  definition := replace(definition, ')*1000',
    ')*(SELECT long_distance_per_km FROM public.platform_commission_settings WHERE id=true)');
  EXECUTE definition;

  definition := pg_get_functiondef('public.record_driver_commission_on_shared_ride_done()'::regprocedure);
  definition := replace(definition, 'round(NEW.total_fare*0.10)::bigint',
    'round(NEW.total_fare*(SELECT commission_rate FROM public.platform_commission_settings WHERE id=true))::bigint');
  definition := replace(definition, 'کمیسیون ۱۰٪ سفر اشتراکی', 'کمیسیون سفر اشتراکی');
  EXECUTE definition;

  definition := pg_get_functiondef('public.check_driver_commission_limit()'::regprocedure);
  definition := replace(definition, 'round(total_fare*0.10)::bigint',
    'round(total_fare*(SELECT commission_rate FROM public.platform_commission_settings WHERE id=true))::bigint');
  EXECUTE definition;

  definition := pg_get_functiondef('public.check_shared_ride_driver_commission_limit()'::regprocedure);
  definition := replace(definition, 'round(total_fare*0.10)::bigint',
    'round(total_fare*(SELECT commission_rate FROM public.platform_commission_settings WHERE id=true))::bigint');
  definition := replace(definition, 'round(NEW.total_fare*0.10)::bigint',
    'round(NEW.total_fare*(SELECT commission_rate FROM public.platform_commission_settings WHERE id=true))::bigint');
  EXECUTE definition;
END;
$$;

COMMENT ON COLUMN public.platform_commission_settings.commission_rate IS 'Platform commission as a fraction, e.g. 0.10 for 10 percent.';
COMMENT ON COLUMN public.platform_commission_settings.night_start_hour IS 'Start of overnight pricing in Asia/Tehran local hour.';
COMMENT ON COLUMN public.platform_commission_settings.night_end_hour IS 'End of overnight pricing in Asia/Tehran local hour.';
