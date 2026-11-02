CREATE TABLE IF NOT EXISTS public.driver_verifications (
 user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 reviewed_by uuid REFERENCES auth.users(id),
 reviewed_at timestamptz,
 note text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.driver_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_verification_self_read ON public.driver_verifications;
CREATE POLICY driver_verification_self_read ON public.driver_verifications FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS driver_verification_admin_write ON public.driver_verifications;
CREATE POLICY driver_verification_admin_write ON public.driver_verifications FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.reset_driver_verification_on_profile_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF (NEW.display_name,NEW.phone,NEW.car,NEW.plate) IS DISTINCT FROM (OLD.display_name,OLD.phone,OLD.car,OLD.plate) THEN
  INSERT INTO public.driver_verifications(user_id,status,reviewed_by,reviewed_at,note,updated_at)
  VALUES(NEW.id,'pending',NULL,NULL,'مشخصات راننده تغییر کرده و نیازمند بررسی مجدد است',now())
  ON CONFLICT(user_id) DO UPDATE SET status='pending',reviewed_by=NULL,reviewed_at=NULL,note='مشخصات راننده تغییر کرده و نیازمند بررسی مجدد است',updated_at=now();
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS profiles_reset_driver_verification ON public.profiles;
CREATE TRIGGER profiles_reset_driver_verification AFTER UPDATE OF display_name,phone,car,plate ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.reset_driver_verification_on_profile_change();

CREATE OR REPLACE FUNCTION public.reset_driver_verification_on_document_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid;
BEGIN
 uid := COALESCE(NEW.user_id,OLD.user_id);
 INSERT INTO public.driver_verifications(user_id,status,reviewed_by,reviewed_at,note,updated_at)
 VALUES(uid,'pending',NULL,NULL,'مدارک تغییر کرده و نیازمند بررسی مجدد است',now())
 ON CONFLICT(user_id) DO UPDATE SET status='pending',reviewed_by=NULL,reviewed_at=NULL,note='مدارک تغییر کرده و نیازمند بررسی مجدد است',updated_at=now();
 RETURN COALESCE(NEW,OLD);
END; $$;
DROP TRIGGER IF EXISTS driver_documents_reset_verification ON public.driver_documents;
CREATE TRIGGER driver_documents_reset_verification AFTER INSERT OR UPDATE OR DELETE ON public.driver_documents
FOR EACH ROW EXECUTE FUNCTION public.reset_driver_verification_on_document_change();

CREATE OR REPLACE FUNCTION public.admin_review_driver(p_user uuid,p_status text,p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE doc_count integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'دسترسی مدیر لازم است'; END IF;
 IF p_status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'وضعیت نامعتبر است'; END IF;
 SELECT count(DISTINCT kind) INTO doc_count FROM public.driver_documents WHERE user_id=p_user
 AND kind IN ('car_card','insurance','license','car_inside','car_outside','selfie');
 IF p_status='approved' AND doc_count<>6 THEN RAISE EXCEPTION 'همه شش مدرک الزامی باید بارگذاری شده باشند'; END IF;
 INSERT INTO public.driver_verifications(user_id,status,reviewed_by,reviewed_at,note,updated_at)
 VALUES(p_user,p_status,auth.uid(),now(),left(coalesce(p_note,''),500),now())
 ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,note=excluded.note,updated_at=now();
END; $$;
REVOKE ALL ON FUNCTION public.admin_review_driver(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_review_driver(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_shared_ride(p_ride uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.shared_rides;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'driver') OR NOT EXISTS (
  SELECT 1 FROM public.profiles p JOIN public.driver_verifications v ON v.user_id=p.id
  WHERE p.id=auth.uid() AND v.status='approved'
  AND length(trim(p.display_name))>=2 AND p.phone ~ '^09[0-9]{9}$'
  AND length(trim(p.car))>=2 AND length(trim(p.plate))>=2
 ) THEN RAISE EXCEPTION 'پذیرش سفر فقط پس از تأیید مدارک و مشخصات توسط مدیر ممکن است'; END IF;
 SELECT * INTO r FROM public.shared_rides WHERE id=p_ride FOR UPDATE;
 IF NOT FOUND OR r.departure_at<=now() OR r.driver_id IS NOT NULL OR r.state NOT IN ('open','locked','confirmed') THEN
  RAISE EXCEPTION 'این درخواست قبلاً پذیرفته شده یا دیگر فعال نیست';
 END IF;
 UPDATE public.shared_rides SET driver_id=auth.uid(),driver_accepted_at=now() WHERE id=p_ride;
END; $$;
REVOKE ALL ON FUNCTION public.accept_shared_ride(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_shared_ride(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.driver_shared_requests() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'driver') OR NOT EXISTS (
  SELECT 1 FROM public.profiles p JOIN public.driver_verifications v ON v.user_id=p.id
  WHERE p.id=auth.uid() AND v.status='approved'
 ) THEN RAISE EXCEPTION 'فقط راننده تأییدشده می‌تواند درخواست‌ها را ببیند'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
  'id',r.id,'origin',r.origin,'destination',r.destination,'departureAt',r.departure_at,
  'totalFare',r.total_fare,'state',r.state,'occupied',coalesce((SELECT sum(b.seats) FROM public.shared_bookings b WHERE b.ride_id=r.id),0),
  'ownerName',p.display_name,'driverId',r.driver_id
 ) ORDER BY r.departure_at) FROM public.shared_rides r JOIN public.profiles p ON p.id=r.owner_id
 WHERE r.departure_at>now() AND r.driver_id IS NULL AND r.state IN ('open','locked','confirmed')), '[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.driver_shared_requests() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_shared_requests() TO authenticated;