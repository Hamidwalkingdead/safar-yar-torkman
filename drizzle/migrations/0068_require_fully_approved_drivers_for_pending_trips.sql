-- Pending trip details are visible only to fully approved drivers.
-- Passengers retain access to their own trips; assigned drivers retain access
-- to their trips; admins keep the separate admin_trip_read policy.
DROP POLICY IF EXISTS permitted_trip_read ON public.trips;

CREATE POLICY permitted_trip_read
ON public.trips
FOR SELECT
TO authenticated
USING (
  passenger_id = auth.uid()
  OR driver_id = auth.uid()
  OR (
    status = 'pending'
    AND driver_id IS NULL
    AND (
      departure_at > now()
      OR (
        abs(extract(epoch FROM (departure_at - created_at))) <= 300
        AND created_at >= now() - interval '9 hours'
      )
    )
    AND public.has_role(auth.uid(), 'driver'::public.app_role)
    AND public.is_my_driver_fully_approved()
  )
);

COMMENT ON POLICY permitted_trip_read ON public.trips IS
  'Passengers and assigned drivers read their own trips; only fully approved drivers may discover pending trip offers.';
