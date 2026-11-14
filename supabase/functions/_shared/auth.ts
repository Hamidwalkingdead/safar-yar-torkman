import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export type AuthenticatedRequest = {
  client: SupabaseClient;
  userId: string;
};

export async function authenticate(request: Request): Promise<AuthenticatedRequest | null> {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) throw new Error("تنظیمات اتصال پایگاه داده در سرور کامل نیست.");

  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${match[1]}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(match[1]);
  if (error || !data.user) return null;
  return { client, userId: data.user.id };
}
