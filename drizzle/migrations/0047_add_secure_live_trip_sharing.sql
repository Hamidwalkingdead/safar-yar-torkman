CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS app_private.trip_share_links (
  trip_id uuid PRIMARY KEY REFERENCES public.trips(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
ALTER TABLE app_private.trip_share_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.trip_share_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON app_private.trip_share_links TO service_role;

CREATE OR REPLACE FUNCTION public.create_trip_share_link(p_trip uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, extensions
AS $$
DECLARE v_token text; v_trip public.trips;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'برای ساخت لینک اشتراک‌گذاری وارد شوید'; END IF;
  SELECT * INTO v_trip FROM public.trips WHERE id = p_trip;
  IF NOT FOUND OR auth.uid() NOT IN (v_trip.passenger_id, v_trip.driver_id) THEN RAISE EXCEPTION 'دسترسی به این سفر مجاز نیست'; END IF;
  IF v_trip.status NOT IN ('accepted', 'ongoing') THEN RAISE EXCEPTION 'اشتراک‌گذاری فقط هنگام سفر فعال امکان‌پذیر است'; END IF;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO app_private.trip_share_links (trip_id, token_hash, created_by, expires_at)
  VALUES (p_trip, extensions.digest(v_token, 'sha256'), auth.uid(), now() + interval '24 hours')
  ON CONFLICT (trip_id) DO UPDATE SET token_hash=EXCLUDED.token_hash, created_by=EXCLUDED.created_by, created_at=now(), expires_at=EXCLUDED.expires_at;
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.create_trip_share_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_trip_share_link(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_trip_share(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, extensions
AS $$
DECLARE v_trip public.trips; v_location public.trip_locations;
BEGIN
  IF p_token IS NULL OR length(p_token) <> 64 OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT t.* INTO v_trip FROM app_private.trip_share_links s
  JOIN public.trips t ON t.id=s.trip_id
  WHERE s.token_hash=extensions.digest(p_token,'sha256') AND s.expires_at>now() AND t.status IN ('accepted','ongoing');
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_location FROM public.trip_locations WHERE trip_id=v_trip.id AND user_id=v_trip.driver_id;
  RETURN jsonb_build_object(
    'status',v_trip.status,'origin',v_trip.origin,'destination',v_trip.destination,
    'origin_lat',v_trip.origin_lat,'origin_lng',v_trip.origin_lng,
    'destination_lat',v_trip.destination_lat,'destination_lng',v_trip.destination_lng,
    'driver_lat',v_location.latitude,'driver_lng',v_location.longitude,
    'location_updated_at',v_location.updated_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_trip_share(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trip_share(text) TO anon, authenticated;