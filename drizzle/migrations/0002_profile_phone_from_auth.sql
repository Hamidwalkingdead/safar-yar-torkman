CREATE OR REPLACE FUNCTION public.create_trip_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.profiles(id, phone)
  VALUES (NEW.id, CASE WHEN coalesce(NEW.phone,'') ~ '^\+?989[0-9]{9}$' THEN '0' || right(regexp_replace(NEW.phone,'\D','','g'), 10) ELSE '' END)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.create_trip_profile() FROM PUBLIC;