CREATE POLICY admin_trip_read ON public.trips FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY admin_ticket_read ON public.support_tickets FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY admin_profile_read ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY admin_doc_read ON public.driver_documents FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY admin_driver_docs_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id='driver-documents' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY admin_role_read ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE FUNCTION public.admin_set_ticket_status(p_ticket uuid, p_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'دسترسی محدود'; END IF;
  IF p_status NOT IN ('open','review','resolved') THEN RAISE EXCEPTION 'وضعیت نامعتبر'; END IF;
  UPDATE public.support_tickets SET status=p_status WHERE id=p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'تیکت یافت نشد'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_ticket_status(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_ticket_status(uuid,text) TO authenticated;