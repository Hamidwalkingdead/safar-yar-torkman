-- Expose the approved driver's existing selfie only to participants of an accepted trip,
-- and let the passenger rate the driver once the trip is completed.
CREATE TABLE IF NOT EXISTS public.driver_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL UNIQUE REFERENCES public.trips(id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_ratings_distinct_parties CHECK (passenger_id<>driver_id)
);
ALTER TABLE public.driver_ratings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_ratings FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_view_trip_driver_selfie(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.driver_documents d
    JOIN public.trips t ON t.driver_id=d.user_id
    WHERE d.kind='selfie'
      AND d.path=p_path
      AND t.status IN ('accepted','ongoing','done')
      AND (t.passenger_id=auth.uid() OR t.driver_id=auth.uid())
  );
$fn$;
REVOKE ALL ON FUNCTION public.can_view_trip_driver_selfie(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_trip_driver_selfie(text) TO authenticated;

DROP POLICY IF EXISTS trip_participants_read_driver_selfie ON storage.objects;
CREATE POLICY trip_participants_read_driver_selfie ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id='driver-documents'
    AND public.can_view_trip_driver_selfie(name)
  );

CREATE OR REPLACE FUNCTION public.trip_contacts(p_trip uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $fn$
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
      SELECT jsonb_build_object('name',display_name,'phone',phone)
      FROM public.profiles WHERE id=t.passenger_id
    ),
    'driver',(
      SELECT jsonb_build_object(
        'name',p.display_name,
        'phone',p.phone,
        'car',p.car,
        'plate',p.plate,
        'photoPath',(
          SELECT d.path FROM public.driver_documents d
          WHERE d.user_id=p.id AND d.kind='selfie'
          LIMIT 1
        ),
        'ratingAverage',(
          SELECT round(avg(r.stars)::numeric,1)
          FROM public.driver_ratings r WHERE r.driver_id=p.id
        ),
        'ratingCount',(
          SELECT count(*) FROM public.driver_ratings r WHERE r.driver_id=p.id
        ),
        'myRating',CASE WHEN auth.uid()=t.passenger_id THEN (
          SELECT r.stars FROM public.driver_ratings r
          WHERE r.trip_id=t.id AND r.passenger_id=auth.uid()
        ) ELSE NULL END
      )
      FROM public.profiles p WHERE p.id=t.driver_id
    )
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.trip_contacts(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.trip_contacts(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_driver_rating(p_trip uuid,p_stars integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE t public.trips; rating_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'برای ثبت امتیاز وارد حساب شوید'; END IF;
  IF p_stars IS NULL OR p_stars NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'امتیاز باید بین یک تا پنج ستاره باشد';
  END IF;

  SELECT * INTO t FROM public.trips WHERE id=p_trip FOR UPDATE;
  IF NOT FOUND OR t.passenger_id IS DISTINCT FROM auth.uid()
     OR t.status<>'done' OR t.driver_id IS NULL THEN
    RAISE EXCEPTION 'امتیازدهی فقط برای راننده سفر پایان‌یافته خودتان مجاز است';
  END IF;

  INSERT INTO public.driver_ratings(trip_id,passenger_id,driver_id,stars)
  VALUES(t.id,t.passenger_id,t.driver_id,p_stars)
  RETURNING id INTO rating_id;
  RETURN rating_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'برای این سفر قبلاً امتیاز ثبت کرده‌اید';
END;
$fn$;
REVOKE ALL ON FUNCTION public.submit_driver_rating(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_driver_rating(uuid,integer) TO authenticated;
