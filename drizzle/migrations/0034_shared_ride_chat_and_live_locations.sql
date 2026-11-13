-- Group chat and live locations for automatically matched shared rides.
CREATE OR REPLACE FUNCTION public.is_shared_ride_participant(p_ride uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.shared_rides r
    WHERE r.id=p_ride AND r.driver_id=auth.uid()
    UNION ALL
    SELECT 1 FROM public.shared_bookings b
    WHERE b.ride_id=p_ride AND b.user_id=auth.uid()
  );
$fn$;
REVOKE ALL ON FUNCTION public.is_shared_ride_participant(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_shared_ride_participant(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.is_shared_ride_chat_active(p_ride uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
  SELECT public.is_shared_ride_participant(p_ride)
    AND EXISTS (SELECT 1 FROM public.shared_rides r WHERE r.id=p_ride AND r.driver_id IS NOT NULL AND r.state<>'cancelled');
$fn$;
REVOKE ALL ON FUNCTION public.is_shared_ride_chat_active(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_shared_ride_chat_active(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.shared_ride_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.shared_rides(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text,
  audio_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shared_ride_messages_content_check CHECK (
    (body IS NOT NULL AND length(trim(body)) BETWEEN 1 AND 4000 AND audio_path IS NULL)
    OR (body IS NULL AND audio_path IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS shared_ride_messages_ride_created_idx
  ON public.shared_ride_messages(ride_id,created_at);
ALTER TABLE public.shared_ride_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.shared_ride_messages TO authenticated;
DROP POLICY IF EXISTS shared_ride_messages_participant_read ON public.shared_ride_messages;
CREATE POLICY shared_ride_messages_participant_read ON public.shared_ride_messages
  FOR SELECT TO authenticated USING (
    public.is_shared_ride_chat_active(ride_id)
  );

CREATE OR REPLACE FUNCTION public.send_shared_ride_message(p_ride uuid,p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE message_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_shared_ride_chat_active(p_ride) THEN
    RAISE EXCEPTION 'گفت‌وگوی سفر فقط پس از پذیرش راننده و برای اعضای همان گروه فعال است';
  END IF;
  IF p_body IS NULL OR length(trim(p_body)) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'متن پیام باید بین ۱ تا ۴۰۰۰ نویسه باشد';
  END IF;
  INSERT INTO public.shared_ride_messages(ride_id,sender_id,body)
  VALUES(p_ride,auth.uid(),trim(p_body)) RETURNING id INTO message_id;
  RETURN message_id;
END; $fn$;
REVOKE ALL ON FUNCTION public.send_shared_ride_message(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.send_shared_ride_message(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.send_shared_ride_voice(p_ride uuid,p_audio_path text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE message_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_shared_ride_chat_active(p_ride) THEN
    RAISE EXCEPTION 'گفت‌وگوی سفر فقط پس از پذیرش راننده و برای اعضای همان گروه فعال است';
  END IF;
  IF p_audio_path IS NULL OR p_audio_path !~ ('^' || p_ride::text || '/' || auth.uid()::text || '/[0-9a-f-]+\.(webm|mp4|ogg)$') THEN
    RAISE EXCEPTION 'مسیر فایل صوتی معتبر نیست';
  END IF;
  INSERT INTO public.shared_ride_messages(ride_id,sender_id,audio_path)
  VALUES(p_ride,auth.uid(),p_audio_path) RETURNING id INTO message_id;
  RETURN message_id;
END; $fn$;
REVOKE ALL ON FUNCTION public.send_shared_ride_voice(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.send_shared_ride_voice(uuid,text) TO authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('shared-ride-voice','shared-ride-voice',false,10485760,ARRAY['audio/webm','audio/mp4','audio/ogg'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=10485760,allowed_mime_types=EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS shared_ride_participants_upload_voice ON storage.objects;
CREATE POLICY shared_ride_participants_upload_voice ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id='shared-ride-voice'
    AND (storage.foldername(name))[2]=auth.uid()::text
    AND public.is_shared_ride_chat_active((storage.foldername(name))[1]::uuid)
  );
DROP POLICY IF EXISTS shared_ride_participants_read_voice ON storage.objects;
CREATE POLICY shared_ride_participants_read_voice ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id='shared-ride-voice'
    AND public.is_shared_ride_chat_active((storage.foldername(name))[1]::uuid)
  );
DROP POLICY IF EXISTS shared_ride_participants_delete_own_voice ON storage.objects;
CREATE POLICY shared_ride_participants_delete_own_voice ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id='shared-ride-voice'
    AND (storage.foldername(name))[2]=auth.uid()::text
    AND public.is_shared_ride_chat_active((storage.foldername(name))[1]::uuid)
  );

CREATE TABLE IF NOT EXISTS public.shared_ride_locations (
  ride_id uuid NOT NULL REFERENCES public.shared_rides(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  latitude double precision NOT NULL CHECK(latitude BETWEEN 24 AND 40.5),
  longitude double precision NOT NULL CHECK(longitude BETWEEN 43 AND 64),
  accuracy_m double precision,
  heading_deg double precision,
  speed_mps double precision,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(ride_id,user_id)
);
CREATE INDEX IF NOT EXISTS shared_ride_locations_ride_updated_idx
  ON public.shared_ride_locations(ride_id,updated_at DESC);
ALTER TABLE public.shared_ride_locations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.shared_ride_locations TO authenticated;
DROP POLICY IF EXISTS shared_ride_locations_participant_read ON public.shared_ride_locations;
CREATE POLICY shared_ride_locations_participant_read ON public.shared_ride_locations
  FOR SELECT TO authenticated USING (
    public.is_shared_ride_chat_active(ride_id)
  );

CREATE OR REPLACE FUNCTION public.upsert_shared_ride_location(
  p_ride uuid,p_latitude double precision,p_longitude double precision,
  p_accuracy double precision DEFAULT NULL,p_heading double precision DEFAULT NULL,p_speed double precision DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_shared_ride_chat_active(p_ride) THEN
    RAISE EXCEPTION 'اشتراک موقعیت فقط پس از پذیرش راننده و برای اعضای همان گروه مجاز است';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude NOT BETWEEN 24 AND 40.5 OR p_longitude NOT BETWEEN 43 AND 64
     OR (p_accuracy IS NOT NULL AND (p_accuracy<0 OR p_accuracy>10000))
     OR (p_heading IS NOT NULL AND p_heading NOT BETWEEN 0 AND 360)
     OR (p_speed IS NOT NULL AND (p_speed<0 OR p_speed>100)) THEN
    RAISE EXCEPTION 'مختصات یا داده GPS معتبر نیست';
  END IF;
  INSERT INTO public.shared_ride_locations(ride_id,user_id,latitude,longitude,accuracy_m,heading_deg,speed_mps,updated_at)
  VALUES(p_ride,auth.uid(),p_latitude,p_longitude,p_accuracy,p_heading,p_speed,now())
  ON CONFLICT(ride_id,user_id) DO UPDATE SET
    latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,accuracy_m=EXCLUDED.accuracy_m,
    heading_deg=EXCLUDED.heading_deg,speed_mps=EXCLUDED.speed_mps,updated_at=now();
END; $fn$;
REVOKE ALL ON FUNCTION public.upsert_shared_ride_location(uuid,double precision,double precision,double precision,double precision,double precision) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.upsert_shared_ride_location(uuid,double precision,double precision,double precision,double precision,double precision) TO authenticated;

CREATE OR REPLACE FUNCTION public.driver_assigned_shared_rides()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_driver_fully_approved(auth.uid()) THEN
    RAISE EXCEPTION 'فقط راننده کاملاً تأییدشده می‌تواند سفرهای واگذارشده را ببیند';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id',r.id,'origin',r.origin,'destination',r.destination,'departureAt',r.departure_at,
      'totalFare',r.total_fare,'state',r.state,
      'occupied',coalesce((SELECT sum(b.seats) FROM public.shared_bookings b WHERE b.ride_id=r.id),0),
      'ownerName',p.display_name
    ) ORDER BY r.departure_at)
    FROM public.shared_rides r JOIN public.profiles p ON p.id=r.owner_id
    WHERE r.driver_id=auth.uid() AND r.departure_at>=now()-interval '1 day' AND r.state<>'cancelled'
  ),'[]'::jsonb);
END; $fn$;
REVOKE ALL ON FUNCTION public.driver_assigned_shared_rides() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_assigned_shared_rides() TO authenticated;


CREATE OR REPLACE FUNCTION public.shared_driver_status(p_ride uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $fn$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_shared_ride_participant(p_ride) THEN
    RAISE EXCEPTION 'دسترسی مجاز نیست';
  END IF;
  SELECT CASE WHEN r.driver_id IS NULL THEN NULL ELSE jsonb_build_object(
    'driverId',r.driver_id,'name',p.display_name,'car',p.car,'plate',p.plate,'acceptedAt',r.driver_accepted_at
  ) END INTO result
  FROM public.shared_rides r LEFT JOIN public.profiles p ON p.id=r.driver_id
  WHERE r.id=p_ride;
  RETURN result;
END; $fn$;
REVOKE ALL ON FUNCTION public.shared_driver_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shared_driver_status(uuid) TO authenticated;
