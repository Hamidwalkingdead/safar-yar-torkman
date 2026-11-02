CREATE TABLE IF NOT EXISTS public.trip_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text,
  audio_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_messages_content_check CHECK (
    (body IS NOT NULL AND length(trim(body)) BETWEEN 1 AND 4000 AND audio_path IS NULL)
    OR (body IS NULL AND audio_path IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS trip_messages_trip_created_idx ON public.trip_messages(trip_id, created_at);
ALTER TABLE public.trip_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trip participants read messages" ON public.trip_messages;
CREATE POLICY "trip participants read messages" ON public.trip_messages FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id=trip_id AND auth.uid() IN (t.passenger_id,t.driver_id) AND t.status IN ('accepted','ongoing','done')));
DROP POLICY IF EXISTS "trip participants send messages" ON public.trip_messages;
CREATE POLICY "trip participants send messages" ON public.trip_messages FOR INSERT TO authenticated
WITH CHECK (sender_id=auth.uid() AND EXISTS (SELECT 1 FROM public.trips t WHERE t.id=trip_id AND auth.uid() IN (t.passenger_id,t.driver_id) AND t.status IN ('accepted','ongoing')));
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('trip-voice','trip-voice',false,10485760,ARRAY['audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav'])
ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=10485760,allowed_mime_types=EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS "trip participants upload voice" ON storage.objects;
CREATE POLICY "trip participants upload voice" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='trip-voice' AND EXISTS (
 SELECT 1 FROM public.trips t WHERE t.id=(storage.foldername(name))[1]::uuid
 AND auth.uid() IN (t.passenger_id,t.driver_id) AND t.status IN ('accepted','ongoing')
 AND (storage.foldername(name))[2]=auth.uid()::text
));
DROP POLICY IF EXISTS "trip participants read voice" ON storage.objects;
CREATE POLICY "trip participants read voice" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='trip-voice' AND EXISTS (
 SELECT 1 FROM public.trips t WHERE t.id=(storage.foldername(name))[1]::uuid
 AND auth.uid() IN (t.passenger_id,t.driver_id) AND t.status IN ('accepted','ongoing','done')
));
