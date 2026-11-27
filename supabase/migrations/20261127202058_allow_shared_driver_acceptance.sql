-- Driver distance must not block acceptance of an otherwise valid shared ride.
-- Keep calculating and allocating the approach fare, but remove the 135% detour rejection.
CREATE OR REPLACE FUNCTION public.accept_shared_ride_with_approach(
  p_ride uuid,p_driver uuid,p_driver_lat double precision,p_driver_lng double precision,p_approach_km numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $function$
DECLARE r public.shared_rides; v_seats integer; v_night boolean;
        v_extra_fare bigint; v_per_seat bigint; v_remainder integer;
BEGIN
  IF p_driver IS NULL OR NOT public.is_driver_fully_approved(p_driver)
    THEN RAISE EXCEPTION 'فقط راننده کاملاً تأییدشده می‌تواند گروه را بپذیرد'; END IF;
  IF p_driver_lat IS NULL OR p_driver_lat NOT BETWEEN 24 AND 40.5
     OR p_driver_lng IS NULL OR p_driver_lng NOT BETWEEN 43 AND 64
     OR p_approach_km IS NULL OR p_approach_km<0 OR p_approach_km>500
    THEN RAISE EXCEPTION 'موقعیت راننده یا مسافت رسیدن به مبدأ معتبر نیست'; END IF;
  SELECT * INTO r FROM public.shared_rides WHERE id=p_ride FOR UPDATE;
  IF NOT FOUND OR r.departure_at<=now() OR r.driver_id IS NOT NULL OR r.state NOT IN ('open','locked','confirmed')
    THEN RAISE EXCEPTION 'این گروه قبلاً پذیرفته شده یا دیگر فعال نیست'; END IF;
  IF jsonb_typeof(r.route_plan)<>'array' OR jsonb_array_length(r.route_plan)<2
    THEN RAISE EXCEPTION 'برنامه توقف‌های این گروه کامل نیست؛ پذیرش انجام نشد'; END IF;
  SELECT coalesce(sum(seats),0)::integer INTO v_seats FROM public.shared_bookings WHERE ride_id=p_ride;
  IF v_seats NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'ظرفیت مسافران این گروه معتبر نیست'; END IF;

  v_night:=EXTRACT(HOUR FROM r.departure_at AT TIME ZONE 'Asia/Tehran')>=22
    OR EXTRACT(HOUR FROM r.departure_at AT TIME ZONE 'Asia/Tehran')<6;
  v_extra_fare:=round(p_approach_km*14000
    +CASE WHEN v_night THEN p_approach_km*1500 ELSE 0 END
    +greatest(0,p_approach_km-300)*1000)::bigint;
  IF v_extra_fare>2147483647-r.total_fare THEN RAISE EXCEPTION 'هزینه رسیدن راننده از محدوده مجاز بیشتر است'; END IF;
  v_per_seat:=v_extra_fare/v_seats;
  v_remainder:=(v_extra_fare%v_seats)::integer;

  WITH ordered AS (
    SELECT id,seats,coalesce(sum(seats) OVER(ORDER BY created_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0)::integer AS seats_before
    FROM public.shared_bookings WHERE ride_id=p_ride
  )
  UPDATE public.shared_bookings b
  SET fare_amount=coalesce(b.fare_amount,0)+(v_per_seat*b.seats+greatest(0,least(b.seats,v_remainder-o.seats_before)))::integer,
      distance_km=coalesce(b.distance_km,0)+(p_approach_km/v_seats),final_confirmed=false
  FROM ordered o WHERE b.id=o.id;

  UPDATE public.shared_rides SET
    total_fare=(SELECT sum(fare_amount)::integer FROM public.shared_bookings WHERE ride_id=p_ride),
    total_distance_km=coalesce(total_distance_km,0)+p_approach_km,
    route_plan=jsonb_build_array(jsonb_build_object('kind','driver_start','name','موقعیت راننده هنگام پذیرش','lat',p_driver_lat,'lng',p_driver_lng))||route_plan,
    driver_id=p_driver,driver_accepted_at=now(),state='locked'
  WHERE id=p_ride;
END;
$function$;
