CREATE TABLE IF NOT EXISTS public.driver_login_rate_limits (
  attempt_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_login_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_login_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.driver_login_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_driver_login_rate_limit(
  p_key text,
  p_limit integer DEFAULT 8,
  p_window_seconds integer DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bucket timestamptz;
  current_count integer;
BEGIN
  IF p_key IS NULL OR length(p_key) < 32 OR length(p_key) > 128
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 30
    OR p_window_seconds IS NULL OR p_window_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION 'پارامتر محدودیت درخواست نامعتبر است';
  END IF;

  bucket := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  INSERT INTO public.driver_login_rate_limits(attempt_key, window_started_at, request_count, updated_at)
  VALUES (p_key, bucket, 1, now())
  ON CONFLICT (attempt_key) DO UPDATE
    SET window_started_at = EXCLUDED.window_started_at,
        request_count = CASE
          WHEN public.driver_login_rate_limits.window_started_at = EXCLUDED.window_started_at
          THEN public.driver_login_rate_limits.request_count + 1
          ELSE 1
        END,
        updated_at = now()
  RETURNING request_count INTO current_count;

  DELETE FROM public.driver_login_rate_limits
    WHERE updated_at < now() - interval '2 days';
  RETURN current_count <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_driver_login_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_driver_login_rate_limit(text, integer, integer) TO service_role;
