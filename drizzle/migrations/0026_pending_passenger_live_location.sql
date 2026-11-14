-- A passenger can share their pickup position while a request is pending.
-- The location remains private to that passenger until a driver accepts the trip.
DROP POLICY IF EXISTS trip_location_participant_read ON public.trip_locations;
CREATE POLICY trip_location_participant_read
ON public.trip_locations FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = trip_id
      AND (
        (t.status IN ('accepted','ongoing') AND auth.uid() IN (t.passenger_id, t.driver_id))
        OR (t.status = 'pending' AND auth.uid() = t.passenger_id)
      )
  )
);

DROP POLICY IF EXISTS trip_location_self_insert ON public.trip_locations;
CREATE POLICY trip_location_self_insert
ON public.trip_locations FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = trip_id
      AND (
        (t.status IN ('accepted','ongoing') AND auth.uid() IN (t.passenger_id, t.driver_id))
        OR (t.status = 'pending' AND auth.uid() = t.passenger_id)
      )
  )
);

DROP POLICY IF EXISTS trip_location_self_update ON public.trip_locations;
CREATE POLICY trip_location_self_update
ON public.trip_locations FOR UPDATE TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = trip_id
      AND (
        (t.status IN ('accepted','ongoing') AND auth.uid() IN (t.passenger_id, t.driver_id))
        OR (t.status = 'pending' AND auth.uid() = t.passenger_id)
      )
  )
)
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = trip_id
      AND (
        (t.status IN ('accepted','ongoing') AND auth.uid() IN (t.passenger_id, t.driver_id))
        OR (t.status = 'pending' AND auth.uid() = t.passenger_id)
      )
  )
);
