-- Route-aware shared rides and optional passenger request details.
ALTER TABLE public.shared_rides
  ADD COLUMN IF NOT EXISTS origin_lat double precision,
  ADD COLUMN IF NOT EXISTS origin_lng double precision,
  ADD COLUMN IF NOT EXISTS destination_lat double precision,
  ADD COLUMN IF NOT EXISTS destination_lng double precision,
  ADD COLUMN IF NOT EXISTS total_distance_km numeric(8,1),
  ADD COLUMN IF NOT EXISTS route_plan jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.shared_bookings
  ADD COLUMN IF NOT EXISTS origin text,
  ADD COLUMN IF NOT EXISTS destination text,
  ADD COLUMN IF NOT EXISTS origin_lat double precision,
  ADD COLUMN IF NOT EXISTS origin_lng double precision,
  ADD COLUMN IF NOT EXISTS destination_lat double precision,
  ADD COLUMN IF NOT EXISTS destination_lng double precision,
  ADD COLUMN IF NOT EXISTS distance_km numeric(8,1),
  ADD COLUMN IF NOT EXISTS fare_amount integer,
  ADD COLUMN IF NOT EXISTS mountain boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS request_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS women_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS female_driver_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS for_other_person boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contact_name text;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS request_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS female_driver_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS for_other_person boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.shared_rides'::regclass AND conname='shared_rides_route_coordinates_check') THEN
    ALTER TABLE public.shared_rides ADD CONSTRAINT shared_rides_route_coordinates_check CHECK (
      (origin_lat IS NULL AND origin_lng IS NULL AND destination_lat IS NULL AND destination_lng IS NULL)
      OR (origin_lat BETWEEN 24 AND 40.5 AND origin_lng BETWEEN 43 AND 64
        AND destination_lat BETWEEN 24 AND 40.5 AND destination_lng BETWEEN 43 AND 64)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.shared_bookings'::regclass AND conname='shared_bookings_route_coordinates_check') THEN
    ALTER TABLE public.shared_bookings ADD CONSTRAINT shared_bookings_route_coordinates_check CHECK (
      (origin_lat IS NULL AND origin_lng IS NULL AND destination_lat IS NULL AND destination_lng IS NULL)
      OR (origin_lat BETWEEN 24 AND 40.5 AND origin_lng BETWEEN 43 AND 64
        AND destination_lat BETWEEN 24 AND 40.5 AND destination_lng BETWEEN 43 AND 64)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.shared_bookings'::regclass AND conname='shared_bookings_fare_amount_check') THEN
    ALTER TABLE public.shared_bookings ADD CONSTRAINT shared_bookings_fare_amount_check
      CHECK (fare_amount IS NULL OR fare_amount >= 80000);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.shared_booking_private_data (
  booking_id uuid PRIMARY KEY REFERENCES public.shared_bookings(id) ON DELETE CASCADE,
  contact_phone_ciphertext text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shared_booking_private_data ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shared_booking_private_data FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.trip_private_contacts (
  trip_id uuid PRIMARY KEY REFERENCES public.trips(id) ON DELETE CASCADE,
  contact_name text NOT NULL,
  contact_phone_ciphertext text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trip_private_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trip_private_contacts FROM PUBLIC, anon, authenticated;

DO $vault$
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NULL
     OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Supabase Vault must be enabled before storing alternate trip contacts';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='safar_yar_trip_contact_key') THEN
    PERFORM vault.create_secret(
      encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex'),
      'safar_yar_trip_contact_key',
      'Encryption key for alternate passenger contact numbers',
      NULL
    );
  END IF;
END;
$vault$;

CREATE OR REPLACE FUNCTION public.trip_contact_encryption_key()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets
  WHERE name='safar_yar_trip_contact_key' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.trip_contact_encryption_key() FROM PUBLIC, anon, authenticated;

-- The edge function is the only caller allowed to create/match shared groups.
CREATE OR REPLACE FUNCTION public.shared_route_candidates(
  p_departure timestamptz
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public
AS $$
  SELECT coalesce(jsonb_agg(candidate ORDER BY departure_delta), '[]'::jsonb)
  FROM (
    SELECT
      abs(extract(epoch FROM (r.departure_at-p_departure))) AS departure_delta,
      jsonb_build_object(
        'id',r.id,
        'origin',r.origin,
        'destination',r.destination,
        'departureAt',r.departure_at,
        'totalFare',r.total_fare,
        'originPoint',jsonb_build_object('lat',r.origin_lat,'lng',r.origin_lng,'name',r.origin),
        'destinationPoint',jsonb_build_object('lat',r.destination_lat,'lng',r.destination_lng,'name',r.destination),
        'bookings',(
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id',b.id,'userId',b.user_id,'seats',b.seats,
            'origin',b.origin,'destination',b.destination,
            'originPoint',jsonb_build_object('lat',b.origin_lat,'lng',b.origin_lng,'name',b.origin),
            'destinationPoint',jsonb_build_object('lat',b.destination_lat,'lng',b.destination_lng,'name',b.destination),
            'mountain',b.mountain,'womenOnly',b.women_only,
            'femaleDriverRequested',b.female_driver_requested,
            'requestNote',b.request_note,'forOtherPerson',b.for_other_person,
            'contactName',b.contact_name,'distanceKm',b.distance_km,'fareAmount',b.fare_amount,
            'displayName',p.display_name
          ) ORDER BY b.created_at,b.id), '[]'::jsonb)
          FROM public.shared_bookings b
          JOIN public.profiles p ON p.id=b.user_id
          WHERE b.ride_id=r.id
        )
      ) AS candidate
    FROM public.shared_rides r
    WHERE r.state='open'
      AND r.driver_id IS NULL
      AND r.departure_at>now()
      AND (r.departure_at AT TIME ZONE 'Asia/Tehran')::date=(p_departure AT TIME ZONE 'Asia/Tehran')::date
      AND abs(extract(epoch FROM (r.departure_at-p_departure)))<=3600
      AND (SELECT coalesce(sum(b.seats),0) FROM public.shared_bookings b WHERE b.ride_id=r.id)<3
    ORDER BY abs(extract(epoch FROM (r.departure_at-p_departure))),r.created_at
    LIMIT 5
  ) q;
$$;
REVOKE ALL ON FUNCTION public.shared_route_candidates(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shared_route_candidates(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.create_or_update_shared_route(
  p_user uuid,
  p_ride uuid,
  p_departure timestamptz,
  p_bookings jsonb,
  p_route_plan jsonb,
  p_total_distance_km numeric,
  p_origin text,
  p_destination text,
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_destination_lat double precision,
  p_destination_lng double precision
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public, extensions
AS $$
DECLARE
  rid uuid;
  b jsonb;
  booking_id uuid;
  total_seats integer;
  v_total_fare bigint;
  new_booking_id uuid;
  contact_phone text;
  existing_women_only boolean;
BEGIN
  IF p_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=p_user
      AND length(trim(p.first_name))>=2
      AND length(trim(p.last_name))>=2
      AND length(trim(p.display_name))>=2
      AND p.phone ~ '^09[0-9]{9}$'
      AND public.has_emergency_phone(p_user)
  ) THEN
    RAISE EXCEPTION 'برای ثبت سفر اشتراکی، پروفایل و شماره اضطراری را کامل کنید';
  END IF;
  IF p_bookings IS NULL OR jsonb_typeof(p_bookings)<>'array' OR jsonb_array_length(p_bookings) NOT BETWEEN 1 AND 3
     OR p_route_plan IS NULL OR jsonb_typeof(p_route_plan)<>'array' OR jsonb_array_length(p_route_plan)<2
     OR p_total_distance_km IS NULL OR p_total_distance_km<=0
     OR p_departure IS NULL OR p_departure<=now()
     OR p_origin_lat IS NULL OR p_origin_lat NOT BETWEEN 24 AND 40.5
     OR p_origin_lng IS NULL OR p_origin_lng NOT BETWEEN 43 AND 64
     OR p_destination_lat IS NULL OR p_destination_lat NOT BETWEEN 24 AND 40.5
     OR p_destination_lng IS NULL OR p_destination_lng NOT BETWEEN 43 AND 64 THEN
    RAISE EXCEPTION 'اطلاعات مسیر اشتراکی معتبر نیست';
  END IF;

  SELECT coalesce(sum((x->>'seats')::integer),0),
         coalesce(sum((x->>'fareAmount')::bigint),0)
    INTO total_seats,v_total_fare
  FROM jsonb_array_elements(p_bookings) x;
  IF total_seats NOT BETWEEN 1 AND 3 OR v_total_fare<80000 OR v_total_fare>2147483647 THEN
    RAISE EXCEPTION 'ظرفیت یا کرایه گروه اشتراکی نامعتبر است';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_bookings) x
    WHERE x->>'userId'=p_user::text
  ) THEN
    RAISE EXCEPTION 'درخواست‌کننده در فهرست مسافران وجود ندارد';
  END IF;

  IF p_ride IS NOT NULL THEN
    SELECT id INTO rid FROM public.shared_rides WHERE id=p_ride AND state='open' AND driver_id IS NULL FOR UPDATE;
    IF NOT FOUND OR (SELECT departure_at FROM public.shared_rides WHERE id=p_ride)<=now()
       OR abs(extract(epoch FROM ((SELECT departure_at FROM public.shared_rides WHERE id=p_ride)-p_departure)))>3600 THEN
      RAISE EXCEPTION 'گروه هم‌مسیر دیگر ظرفیت یا شرایط لازم را ندارد';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.shared_bookings b
      WHERE b.ride_id=p_ride AND b.women_only IS DISTINCT FROM
        (SELECT (x->>'womenOnly')::boolean FROM jsonb_array_elements(p_bookings) x WHERE x->>'userId'=p_user::text LIMIT 1)
    ) THEN
      RAISE EXCEPTION 'شرط هم‌سفران این گروه با درخواست شما سازگار نیست';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.shared_bookings b
      WHERE b.ride_id=p_ride AND b.user_id=p_user
    ) THEN
      RAISE EXCEPTION 'درخواست تکراری است';
    END IF;
    IF (SELECT coalesce(sum(seats),0) FROM public.shared_bookings WHERE ride_id=p_ride)
       + (SELECT (x->>'seats')::integer FROM jsonb_array_elements(p_bookings) x WHERE x->>'userId'=p_user::text LIMIT 1)>3 THEN
      RAISE EXCEPTION 'ظرفیت گروه تکمیل شده است';
    END IF;
    rid:=p_ride;
  ELSE
    INSERT INTO public.shared_rides(
      owner_id,origin,destination,departure_at,total_fare,state,
      origin_lat,origin_lng,destination_lat,destination_lng,total_distance_km,route_plan
    ) VALUES (
      p_user,p_origin,p_destination,p_departure,v_total_fare,
      CASE WHEN total_seats=3 THEN 'locked' ELSE 'open' END,
      p_origin_lat,p_origin_lng,p_destination_lat,p_destination_lng,p_total_distance_km,p_route_plan
    ) RETURNING id INTO rid;
  END IF;

  FOR b IN SELECT value FROM jsonb_array_elements(p_bookings)
  LOOP
    booking_id:=nullif(b->>'id','')::uuid;
    contact_phone:=nullif(b->>'contactPhone','');
    IF coalesce((b->>'forOtherPerson')::boolean,false) THEN
      IF length(trim(coalesce(b->>'contactName','')))<2 OR contact_phone !~ '^09[0-9]{9}$' THEN
        RAISE EXCEPTION 'نام و شماره همراه معتبر مسافر جایگزین لازم است';
      END IF;
    ELSE
      contact_phone:=NULL;
    END IF;

    IF booking_id IS NULL THEN
      INSERT INTO public.shared_bookings(
        ride_id,user_id,seats,origin,destination,origin_lat,origin_lng,destination_lat,destination_lng,
        distance_km,fare_amount,mountain,request_note,women_only,female_driver_requested,for_other_person,contact_name
      ) VALUES (
        rid,(b->>'userId')::uuid,(b->>'seats')::integer,
        left(trim(b->>'origin'),160),left(trim(b->>'destination'),160),
        (b->'originPoint'->>'lat')::double precision,(b->'originPoint'->>'lng')::double precision,
        (b->'destinationPoint'->>'lat')::double precision,(b->'destinationPoint'->>'lng')::double precision,
        (b->>'distanceKm')::numeric,(b->>'fareAmount')::integer,
        coalesce((b->>'mountain')::boolean,false),left(trim(coalesce(b->>'requestNote','')),500),
        coalesce((b->>'womenOnly')::boolean,false),coalesce((b->>'femaleDriverRequested')::boolean,false),
        coalesce((b->>'forOtherPerson')::boolean,false),nullif(left(trim(coalesce(b->>'contactName','')),80),'')
      ) RETURNING id INTO new_booking_id;
      booking_id:=new_booking_id;
    ELSE
      UPDATE public.shared_bookings SET
        distance_km=(b->>'distanceKm')::numeric,
        fare_amount=(b->>'fareAmount')::integer
      WHERE id=booking_id AND ride_id=rid AND user_id=(b->>'userId')::uuid;
      IF NOT FOUND THEN RAISE EXCEPTION 'رزرو یکی از مسافران گروه تغییر کرده است'; END IF;
    END IF;

    IF contact_phone IS NOT NULL THEN
      INSERT INTO public.shared_booking_private_data(booking_id,contact_phone_ciphertext,updated_at)
      VALUES (
        booking_id,
        encode(extensions.pgp_sym_encrypt(contact_phone,public.trip_contact_encryption_key(),'cipher-algo=aes256'),'base64'),
        now()
      )
      ON CONFLICT(booking_id) DO UPDATE
      SET contact_phone_ciphertext=EXCLUDED.contact_phone_ciphertext,updated_at=now();
    END IF;
  END LOOP;

  UPDATE public.shared_rides SET
    total_fare=v_total_fare,
    state=CASE WHEN total_seats=3 THEN 'locked' ELSE 'open' END,
    total_distance_km=p_total_distance_km,
    route_plan=p_route_plan,
    origin=p_origin,destination=p_destination,
    origin_lat=p_origin_lat,origin_lng=p_origin_lng,
    destination_lat=p_destination_lat,destination_lng=p_destination_lng
  WHERE id=rid;

  RETURN rid;
