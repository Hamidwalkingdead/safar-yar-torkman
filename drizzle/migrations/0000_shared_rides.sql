CREATE TABLE public.shared_rides (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL,
 origin text NOT NULL CHECK (length(origin) BETWEEN 2 AND 160), destination text NOT NULL CHECK (length(destination) BETWEEN 2 AND 160),
 departure_at timestamptz NOT NULL, total_fare integer NOT NULL CHECK (total_fare >= 80000),
 ride_type text NOT NULL DEFAULT 'intercity' CHECK (ride_type = 'intercity'),
 state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','locked','confirmed')), created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shared_rides TO anon, authenticated;
GRANT ALL ON public.shared_rides TO service_role;
ALTER TABLE public.shared_rides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public safe shared listings" ON public.shared_rides FOR SELECT TO anon, authenticated USING (true);
CREATE TABLE public.shared_bookings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ride_id uuid NOT NULL REFERENCES public.shared_rides(id), user_id uuid NOT NULL,
 seats integer NOT NULL CHECK (seats BETWEEN 1 AND 3), final_confirmed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(ride_id,user_id)
);
GRANT SELECT ON public.shared_bookings TO authenticated;
GRANT ALL ON public.shared_bookings TO service_role;
ALTER TABLE public.shared_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own shared booking" ON public.shared_bookings FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE FUNCTION public.shared_listing() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
SELECT coalesce(jsonb_agg(item ORDER BY depart), '[]'::jsonb) FROM (
 SELECT r.departure_at depart, jsonb_build_object('id',r.id,'origin',r.origin,'destination',r.destination,'departureAt',r.departure_at,'totalFare',r.total_fare,'state',r.state,'occupied',coalesce((SELECT sum(seats) FROM public.shared_bookings b WHERE b.ride_id=r.id),0),'isOwner',coalesce(r.owner_id=auth.uid(),false),'allConfirmed',NOT EXISTS(SELECT 1 FROM public.shared_bookings b WHERE b.ride_id=r.id AND NOT b.final_confirmed),'myBooking',(SELECT jsonb_build_object('seats',b.seats,'confirmed',b.final_confirmed,'amount', (r.total_fare / n.cnt) * b.seats + greatest(0,least(b.seats,r.total_fare % n.cnt - coalesce((SELECT sum(p.seats) FROM public.shared_bookings p WHERE p.ride_id=r.id AND (p.created_at,p.id)<(b.created_at,b.id)),0)))) FROM public.shared_bookings b CROSS JOIN LATERAL (SELECT sum(seats)::int cnt FROM public.shared_bookings WHERE ride_id=r.id) n WHERE b.ride_id=r.id AND b.user_id=auth.uid())) item
 FROM public.shared_rides r WHERE r.departure_at > now() OR r.owner_id=auth.uid() OR EXISTS(SELECT 1 FROM public.shared_bookings b WHERE b.ride_id=r.id AND b.user_id=auth.uid())
) s; $$;
REVOKE ALL ON FUNCTION public.shared_listing() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shared_listing() TO anon, authenticated;
CREATE FUNCTION public.create_shared_ride(p_origin text,p_destination text,p_departure timestamptz,p_fare integer,p_seats integer,p_type text,p_consent boolean) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ورود لازم است'; END IF;
 IF p_consent IS DISTINCT FROM true OR p_type IS DISTINCT FROM 'intercity' OR p_seats NOT BETWEEN 1 AND 3 OR p_fare < 80000 OR p_departure <= now() OR trim(p_origin)=trim(p_destination) THEN RAISE EXCEPTION 'اطلاعات سفر یا تأیید نامعتبر است'; END IF;
 INSERT INTO public.shared_rides(owner_id,origin,destination,departure_at,total_fare,state) VALUES(auth.uid(),trim(p_origin),trim(p_destination),p_departure,p_fare,CASE WHEN p_seats=3 THEN 'locked' ELSE 'open' END) RETURNING id INTO rid;
 INSERT INTO public.shared_bookings(ride_id,user_id,seats) VALUES(rid,auth.uid(),p_seats);
 RETURN rid;
