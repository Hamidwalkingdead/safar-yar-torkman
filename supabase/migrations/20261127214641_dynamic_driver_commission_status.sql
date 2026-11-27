DO $$
DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('public.get_driver_commission_status()'::regprocedure);
  definition := replace(
    definition,
    'round(total_fare*0.10)::bigint',
    'round(total_fare*(SELECT commission_rate FROM public.platform_commission_settings WHERE id=true))::bigint'
  );
  IF definition = pg_get_functiondef('public.get_driver_commission_status()'::regprocedure) THEN
    RAISE EXCEPTION 'Expected fixed shared commission expression was not found';
  END IF;
  EXECUTE definition;
END;
$$;