END;
$$;
REVOKE ALL ON FUNCTION public.create_or_update_shared_route(uuid,uuid,timestamptz,jsonb,jsonb,numeric,text,text,double precision,double precision,double precision,double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_or_update_shared_route(uuid,uuid,timestamptz,jsonb,jsonb,numeric,text,text,double precision,double precision,double precision,double precision) TO service_role;

-- Keep the public-facing listing private and return each passenger's computed share.
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
        'seats',b.seats,'confirmed',b.final_confirmed,'amount',coalesce(b.fare_amount,0),'distanceKm',coalesce(b.distance_km,0),
        'requestNote',b.request_note,'womenOnly',b.women_only,'femaleDriverRequested',b.female_driver_requested,
        'forOtherPerson',b.for_other_person,'contactName',b.contact_name
      ) FROM public.shared_bookings b WHERE b.ride_id=r.id AND b.user_id=auth.uid()),
      'driverId',r.driver_id,'totalDistanceKm',r.total_distance_km
    ) item
    FROM public.shared_rides r
    WHERE auth.uid() IS NOT NULL
      AND EXISTS(SELECT 1 FROM public.shared_bookings b WHERE b.ride_id=r.id AND b.user_id=auth.uid())
  ) s;
$$;
REVOKE ALL ON FUNCTION public.shared_listing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shared_listing() TO authenticated;