END; $$;
REVOKE ALL ON FUNCTION public.create_shared_ride(text,text,timestamptz,integer,integer,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_shared_ride(text,text,timestamptz,integer,integer,text,boolean) TO authenticated;
CREATE FUNCTION public.join_shared_ride(p_ride uuid,p_seats integer,p_expected integer,p_consent boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.shared_rides; occupied integer; expected integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ورود لازم است'; END IF;
 SELECT * INTO r FROM public.shared_rides WHERE id=p_ride FOR UPDATE;
 IF NOT FOUND OR r.state <> 'open' OR r.departure_at <= now() THEN RAISE EXCEPTION 'این سفر دیگر قابل پیوستن نیست'; END IF;
 IF p_consent IS DISTINCT FROM true OR p_seats NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'تأیید و تعداد صندلی الزامی است'; END IF;
 SELECT coalesce(sum(seats),0)::int INTO occupied FROM public.shared_bookings WHERE ride_id=p_ride;
 IF occupied+p_seats>3 THEN RAISE EXCEPTION 'ظرفیت سفر کافی نیست'; END IF;
 expected := (r.total_fare/(occupied+p_seats))*p_seats + greatest(0,least(p_seats,r.total_fare%(occupied+p_seats)-occupied));
 IF expected <> p_expected THEN RAISE EXCEPTION 'قیمت تغییر کرده؛ دوباره بررسی و تأیید کنید'; END IF;
 INSERT INTO public.shared_bookings(ride_id,user_id,seats) VALUES(p_ride,auth.uid(),p_seats);
 IF occupied+p_seats=3 THEN UPDATE public.shared_rides SET state='locked' WHERE id=p_ride; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.join_shared_ride(uuid,integer,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_shared_ride(uuid,integer,integer,boolean) TO authenticated;
CREATE FUNCTION public.lock_shared_ride(p_ride uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.shared_rides;
BEGIN
 SELECT * INTO r FROM public.shared_rides WHERE id=p_ride FOR UPDATE;
 IF auth.uid() IS NULL OR r.owner_id IS DISTINCT FROM auth.uid() OR r.state <> 'open' THEN RAISE EXCEPTION 'امکان بستن ظرفیت وجود ندارد'; END IF;
 UPDATE public.shared_rides SET state='locked' WHERE id=p_ride;
END; $$;
REVOKE ALL ON FUNCTION public.lock_shared_ride(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_shared_ride(uuid) TO authenticated;
CREATE FUNCTION public.confirm_shared_price(p_ride uuid,p_amount integer,p_consent boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.shared_rides; amount integer;
BEGIN
 SELECT * INTO r FROM public.shared_rides WHERE id=p_ride FOR UPDATE;
 IF auth.uid() IS NULL OR r.state <> 'locked' OR p_consent IS DISTINCT FROM true THEN RAISE EXCEPTION 'قیمت هنوز نهایی نشده یا تأیید نشده است'; END IF;
 SELECT (r.total_fare/n.cnt)*b.seats + greatest(0,least(b.seats,r.total_fare%n.cnt-coalesce((SELECT sum(p.seats) FROM public.shared_bookings p WHERE p.ride_id=p_ride AND (p.created_at,p.id)<(b.created_at,b.id)),0))) INTO amount FROM public.shared_bookings b CROSS JOIN LATERAL (SELECT sum(seats)::int cnt FROM public.shared_bookings WHERE ride_id=p_ride) n WHERE b.ride_id=p_ride AND b.user_id=auth.uid();
 IF amount IS NULL OR amount <> p_amount THEN RAISE EXCEPTION 'قیمت تغییر کرده؛ دوباره تأیید کنید'; END IF;
 UPDATE public.shared_bookings SET final_confirmed=true WHERE ride_id=p_ride AND user_id=auth.uid();
 IF NOT EXISTS(SELECT 1 FROM public.shared_bookings WHERE ride_id=p_ride AND NOT final_confirmed) THEN UPDATE public.shared_rides SET state='confirmed' WHERE id=p_ride; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.confirm_shared_price(uuid,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_shared_price(uuid,integer,boolean) TO authenticated;