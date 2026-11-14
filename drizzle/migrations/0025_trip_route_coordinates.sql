-- Persist the exact endpoints used by the trusted server-side route calculation.
ALTER TABLE public.trips
 ADD COLUMN IF NOT EXISTS origin_lat double precision,
 ADD COLUMN IF NOT EXISTS origin_lng double precision,
 ADD COLUMN IF NOT EXISTS destination_lat double precision,
 ADD COLUMN IF NOT EXISTS destination_lng double precision;

DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.trips'::regclass AND conname='trips_origin_coordinates_check') THEN
  ALTER TABLE public.trips ADD CONSTRAINT trips_origin_coordinates_check CHECK (
   (origin_lat IS NULL AND origin_lng IS NULL)
   OR (origin_lat IS NOT NULL AND origin_lng IS NOT NULL AND origin_lat BETWEEN 24 AND 40.5 AND origin_lng BETWEEN 43 AND 64)
  );
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.trips'::regclass AND conname='trips_destination_coordinates_check') THEN
  ALTER TABLE public.trips ADD CONSTRAINT trips_destination_coordinates_check CHECK (
   (destination_lat IS NULL AND destination_lng IS NULL)
   OR (destination_lat IS NOT NULL AND destination_lng IS NOT NULL AND destination_lat BETWEEN 24 AND 40.5 AND destination_lng BETWEEN 43 AND 64)
  );
 END IF;
END $$;

-- The only callable trip-creation RPC now stores the server-verified endpoints
-- in the same transaction as fare reservation and trip creation.
CREATE OR REPLACE FUNCTION public.create_trip(
 p_origin text,
 p_destination text,
 p_departure timestamptz,
 p_km numeric,
 p_night boolean,
 p_mountain boolean,
 p_origin_lat double precision,
 p_origin_lng double precision,
 p_destination_lat double precision,
 p_destination_lng double precision,
 p_suggested integer DEFAULT NULL,
 p_payment_method text DEFAULT 'cash',
 p_ride_type text DEFAULT 'intercity'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
 rid uuid;
 server_night boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.profiles
  WHERE id=auth.uid()
   AND length(trim(first_name))>=2
   AND length(trim(last_name))>=2
   AND length(trim(display_name))>=2
   AND phone ~ '^09[0-9]{9}$'
   AND emergency_phone ~ '^09[0-9]{9}$'
 ) THEN
  RAISE EXCEPTION 'برای ثبت سفر، نام واقعی، نام خانوادگی، نام نمایشی و شماره اضطراری را در پروفایل کامل کنید';
 END IF;

 IF p_departure IS NULL THEN
  RAISE EXCEPTION 'زمان حرکت نامعتبر است';
 END IF;
 IF p_ride_type IS NULL OR p_ride_type NOT IN ('urban','intercity') THEN
  RAISE EXCEPTION 'نوع سفر نامعتبر است';
 END IF;
 IF p_origin_lat IS NULL OR p_origin_lng IS NULL
 OR p_destination_lat IS NULL OR p_destination_lng IS NULL
 OR p_origin_lat NOT BETWEEN 24 AND 40.5 OR p_destination_lat NOT BETWEEN 24 AND 40.5
 OR p_origin_lng NOT BETWEEN 43 AND 64 OR p_destination_lng NOT BETWEEN 43 AND 64
 OR (p_origin_lat=p_destination_lat AND p_origin_lng=p_destination_lng) THEN
  RAISE EXCEPTION 'مختصات مبدأ یا مقصد نامعتبر است';
 END IF;

 server_night :=
  EXTRACT(HOUR FROM p_departure AT TIME ZONE 'Asia/Tehran') >= 22
  OR EXTRACT(HOUR FROM p_departure AT TIME ZONE 'Asia/Tehran') < 6;

 rid := public.create_trip(
  p_origin,p_destination,p_departure,p_km,server_night,
  p_mountain,p_suggested,p_payment_method
 );

 UPDATE public.trips
 SET ride_type=p_ride_type,
     origin_lat=p_origin_lat,
     origin_lng=p_origin_lng,
     destination_lat=p_destination_lat,
     destination_lng=p_destination_lng
 WHERE id=rid;

 RETURN rid;
END;
$$;

REVOKE ALL ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer,text,text)
 FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer,text,text);
REVOKE ALL ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,double precision,double precision,double precision,double precision,integer,text,text)
 FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,double precision,double precision,double precision,double precision,integer,text,text)
 TO authenticated;
