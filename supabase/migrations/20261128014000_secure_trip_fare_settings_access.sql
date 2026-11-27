CREATE OR REPLACE FUNCTION public.trip_fare(p_km numeric, p_night boolean, p_mountain boolean)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  WITH settings AS (SELECT public.get_public_pricing_settings() AS value)
  SELECT greatest(
    (value->>'minimum_fare')::integer,
    round(
      p_km * CASE WHEN p_mountain
        THEN (value->>'mountain_per_km')::numeric
        ELSE (value->>'standard_per_km')::numeric
      END
      + CASE WHEN p_night THEN p_km*(value->>'night_surcharge_per_km')::numeric ELSE 0 END
      + greatest(0,p_km-(value->>'long_distance_threshold_km')::numeric)
        *(value->>'long_distance_per_km')::numeric
    )::integer
  )
  FROM settings;
$$;
REVOKE ALL ON FUNCTION public.trip_fare(numeric,boolean,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_fare(numeric,boolean,boolean) TO authenticated;