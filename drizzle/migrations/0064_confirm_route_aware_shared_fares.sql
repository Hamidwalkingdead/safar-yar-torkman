-- The route-aware matcher stores an individually calculated fare per booking.
-- Reconfirmation must validate that exact fare, not replace it with an equal split.
CREATE OR REPLACE FUNCTION public.confirm_shared_price(
  p_ride uuid,
  p_amount integer,
  p_consent boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  r public.shared_rides;
  amount integer;
BEGIN
  IF auth.uid() IS NULL OR p_consent IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ورود و تأیید سهم کرایه لازم است';
  END IF;

  SELECT * INTO r
  FROM public.shared_rides
  WHERE id=p_ride
  FOR UPDATE;

  IF NOT FOUND OR r.state<>'locked' THEN
    RAISE EXCEPTION 'قیمت هنوز نهایی نشده یا تأیید نشده است';
  END IF;

  SELECT fare_amount INTO amount
  FROM public.shared_bookings
  WHERE ride_id=p_ride AND user_id=auth.uid()
  FOR UPDATE;

  IF amount IS NULL OR amount<>p_amount THEN
    RAISE EXCEPTION 'سهم کرایه تغییر کرده؛ مبلغ تازه را بررسی و دوباره تأیید کنید';
  END IF;

  UPDATE public.shared_bookings
  SET final_confirmed=true
  WHERE ride_id=p_ride AND user_id=auth.uid();

  IF NOT EXISTS(
    SELECT 1 FROM public.shared_bookings
    WHERE ride_id=p_ride AND NOT final_confirmed
  ) THEN
    UPDATE public.shared_rides SET state='confirmed' WHERE id=p_ride;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_shared_price(uuid,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_shared_price(uuid,integer,boolean) TO authenticated;
