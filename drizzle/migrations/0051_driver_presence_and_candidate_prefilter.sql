-- Private online-driver presence, separate from active-trip tracking.
-- Raw coordinates are visible only to the driver and administrators; candidate
-- discovery is restricted to trusted server-side callers.
CREATE TABLE IF NOT EXISTS public.driver_presence (
  driver_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  latitude double precision NOT NULL CHECK (latitude BETWEEN 24 AND 40.5),
  longitude double precision NOT NULL CHECK (longitude BETWEEN 43 AND 64),
  accuracy_m double precision CHECK (accuracy_m IS NULL OR accuracy_m BETWEEN 0 AND 10000),
  heading_deg double precision CHECK (heading_deg IS NULL OR heading_deg BETWEEN 0 AND 360),
  is_online boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_presence_online_fresh_idx
  ON public.driver_presence (last_seen_at DESC)
  WHERE is_online = true;

ALTER TABLE public.driver_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_presence FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.driver_presence TO authenticated;
GRANT ALL ON public.driver_presence TO service_role;

CREATE POLICY driver_presence_owner_read ON public.driver_presence
  FOR SELECT TO authenticated USING (driver_id = auth.uid());
CREATE POLICY driver_presence_admin_read ON public.driver_presence
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY driver_presence_owner_insert ON public.driver_presence
  FOR INSERT TO authenticated
  WITH CHECK (
    driver_id = auth.uid()
    AND public.has_role(auth.uid(), 'driver')
    AND public.is_driver_fully_approved(auth.uid())
  );
CREATE POLICY driver_presence_owner_update ON public.driver_presence
  FOR UPDATE TO authenticated
  USING (
    driver_id = auth.uid()
    AND public.has_role(auth.uid(), 'driver')
    AND public.is_driver_fully_approved(auth.uid())
  )
  WITH CHECK (
    driver_id = auth.uid()
    AND public.has_role(auth.uid(), 'driver')
    AND public.is_driver_fully_approved(auth.uid())
  );

-- Heartbeat accepts only the caller's own fresh device coordinates.
CREATE OR REPLACE FUNCTION public.heartbeat_driver_presence(
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision DEFAULT NULL,
  p_heading_deg double precision DEFAULT NULL,
  p_is_online boolean DEFAULT true
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_role(auth.uid(), 'driver')
     OR NOT public.is_driver_fully_approved(auth.uid()) THEN
    RAISE EXCEPTION 'فقط راننده تأییدشده می‌تواند وضعیت آنلاین خود را ثبت کند';
  END IF;
  IF p_latitude IS NULL OR p_latitude NOT BETWEEN 24 AND 40.5
     OR p_longitude IS NULL OR p_longitude NOT BETWEEN 43 AND 64
     OR (p_accuracy_m IS NOT NULL AND p_accuracy_m NOT BETWEEN 0 AND 10000)
     OR (p_heading_deg IS NOT NULL AND p_heading_deg NOT BETWEEN 0 AND 360)
     OR p_is_online IS NULL THEN
    RAISE EXCEPTION 'مختصات یا اطلاعات موقعیت معتبر نیست';
  END IF;

  INSERT INTO public.driver_presence (
    driver_id, latitude, longitude, accuracy_m, heading_deg,
    is_online, last_seen_at, updated_at
  ) VALUES (
    auth.uid(), p_latitude, p_longitude, p_accuracy_m, p_heading_deg,
    p_is_online, now(), now()
  )
  ON CONFLICT (driver_id) DO UPDATE SET
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    accuracy_m = EXCLUDED.accuracy_m,
    heading_deg = EXCLUDED.heading_deg,
    is_online = EXCLUDED.is_online,
    last_seen_at = now(),
    updated_at = now();
END;
$fn$;
REVOKE ALL ON FUNCTION public.heartbeat_driver_presence(double precision,double precision,double precision,double precision,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.heartbeat_driver_presence(double precision,double precision,double precision,double precision,boolean) TO authenticated;

-- Coarse candidate prefilter only. It is not a driving ETA and must never be
-- shown to a user as road distance. Invoke from trusted Edge Functions only.
CREATE OR REPLACE FUNCTION public.driver_presence_candidates(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_km double precision DEFAULT 30,
  p_limit integer DEFAULT 40
) RETURNS TABLE (
  driver_id uuid,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  last_seen_at timestamptz,
  approximate_distance_km double precision
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'دسترسی به فهرست رانندگان آنلاین مجاز نیست';
  END IF;
  IF p_latitude IS NULL OR p_latitude NOT BETWEEN 24 AND 40.5
     OR p_longitude IS NULL OR p_longitude NOT BETWEEN 43 AND 64
     OR p_radius_km IS NULL OR p_radius_km NOT BETWEEN 1 AND 100
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'محدوده جستجوی رانندگان معتبر نیست';
  END IF;

  RETURN QUERY
  SELECT dp.driver_id, dp.latitude, dp.longitude, dp.accuracy_m,
         dp.last_seen_at,
         (6371 * 2 * asin(sqrt(
           power(sin(radians(dp.latitude - p_latitude) / 2), 2)
           + cos(radians(p_latitude)) * cos(radians(dp.latitude))
           * power(sin(radians(dp.longitude - p_longitude) / 2), 2)
         )))::double precision AS approximate_distance_km
  FROM public.driver_presence dp
  WHERE dp.is_online = true
    AND dp.last_seen_at >= now() - interval '2 minutes'
    AND public.is_driver_fully_approved(dp.driver_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.driver_id = dp.driver_id AND t.status IN ('accepted','ongoing')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.shared_rides sr
      WHERE sr.driver_id = dp.driver_id
        AND sr.state IN ('open','locked','confirmed','ongoing')
    )
    AND coalesce((
      SELECT dca.outstanding
      FROM public.driver_commission_accounts dca
      WHERE dca.driver_id = dp.driver_id
    ), 0) < coalesce((
      SELECT pcs.driver_debt_limit
      FROM public.platform_commission_settings pcs
      WHERE pcs.id = true
    ), 100000)
    AND (6371 * 2 * asin(sqrt(
      power(sin(radians(dp.latitude - p_latitude) / 2), 2)
      + cos(radians(p_latitude)) * cos(radians(dp.latitude))
      * power(sin(radians(dp.longitude - p_longitude) / 2), 2)
    ))) <= p_radius_km
  ORDER BY approximate_distance_km
  LIMIT p_limit;
END;
$fn$;
REVOKE ALL ON FUNCTION public.driver_presence_candidates(double precision,double precision,double precision,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.driver_presence_candidates(double precision,double precision,double precision,integer) TO service_role;
