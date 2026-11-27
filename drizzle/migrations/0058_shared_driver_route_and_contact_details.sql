-- Driver view for accepted route-aware shared groups.
CREATE OR REPLACE FUNCTION public.driver_assigned_shared_rides()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_driver_fully_approved(auth.uid()) THEN
    RAISE EXCEPTION 'فقط راننده کاملاً تأییدشده می‌تواند سفرهای واگذارشده را ببیند';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id',r.id,'origin',r.origin,'destination',r.destination,'departureAt',r.departure_at,
      'totalFare',r.total_fare,'state',r.state,'totalDistanceKm',r.total_distance_km,
      'routePlan',r.route_plan,
      'occupied',coalesce((SELECT sum(b.seats) FROM public.shared_bookings b WHERE b.ride_id=r.id),0),
      'ownerName',owner.display_name,
      'passengerRequests',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'bookingId',b.id,'name',coalesce(nullif(trim(p.display_name),''),'مسافر'),
          'seats',b.seats,'origin',b.origin,'destination',b.destination,
          'distanceKm',b.distance_km,'fareAmount',b.fare_amount,'requestNote',b.request_note,
          'womenOnly',b.women_only,'femaleDriverRequested',b.female_driver_requested,
          'forOtherPerson',b.for_other_person,'contactName',b.contact_name
        ) ORDER BY b.created_at,b.id)
        FROM public.shared_bookings b JOIN public.profiles p ON p.id=b.user_id
        WHERE b.ride_id=r.id
      ),'[]'::jsonb)
    ) ORDER BY r.departure_at)
    FROM public.shared_rides r JOIN public.profiles owner ON owner.id=r.owner_id
    WHERE r.driver_id=auth.uid() AND r.departure_at>=now()-interval '1 day' AND r.state<>'cancelled'
  ),'[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.driver_assigned_shared_rides() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_assigned_shared_rides() TO authenticated;

-- Keep legacy shared bookings readable while all newly created requests use
-- individually calculated route fares.
CREATE OR REPLACE FUNCTION public.shared_listing()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(jsonb_agg(item ORDER BY depart),'[]'::jsonb)
  FROM (
    SELECT r.departure_at depart,jsonb_build_object(
      'id',r.id,'origin',r.origin,'destination',r.destination,'departureAt',r.departure_at,
      'totalFare',r.total_fare,'state',r.state,
      'occupied',coalesce((SELECT sum(seats) FROM public.shared_bookings b WHERE b.ride_id=r.id),0),
      'isOwner',coalesce(r.owner_id=auth.uid(),false),
      'allConfirmed',NOT EXISTS(SELECT 1 FROM public.shared_bookings b WHERE b.ride_id=r.id AND NOT b.final_confirmed),
      'myBooking',(SELECT jsonb_build_object(
        'seats',b.seats,'confirmed',b.final_confirmed,
        'amount',coalesce(b.fare_amount,
          (r.total_fare/nullif((SELECT sum(seats)::int FROM public.shared_bookings x WHERE x.ride_id=r.id),0))*b.seats
        ),
        'distanceKm',coalesce(b.distance_km,0),
        'requestNote',b.request_note,'womenOnly',b.women_only,
        'femaleDriverRequested',b.female_driver_requested,'forOtherPerson',b.for_other_person,
        'contactName',b.contact_name
      ) FROM public.shared_bookings b WHERE b.ride_id=r.id AND b.user_id=auth.uid()),
      'driverId',r.driver_id,'totalDistanceKm',r.total_distance_km
    ) item
    FROM public.shared_rides r
    WHERE auth.uid() IS NOT NULL
      AND EXISTS(SELECT 1 FROM public.shared_bookings b WHERE b.ride_id=r.id AND b.user_id=auth.uid())
  ) s;
$$;
REVOKE ALL ON FUNCTION public.shared_listing() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shared_listing() TO authenticated;
