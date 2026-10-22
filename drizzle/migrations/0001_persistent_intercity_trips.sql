CREATE TABLE public.profiles (
 id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 display_name text NOT NULL DEFAULT '' CHECK(length(display_name)<=100),
 phone text NOT NULL DEFAULT '' CHECK(phone='' OR phone ~ '^09[0-9]{9}$'),
 car text NOT NULL DEFAULT '' CHECK(length(car)<=100),
 plate text NOT NULL DEFAULT '' CHECK(length(plate)<=40)
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_profile_read ON public.profiles FOR SELECT TO authenticated USING(id=auth.uid());
CREATE POLICY own_profile_update ON public.profiles FOR UPDATE TO authenticated USING(id=auth.uid()) WITH CHECK(id=auth.uid());
CREATE FUNCTION public.create_trip_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN INSERT INTO public.profiles(id) VALUES(NEW.id) ON CONFLICT DO NOTHING; RETURN NEW; END; $$;
REVOKE ALL ON FUNCTION public.create_trip_profile() FROM PUBLIC;
CREATE TRIGGER trip_profile_signup AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.create_trip_profile();
INSERT INTO public.profiles(id) SELECT id FROM auth.users ON CONFLICT DO NOTHING;
CREATE TYPE public.app_role AS ENUM ('driver');
CREATE TABLE public.user_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,role public.app_role NOT NULL, UNIQUE(user_id,role));
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_role_read ON public.user_roles FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE FUNCTION public.has_role(_user_id uuid,_role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role); $$;
REVOKE ALL ON FUNCTION public.has_role(uuid,public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid,public.app_role) TO authenticated;
CREATE FUNCTION public.register_driver() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND length(trim(display_name))>=2 AND phone ~ '^09[0-9]{9}$' AND length(trim(car))>=2 AND length(trim(plate))>=2) THEN RAISE EXCEPTION 'ابتدا نام، شماره تماس و مشخصات خودرو را کامل کنید'; END IF; INSERT INTO public.user_roles(user_id,role) VALUES(auth.uid(),'driver') ON CONFLICT DO NOTHING; END; $$;
REVOKE ALL ON FUNCTION public.register_driver() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_driver() TO authenticated;
CREATE FUNCTION public.trip_fare(p_km numeric,p_night boolean,p_mountain boolean) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path=public AS $$ SELECT greatest(80000,round(p_km*(CASE WHEN p_mountain THEN 16000 ELSE 14000 END)+CASE WHEN p_night THEN p_km*1500 ELSE 0 END+greatest(0,p_km-300)*1000)::integer); $$;
REVOKE ALL ON FUNCTION public.trip_fare(numeric,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trip_fare(numeric,boolean,boolean) TO authenticated;
CREATE TABLE public.trips (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),passenger_id uuid NOT NULL,driver_id uuid,
 passenger_name text NOT NULL,origin text NOT NULL CHECK(length(trim(origin)) BETWEEN 2 AND 160),destination text NOT NULL CHECK(length(trim(destination)) BETWEEN 2 AND 160),
 departure_at timestamptz NOT NULL,km numeric NOT NULL CHECK(km>0 AND km<=3000),night boolean NOT NULL,mountain boolean NOT NULL,
 calculated integer NOT NULL CHECK(calculated>=80000),suggested integer CHECK(suggested>=80000),agreed_fare integer NOT NULL CHECK(agreed_fare>=80000),
 commission integer NOT NULL,driver_net integer NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','ongoing','done','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(), CHECK(commission+driver_net=agreed_fare)
);
GRANT SELECT ON public.trips TO authenticated;
GRANT ALL ON public.trips TO service_role;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY permitted_trip_read ON public.trips FOR SELECT TO authenticated USING(passenger_id=auth.uid() OR driver_id=auth.uid() OR (status='pending' AND public.has_role(auth.uid(),'driver')));
CREATE INDEX trips_passenger_idx ON public.trips(passenger_id,created_at DESC);
CREATE INDEX trips_driver_idx ON public.trips(driver_id,status);
CREATE INDEX trips_pending_idx ON public.trips(departure_at) WHERE status='pending';
CREATE TABLE public.trip_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),trip_id uuid NOT NULL REFERENCES public.trips(id),actor_id uuid NOT NULL,status text NOT NULL,agreed_fare integer NOT NULL,commission integer NOT NULL,driver_net integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.trip_events TO authenticated;
GRANT ALL ON public.trip_events TO service_role;
ALTER TABLE public.trip_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY participant_event_read ON public.trip_events FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.trips t WHERE t.id=trip_id AND (t.passenger_id=auth.uid() OR t.driver_id=auth.uid())));
CREATE FUNCTION public.immutable_trip_event() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN RAISE EXCEPTION 'سوابق سفر قابل تغییر یا حذف نیستند'; END; $$;
CREATE TRIGGER immutable_trip_events BEFORE UPDATE OR DELETE ON public.trip_events FOR EACH ROW EXECUTE FUNCTION public.immutable_trip_event();
CREATE FUNCTION public.record_trip_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN INSERT INTO public.trip_events(trip_id,actor_id,status,agreed_fare,commission,driver_net) VALUES(NEW.id,auth.uid(),NEW.status,NEW.agreed_fare,NEW.commission,NEW.driver_net); RETURN NEW; END; $$;
REVOKE ALL ON FUNCTION public.record_trip_event() FROM PUBLIC;
CREATE TRIGGER record_trip_event AFTER INSERT OR UPDATE OF status ON public.trips FOR EACH ROW EXECUTE FUNCTION public.record_trip_event();
CREATE FUNCTION public.create_trip(p_origin text,p_destination text,p_departure timestamptz,p_km numeric,p_night boolean,p_mountain boolean,p_suggested integer DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid; profile public.profiles; fare integer; calculated integer;
BEGIN
 SELECT * INTO profile FROM public.profiles WHERE id=auth.uid();
 IF auth.uid() IS NULL OR NOT FOUND OR length(trim(profile.display_name))<2 OR profile.phone !~ '^09[0-9]{9}$' THEN RAISE EXCEPTION 'ابتدا پروفایل و شماره تماس را کامل کنید'; END IF;
 IF p_origin IS NULL OR p_destination IS NULL OR trim(p_origin)=trim(p_destination) OR p_departure IS NULL OR p_departure<=now() OR p_km IS NULL OR p_km<=0 OR p_km>3000 OR p_night IS NULL OR p_mountain IS NULL OR (p_suggested IS NOT NULL AND p_suggested<80000) THEN RAISE EXCEPTION 'اطلاعات سفر نامعتبر است'; END IF;
 calculated:=public.trip_fare(p_km,p_night,p_mountain); fare:=coalesce(p_suggested,calculated);
 INSERT INTO public.trips(passenger_id,passenger_name,origin,destination,departure_at,km,night,mountain,calculated,suggested,agreed_fare,commission,driver_net) VALUES(auth.uid(),profile.display_name,trim(p_origin),trim(p_destination),p_departure,p_km,p_night,p_mountain,calculated,p_suggested,fare,round(fare*0.1)::integer,fare-round(fare*0.1)::integer) RETURNING id INTO rid;
 RETURN rid;
END; $$;
REVOKE ALL ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer) TO authenticated;
CREATE FUNCTION public.change_trip_status(p_trip uuid,p_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.trips;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ورود لازم است'; END IF;
 SELECT * INTO t FROM public.trips WHERE id=p_trip FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'سفر پیدا نشد'; END IF;
 IF p_status='accepted' THEN
  IF t.status<>'pending' OR t.departure_at<=now() OR t.passenger_id=auth.uid() OR NOT public.has_role(auth.uid(),'driver') OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND length(trim(display_name))>=2 AND phone ~ '^09[0-9]{9}$' AND length(trim(car))>=2 AND length(trim(plate))>=2) THEN RAISE EXCEPTION 'امکان پذیرش این سفر وجود ندارد'; END IF;
  UPDATE public.trips SET driver_id=auth.uid(),status='accepted',updated_at=now() WHERE id=p_trip;
 ELSIF (p_status='ongoing' AND t.status='accepted' AND t.driver_id=auth.uid()) OR (p_status='done' AND t.status='ongoing' AND t.driver_id=auth.uid()) OR (p_status='cancelled' AND ((t.passenger_id=auth.uid() AND t.status IN ('pending','accepted')) OR (t.driver_id=auth.uid() AND t.status IN ('accepted','ongoing')))) THEN
  UPDATE public.trips SET status=p_status,updated_at=now() WHERE id=p_trip;
 ELSE RAISE EXCEPTION 'تغییر وضعیت این سفر مجاز نیست'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.change_trip_status(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_trip_status(uuid,text) TO authenticated;
CREATE FUNCTION public.trip_contacts(p_trip uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.trips;
BEGIN
 SELECT * INTO t FROM public.trips WHERE id=p_trip;
 IF auth.uid() IS NULL OR NOT FOUND OR t.status NOT IN ('accepted','ongoing','done') OR (auth.uid() IS DISTINCT FROM t.passenger_id AND auth.uid() IS DISTINCT FROM t.driver_id) THEN RETURN '{}'::jsonb; END IF;
 RETURN jsonb_build_object('passenger',(SELECT jsonb_build_object('name',display_name,'phone',phone) FROM public.profiles WHERE id=t.passenger_id),'driver',(SELECT jsonb_build_object('name',display_name,'phone',phone,'car',car,'plate',plate) FROM public.profiles WHERE id=t.driver_id));
END; $$;
REVOKE ALL ON FUNCTION public.trip_contacts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trip_contacts(uuid) TO authenticated;
CREATE TABLE public.support_tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL DEFAULT auth.uid(),subject text NOT NULL CHECK(length(trim(subject)) BETWEEN 2 AND 160),category text NOT NULL,body text NOT NULL CHECK(length(trim(body)) BETWEEN 2 AND 5000),status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','review','resolved')),created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_ticket_read ON public.support_tickets FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY own_ticket_insert ON public.support_tickets FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid() AND status='open');
ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;
