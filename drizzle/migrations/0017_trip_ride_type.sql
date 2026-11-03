ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS ride_type text NOT NULL DEFAULT 'intercity'
 CHECK (ride_type IN ('urban','intercity'));

CREATE OR REPLACE FUNCTION public.create_trip(
 p_origin text,p_destination text,p_departure timestamptz,p_km numeric,p_night boolean,
 p_mountain boolean,p_suggested integer,p_payment_method text,p_ride_type text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid;
BEGIN
 IF p_ride_type NOT IN ('urban','intercity') THEN RAISE EXCEPTION 'نوع سفر نامعتبر است'; END IF;
 rid := public.create_trip(p_origin,p_destination,p_departure,p_km,p_night,p_mountain,p_suggested,p_payment_method);
 UPDATE public.trips SET ride_type=p_ride_type WHERE id=rid;
 RETURN rid;
END; $$;
REVOKE ALL ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer,text,text) TO authenticated;