-- Drivers see each passenger's own route and calculated share, never their alternate phone.
CREATE OR REPLACE FUNCTION public.driver_shared_requests()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'driver') OR NOT public.is_driver_fully_approved(auth.uid()) THEN
    RAISE EXCEPTION 'فقط راننده کاملاً تأییدشده می‌تواند درخواست‌های اشتراکی را ببیند';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id',r.id,'origin',r.origin,'destination',r.destination,'departureAt',r.departure_at,
      'totalFare',r.total_fare,'state',r.state,'totalDistanceKm',r.total_distance_km,'routePlan',r.route_plan,
      'occupied',coalesce((SELECT sum(b.seats)::integer FROM public.shared_bookings b WHERE b.ride_id=r.id),0),
      'ownerName',owner.display_name,
      'passengerRequests',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'bookingId',b.id,'name',coalesce(nullif(trim(p.display_name),''),'مسافر'),'seats',b.seats,
          'requestedAt',b.created_at,'origin',b.origin,'destination',b.destination,
          'distanceKm',b.distance_km,'fareAmount',b.fare_amount,'requestNote',b.request_note,
          'womenOnly',b.women_only,'femaleDriverRequested',b.female_driver_requested,
          'forOtherPerson',b.for_other_person,'contactName',b.contact_name
        ) ORDER BY b.created_at,b.id),'[]'::jsonb)
        FROM public.shared_bookings b JOIN public.profiles p ON p.id=b.user_id WHERE b.ride_id=r.id
      )
    ) ORDER BY r.created_at)
    FROM public.shared_rides r JOIN public.profiles owner ON owner.id=r.owner_id
    WHERE r.departure_at>now() AND r.driver_id IS NULL AND r.state IN ('open','locked','confirmed')
  ),'[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.driver_shared_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_shared_requests() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_shared_booking_contact(p_ride uuid,p_booking uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.shared_rides r
    WHERE r.id=p_ride AND r.driver_id=auth.uid() AND r.state IN ('open','locked','confirmed','ongoing','done')
  ) THEN RAISE EXCEPTION 'فقط راننده پذیرفته‌شده می‌تواند شماره تماس مسافر را ببیند'; END IF;
  RETURN (
    SELECT jsonb_build_object(
      'name',b.contact_name,
      'phone',extensions.pgp_sym_decrypt(decode(d.contact_phone_ciphertext,'base64'),public.trip_contact_encryption_key())
    )
    FROM public.shared_bookings b JOIN public.shared_booking_private_data d ON d.booking_id=b.id
    WHERE b.id=p_booking AND b.ride_id=p_ride AND b.for_other_person=true
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_shared_booking_contact(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_shared_booking_contact(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_trip_with_details(
  p_origin text,p_destination text,p_departure timestamptz,p_km numeric,p_night boolean,p_mountain boolean,
  p_origin_lat double precision,p_origin_lng double precision,p_destination_lat double precision,p_destination_lng double precision,
  p_suggested integer DEFAULT NULL,p_payment_method text DEFAULT 'cash',p_ride_type text DEFAULT 'intercity',
  p_request_note text DEFAULT '',p_female_driver_requested boolean DEFAULT false,
  p_for_other_person boolean DEFAULT false,p_contact_name text DEFAULT NULL,p_contact_phone text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions
AS $$
DECLARE rid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ورود لازم است'; END IF;
  IF length(coalesce(p_request_note,''))>500 THEN RAISE EXCEPTION 'توضیحات سفر بیش از ۵۰۰ نویسه است'; END IF;
  IF p_for_other_person AND (
    length(trim(coalesce(p_contact_name,'')))<2 OR coalesce(p_contact_phone,'') !~ '^09[0-9]{9}$'
  ) THEN RAISE EXCEPTION 'نام و شماره همراه معتبر مسافر لازم است'; END IF;
  rid:=public.create_trip(
    p_origin,p_destination,p_departure,p_km,p_night,p_mountain,
    p_origin_lat,p_origin_lng,p_destination_lat,p_destination_lng,
    p_suggested,p_payment_method,p_ride_type
  );
  UPDATE public.trips SET request_note=left(trim(coalesce(p_request_note,'')),500),
    female_driver_requested=coalesce(p_female_driver_requested,false),
    for_other_person=coalesce(p_for_other_person,false)
  WHERE id=rid;
  IF p_for_other_person THEN
    INSERT INTO public.trip_private_contacts(trip_id,contact_name,contact_phone_ciphertext,updated_at)
    VALUES(rid,left(trim(p_contact_name),80),
      encode(extensions.pgp_sym_encrypt(p_contact_phone,public.trip_contact_encryption_key(),'cipher-algo=aes256'),'base64'),now());
  END IF;
  RETURN rid;
END;
$$;
REVOKE ALL ON FUNCTION public.create_trip_with_details(text,text,timestamptz,numeric,boolean,boolean,double precision,double precision,double precision,double precision,integer,text,text,text,boolean,boolean,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_trip_with_details(text,text,timestamptz,numeric,boolean,boolean,double precision,double precision,double precision,double precision,integer,text,text,text,boolean,boolean,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_trip_alternate_contact(p_trip uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.trips t WHERE t.id=p_trip
      AND (t.driver_id=auth.uid() AND t.status IN ('accepted','ongoing','done')
        OR public.has_role(auth.uid(),'admin'))
  ) THEN RAISE EXCEPTION 'شماره تماس فقط پس از پذیرش سفر در دسترس راننده است'; END IF;
  RETURN (
    SELECT jsonb_build_object('name',c.contact_name,
      'phone',extensions.pgp_sym_decrypt(decode(c.contact_phone_ciphertext,'base64'),public.trip_contact_encryption_key()))
    FROM public.trip_private_contacts c WHERE c.trip_id=p_trip
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_trip_alternate_contact(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_trip_alternate_contact(uuid) TO authenticated;
