-- Per-user rate limits for authenticated Neshan and trip Edge Function calls.
CREATE TABLE IF NOT EXISTS public.edge_api_rate_limits (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 endpoint text NOT NULL CHECK (endpoint IN ('create-trip','neshan-route','neshan-reverse','neshan-search')),
 window_started_at timestamptz NOT NULL,
 request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0),
 PRIMARY KEY (user_id, endpoint, window_started_at)
);

ALTER TABLE public.edge_api_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.edge_api_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.edge_api_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_edge_api_rate_limit(
 p_endpoint text,
 p_limit integer DEFAULT 20,
 p_window_seconds integer DEFAULT 60
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
 bucket timestamptz;
 current_count integer;
BEGIN
 IF auth.uid() IS NULL THEN
  RAISE EXCEPTION 'ورود لازم است';
 END IF;
 IF p_endpoint NOT IN ('create-trip','neshan-route','neshan-reverse','neshan-search')
 OR p_limit NOT BETWEEN 1 AND 60
 OR p_window_seconds NOT BETWEEN 1 AND 3600 THEN
  RAISE EXCEPTION 'پارامتر محدودیت درخواست نامعتبر است';
 END IF;

 bucket := to_timestamp(
  floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
 );

 INSERT INTO public.edge_api_rate_limits(user_id,endpoint,window_started_at,request_count)
 VALUES(auth.uid(),p_endpoint,bucket,1)
 ON CONFLICT(user_id,endpoint,window_started_at)
 DO UPDATE SET request_count=public.edge_api_rate_limits.request_count+1
 RETURNING request_count INTO current_count;

 -- Opportunistic retention cleanup; no separate scheduler is required.
 DELETE FROM public.edge_api_rate_limits
 WHERE window_started_at < now() - interval '2 days';

 RETURN current_count <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_edge_api_rate_limit(text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_edge_api_rate_limit(text,integer,integer) TO authenticated;
