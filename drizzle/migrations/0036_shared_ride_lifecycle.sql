-- Add a real start/finish lifecycle for accepted shared rides.
ALTER TABLE public.shared_rides
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE public.shared_rides
  DROP CONSTRAINT IF EXISTS shared_rides_state_check;
ALTER TABLE public.shared_rides
  ADD CONSTRAINT shared_rides_state_check
  CHECK (state IN ('open','locked','confirmed','ongoing','done','cancelled'));

CREATE OR REPLACE FUNCTION public.start_shared_ride(p_ride uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r public.shared_rides;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_driver_fully_approved(auth.uid()) THEN
    RAISE EXCEPTION 'فقط راننده کاملاً تأییدشده می‌تواند سفر اشتراکی را آغاز کند';
  END IF;

  SELECT * INTO r FROM public.shared_rides WHERE id=p_ride FOR UPDATE;
  IF NOT FOUND OR r.driver_id IS DISTINCT FROM auth.uid() OR r.state<>'confirmed' THEN
    RAISE EXCEPTION 'آغاز سفر فقط برای راننده همان گروه و پس از تأیید سهم کرایه همه مسافران ممکن است';
  END IF;
  IF r.departure_at>now()+interval '30 minutes'
     OR r.departure_at<now()-interval '12 hours' THEN
    RAISE EXCEPTION 'زمان آغاز سفر با زمان حرکت ثبت‌شده هماهنگ نیست';
  END IF;

  UPDATE public.shared_rides
  SET state='ongoing',started_at=now()
  WHERE id=p_ride;
END; $fn$;
REVOKE ALL ON FUNCTION public.start_shared_ride(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.start_shared_ride(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_shared_ride(p_ride uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ورود لازم است'; END IF;
  UPDATE public.shared_rides
  SET state='done',completed_at=now()
  WHERE id=p_ride AND driver_id=auth.uid() AND state='ongoing';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'پایان سفر فقط توسط راننده همان گروه و پس از آغاز سفر ممکن است';
  END IF;
END; $fn$;
REVOKE ALL ON FUNCTION public.complete_shared_ride(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_shared_ride(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_shared_ride(p_ride uuid,p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r public.shared_rides;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ورود لازم است'; END IF;
  SELECT * INTO r FROM public.shared_rides WHERE id=p_ride FOR UPDATE;
  IF NOT FOUND OR (r.owner_id<>auth.uid() AND r.driver_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'لغو این گروه برای حساب شما مجاز نیست';
  END IF;
  IF r.state NOT IN ('open','locked','confirmed') THEN
    RAISE EXCEPTION 'پس از آغاز سفر، لغو از این مسیر ممکن نیست';
  END IF;
  IF p_reason IS NOT NULL AND length(trim(p_reason))>500 THEN
    RAISE EXCEPTION 'توضیح لغو بیش از حد طولانی است';
  END IF;

  UPDATE public.shared_rides
  SET state='cancelled',
      cancelled_at=now(),
      cancelled_by=auth.uid(),
      cancel_reason=nullif(left(trim(coalesce(p_reason,'')),500),'')
  WHERE id=p_ride;
END; $fn$;
REVOKE ALL ON FUNCTION public.cancel_shared_ride(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_shared_ride(uuid,text) TO authenticated;

-- Keep chat history readable to the same group after completion/cancellation,
-- but stop new messages, voice uploads and GPS updates when the trip closes.
CREATE OR REPLACE FUNCTION public.is_shared_ride_chat_active(p_ride uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
  SELECT public.is_shared_ride_participant(p_ride)
    AND EXISTS (
      SELECT 1 FROM public.shared_rides r
      WHERE r.id=p_ride AND r.driver_id IS NOT NULL
        AND r.state IN ('open','locked','confirmed','ongoing')
    );
$fn$;
REVOKE ALL ON FUNCTION public.is_shared_ride_chat_active(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_shared_ride_chat_active(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_shared_ride_chat_visible(p_ride uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
  SELECT public.is_shared_ride_participant(p_ride)
    AND EXISTS (
      SELECT 1 FROM public.shared_rides r
      WHERE r.id=p_ride AND r.driver_id IS NOT NULL
    );
$fn$;
REVOKE ALL ON FUNCTION public.is_shared_ride_chat_visible(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_shared_ride_chat_visible(uuid) TO authenticated;

DROP POLICY IF EXISTS shared_ride_messages_participant_read ON public.shared_ride_messages;
CREATE POLICY shared_ride_messages_participant_read ON public.shared_ride_messages
  FOR SELECT TO authenticated USING (public.is_shared_ride_chat_visible(ride_id));

DROP POLICY IF EXISTS shared_ride_participants_read_voice ON storage.objects;
CREATE POLICY shared_ride_participants_read_voice ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id='shared-ride-voice'
    AND public.is_shared_ride_chat_visible((storage.foldername(name))[1]::uuid)
  );
