-- Do not expose the account owner's phone when the ride is booked for another person.
CREATE OR REPLACE FUNCTION public.trip_contacts(p_trip uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE t public.trips;
BEGIN
  SELECT * INTO t FROM public.trips WHERE id=p_trip;
  IF auth.uid() IS NULL OR NOT FOUND
     OR t.status NOT IN ('accepted','ongoing','done')
     OR (auth.uid() IS DISTINCT FROM t.passenger_id AND auth.uid() IS DISTINCT FROM t.driver_id) THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN jsonb_build_object(
    'passenger',(
      SELECT jsonb_build_object(
        'name',CASE WHEN t.for_other_person
          THEN (SELECT c.contact_name FROM public.trip_private_contacts c WHERE c.trip_id=t.id)
          ELSE p.display_name END,
        'phone',CASE WHEN t.for_other_person THEN NULL ELSE p.phone END
      )
      FROM public.profiles p WHERE p.id=t.passenger_id
    ),
    'driver',(
      SELECT jsonb_build_object(
        'name',p.display_name,'phone',p.phone,'car',p.car,'plate',p.plate,
        'photoPath',(SELECT d.path FROM public.driver_documents d WHERE d.user_id=p.id AND d.kind='selfie' LIMIT 1),
        'ratingAverage',(SELECT round(avg(r.stars)::numeric,1) FROM public.driver_ratings r WHERE r.driver_id=p.id),
        'ratingCount',(SELECT count(*) FROM public.driver_ratings r WHERE r.driver_id=p.id),
        'myRating',CASE WHEN auth.uid()=t.passenger_id THEN (
          SELECT r.stars FROM public.driver_ratings r WHERE r.trip_id=t.id AND r.passenger_id=auth.uid()
        ) ELSE NULL END
      )
      FROM public.profiles p WHERE p.id=t.driver_id
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.trip_contacts(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.trip_contacts(uuid) TO authenticated;
