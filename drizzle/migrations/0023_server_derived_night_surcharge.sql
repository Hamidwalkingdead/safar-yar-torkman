-- Derive the night surcharge from the departure timestamp on the server.
-- Do not trust the client-provided p_night flag for financial calculations.
CREATE OR REPLACE FUNCTION public.create_trip(
 p_origin text,
 p_destination text,
 p_departure timestamptz,
 p_km numeric,
 p_night boolean,
 p_mountain boolean,
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
 IF p_departure IS NULL THEN
  RAISE EXCEPTION 'زمان حرکت نامعتبر است';
 END IF;

 IF p_ride_type IS NULL OR p_ride_type NOT IN ('urban','intercity') THEN
  RAISE EXCEPTION 'نوع سفر نامعتبر است';
 END IF;

 server_night :=
  EXTRACT(HOUR FROM p_departure AT TIME ZONE 'Asia/Tehran') >= 22
  OR EXTRACT(HOUR FROM p_departure AT TIME ZONE 'Asia/Tehran') < 6;

 -- The inner payment-aware function remains responsible for profile,
 -- fare, wallet reservation, and cancellation-debt validation.
 rid := public.create_trip(
  p_origin,
  p_destination,
  p_departure,
  p_km,
  server_night,
  p_mountain,
  p_suggested,
  p_payment_method
 );

 UPDATE public.trips
 SET ride_type = p_ride_type
 WHERE id = rid;

 RETURN rid;
END;
$$;

-- Prevent callers from bypassing the server-derived night flag by invoking
-- the inner payment-aware overload directly.
REVOKE ALL ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer,text)
 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer,text,text)
 FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer,text,text)
 TO authenticated;
