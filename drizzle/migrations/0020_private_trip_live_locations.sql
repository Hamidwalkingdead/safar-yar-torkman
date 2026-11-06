-- Private, per-trip live locations. Only the two assigned participants can read them.
CREATE TABLE public.trip_locations (
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  latitude double precision NOT NULL CHECK (latitude BETWEEN 24 AND 40.5),
  longitude double precision NOT NULL CHECK (longitude BETWEEN 43 AND 64),
  accuracy_m double precision CHECK (accuracy_m IS NULL OR accuracy_m BETWEEN 0 AND 10000),
  heading_deg double precision CHECK (heading_deg IS NULL OR heading_deg BETWEEN 0 AND 360),
  speed_mps double precision CHECK (speed_mps IS NULL OR speed_mps BETWEEN 0 AND 150),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);
ALTER TABLE public.trip_locations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.trip_locations TO authenticated;
GRANT ALL ON public.trip_locations TO service_role;

CREATE POLICY trip_location_participant_read
ON public.trip_locations FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = trip_id
      AND t.status IN ('accepted','ongoing')
      AND auth.uid() IN (t.passenger_id, t.driver_id)
  )
);

CREATE POLICY trip_location_self_insert
ON public.trip_locations FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = trip_id
      AND t.status IN ('accepted','ongoing')
      AND auth.uid() IN (t.passenger_id, t.driver_id)
  )
);

CREATE POLICY trip_location_self_update
ON public.trip_locations FOR UPDATE TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = trip_id
      AND t.status IN ('accepted','ongoing')
      AND auth.uid() IN (t.passenger_id, t.driver_id)
  )
)
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = trip_id
      AND t.status IN ('accepted','ongoing')
      AND auth.uid() IN (t.passenger_id, t.driver_id)
  )
);

CREATE INDEX trip_locations_trip_updated_idx
ON public.trip_locations(trip_id, updated_at DESC);
ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_locations;
