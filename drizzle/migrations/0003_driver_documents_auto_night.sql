CREATE TABLE public.driver_documents (
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('car_card','insurance','car_inside','car_outside','license','selfie')),
  path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);
GRANT SELECT, INSERT, UPDATE ON public.driver_documents TO authenticated;
GRANT ALL ON public.driver_documents TO service_role;
ALTER TABLE public.driver_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_doc_read ON public.driver_documents FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY own_doc_insert ON public.driver_documents FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND split_part(path,'/',1) = auth.uid()::text);
CREATE POLICY own_doc_update ON public.driver_documents FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND split_part(path,'/',1) = auth.uid()::text);

CREATE POLICY driver_docs_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY driver_docs_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id='driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY driver_docs_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id='driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE OR REPLACE FUNCTION public.register_driver() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND length(trim(display_name))>=2 AND phone ~ '^09[0-9]{9}$' AND length(trim(car))>=2 AND length(trim(plate))>=2) THEN
    RAISE EXCEPTION 'ابتدا نام، شماره تماس و مشخصات خودرو را کامل کنید';
  END IF;
  IF (SELECT count(*) FROM public.driver_documents d JOIN storage.objects o ON o.bucket_id='driver-documents' AND o.name=d.path WHERE d.user_id=auth.uid()) < 6 THEN
    RAISE EXCEPTION 'بارگذاری هر شش عکس مدارک الزامی است';
  END IF;
  INSERT INTO public.user_roles(user_id,role) VALUES(auth.uid(),'driver') ON CONFLICT DO NOTHING;
END; $$;
REVOKE ALL ON FUNCTION public.register_driver() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_driver() TO authenticated;

CREATE OR REPLACE FUNCTION public.create_trip(p_origin text,p_destination text,p_departure timestamptz,p_km numeric,p_night boolean,p_mountain boolean,p_suggested integer DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid; profile public.profiles; fare integer; calculated integer; v_night boolean; h integer;
BEGIN
 SELECT * INTO profile FROM public.profiles WHERE id=auth.uid();
 IF auth.uid() IS NULL OR NOT FOUND OR length(trim(profile.display_name))<2 OR profile.phone !~ '^09[0-9]{9}$' THEN RAISE EXCEPTION 'ابتدا پروفایل و شماره تماس را کامل کنید'; END IF;
 IF p_origin IS NULL OR p_destination IS NULL OR trim(p_origin)=trim(p_destination) OR p_departure IS NULL OR p_departure<=now() OR p_km IS NULL OR p_km<=0 OR p_km>3000 OR p_mountain IS NULL OR (p_suggested IS NOT NULL AND p_suggested<80000) THEN RAISE EXCEPTION 'اطلاعات سفر نامعتبر است'; END IF;
 h := extract(hour FROM p_departure AT TIME ZONE 'Asia/Tehran');
 v_night := h >= 22 OR h < 6;
 calculated:=public.trip_fare(p_km,v_night,p_mountain); fare:=coalesce(p_suggested,calculated);
 INSERT INTO public.trips(passenger_id,passenger_name,origin,destination,departure_at,km,night,mountain,calculated,suggested,agreed_fare,commission,driver_net) VALUES(auth.uid(),profile.display_name,trim(p_origin),trim(p_destination),p_departure,p_km,v_night,p_mountain,calculated,p_suggested,fare,round(fare*0.1)::integer,fare-round(fare*0.1)::integer) RETURNING id INTO rid;
 RETURN rid;
END; $$;
REVOKE ALL ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_trip(text,text,timestamptz,numeric,boolean,boolean,integer) TO authenticated;