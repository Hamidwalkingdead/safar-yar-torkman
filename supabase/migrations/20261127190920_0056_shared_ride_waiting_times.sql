-- Show each booking's elapsed waiting time to verified drivers.
CREATE OR REPLACE FUNCTION public.driver_shared_requests()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_role(auth.uid(),'driver')
     OR NOT public.is_driver_fully_approved(auth.uid()) THEN
    RAISE EXCEPTION 'فقط راننده کاملاً تأییدشده می‌تواند درخواست‌های اشتراکی را ببیند';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',r.id,
        'origin',r.origin,
        'destination',r.destination,
        'departureAt',r.departure_at,
        'totalFare',r.total_fare,
        'state',r.state,
        'occupied',coalesce((
          SELECT sum(b.seats)::integer
          FROM public.shared_bookings b
          WHERE b.ride_id=r.id
        ),0),
        'ownerName',owner.display_name,
        'driverId',r.driver_id,
        'passengerRequests',coalesce((
          SELECT jsonb_agg(
            jsonb_build_object(
              'name',coalesce(nullif(trim(p.display_name),''),'مسافر'),
              'seats',b.seats,
              'requestedAt',b.created_at
            )
            ORDER BY b.created_at,b.id
          )
          FROM public.shared_bookings b
          LEFT JOIN public.profiles p ON p.id=b.user_id
          WHERE b.ride_id=r.id
        ),'[]'::jsonb)
      )
      ORDER BY r.created_at
    )
    FROM public.shared_rides r
    JOIN public.profiles owner ON owner.id=r.owner_id
    WHERE r.departure_at>now()
      AND r.driver_id IS NULL
      AND r.state IN ('open','locked','confirmed')
  ),'[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.driver_shared_requests() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_shared_requests() TO authenticated;
