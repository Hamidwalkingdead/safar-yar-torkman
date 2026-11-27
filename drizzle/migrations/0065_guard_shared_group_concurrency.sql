-- Reject stale or incomplete candidate snapshots so concurrent requests cannot
-- overwrite a newly added passenger's route or fare.
CREATE OR REPLACE FUNCTION public.create_or_update_shared_route(
  p_user uuid,p_ride uuid,p_departure timestamptz,p_bookings jsonb,p_route_plan jsonb,
  p_total_distance_km numeric,p_origin text,p_destination text,
  p_origin_lat double precision,p_origin_lng double precision,
  p_destination_lat double precision,p_destination_lng double precision
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,extensions
AS $function$
DECLARE
  rid uuid;
  b jsonb;
  booking_id uuid;
  total_seats integer;
  v_total_fare bigint;
  new_booking_id uuid;
  contact_phone text;
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

  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_bookings) x
    GROUP BY x->>'userId' HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'مسافر تکراری در گروه وجود دارد';
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
    SELECT id INTO rid FROM public.shared_rides
    WHERE id=p_ride AND state='open' AND driver_id IS NULL FOR UPDATE;
    IF NOT FOUND OR (SELECT departure_at FROM public.shared_rides WHERE id=p_ride)<=now()
       OR abs(extract(epoch FROM ((SELECT departure_at FROM public.shared_rides WHERE id=p_ride)-p_departure)))>3600 THEN
      RAISE EXCEPTION 'گروه هم‌مسیر دیگر ظرفیت یا شرایط لازم را ندارد';
    END IF;

    -- The edge function may have calculated against an old snapshot. Require
    -- every current booking, and only those bookings, in the recalculated payload.
    IF (SELECT count(*) FROM public.shared_bookings WHERE ride_id=p_ride)
       <> (SELECT count(*) FROM jsonb_array_elements(p_bookings) x WHERE nullif(x->>'id','') IS NOT NULL)
       OR EXISTS (
         SELECT 1 FROM public.shared_bookings b
         WHERE b.ride_id=p_ride
           AND NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(p_bookings) x
             WHERE nullif(x->>'id','')::uuid=b.id
               AND (x->>'userId')::uuid=b.user_id
           )
       )
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_bookings) x
         WHERE nullif(x->>'id','') IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM public.shared_bookings b
             WHERE b.id=(x->>'id')::uuid AND b.ride_id=p_ride
               AND b.user_id=(x->>'userId')::uuid
           )
       ) THEN
      RAISE EXCEPTION 'گروه هم‌مسیر هم‌زمان تغییر کرده است؛ دوباره درخواست دهید';
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
$function$;
