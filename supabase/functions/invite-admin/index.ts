import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!url || !serviceKey || !token) return json({ error: "Unauthorized" }, 401);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user || authData.user.is_anonymous) return json({ error: "ورود مدیر معتبر نیست" }, 401);
  const { data: role, error: roleError } = await admin.from("user_roles").select("role")
    .eq("user_id", authData.user.id).eq("role", "admin").maybeSingle();
  if (roleError || !role) return json({ error: "فقط مدیر فعلی اجازه افزودن مدیر دارد" }, 403);
  let payload: { email?: string };
  try { payload = await req.json(); } catch { return json({ error: "درخواست نامعتبر است" }, 400); }
  const email = (payload.email ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "ایمیل معتبر وارد کنید" }, 400);
  // Always return admin invite links to the published HTTPS app, never a local preview/WebView origin.
  const redirectTo = "https://safar-yar-torkman.lovable.app/admin";
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (inviteError || !invited.user) return json({ error: inviteError?.message ?? "دعوت‌نامه ارسال نشد" }, 400);
  const { error: insertError } = await admin.from("user_roles").upsert(
    { user_id: invited.user.id, role: "admin" }, { onConflict: "user_id,role" },
  );
  if (insertError) return json({ error: "دعوت‌نامه ارسال شد اما ثبت نقش مدیر ناموفق بود؛ نقش مدیر بررسی شود" }, 500);
  return json({ ok: true });
});
