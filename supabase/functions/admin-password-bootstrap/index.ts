import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizeIranPhone(value: string): string | null {
  const digits = value.replace(/[۰-۹]/g, c => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/\D/g, "");
  const match = digits.match(/^(?:0098|98|0)?(9\d{9})$/);
  return match ? `+98${match[1]}` : null;
}

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function getSecretKey(): string | null {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const keys = JSON.parse(raw) as Record<string, string>;
      if (keys.default) return keys.default;
    } catch { /* use legacy fallback below */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "روش درخواست مجاز نیست." }, 405);

  const configuredPhone = normalizeIranPhone(Deno.env.get("ADMIN_OWNER_PHONE") || "");
  const configuredSecret = Deno.env.get("ADMIN_PASSWORD_SETUP_SECRET") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = getSecretKey();
  if (!configuredPhone || configuredSecret.length < 32 || !supabaseUrl || !serviceKey)
    return json({ error: "راه‌اندازی امن مدیر هنوز در Supabase کامل نشده است." }, 503);

  let body: { phone?: unknown; setupSecret?: unknown; password?: unknown };
  try { body = await req.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
  if (typeof body.phone !== "string" || typeof body.setupSecret !== "string" || typeof body.password !== "string")
    return json({ error: "اطلاعات ورودی کامل نیست." }, 400);

  const phone = normalizeIranPhone(body.phone);
  const password = body.password;
  if (!phone || phone !== configuredPhone) return json({ error: "شماره همراه با حساب مالک مطابقت ندارد." }, 403);
  if (!(await constantTimeEqual(body.setupSecret, configuredSecret))) return json({ error: "کلید راه‌اندازی نادرست است." }, 403);
  if (password.length < 12 || password.length > 128 ||
      !/[a-z]/.test(password) || !/[A-Z]/.test(password) ||
      !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password))
    return json({ error: "رمز باید حداقل ۱۲ نویسه و شامل حروف کوچک و بزرگ، عدد و نشانه باشد." }, 400);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    let owner = null;
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      owner = data.users.find(user => user.phone === phone) ?? owner;
      if (owner || data.users.length < 1000) break;
    }
    if (!owner || owner.is_anonymous) return json({ error: "حساب مالک در احراز هویت پیدا نشد." }, 404);

    const { data: admins, error: adminsError } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    if (adminsError) throw adminsError;
    const alreadyAdmin = (admins ?? []).some(row => row.user_id === owner.id);
    if ((admins ?? []).length > 0 && !alreadyAdmin)
      return json({ error: "حساب مالک با فهرست مدیران فعلی مطابقت ندارد؛ نقش مدیر به‌صورت خودکار تغییر داده نشد." }, 403);

    const claimId = crypto.randomUUID();
    const { data: claim, error: claimError } = await admin
      .from("admin_password_bootstrap_state")
      .update({ used_at: new Date().toISOString(), claim_id: claimId })
      .eq("id", true)
      .is("used_at", null)
      .select("id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claim) return json({ error: "رمز اولیه قبلاً ثبت شده است؛ این صفحه دیگر قابل استفاده نیست." }, 409);

    let grantedAdminRole = false;
    if (!alreadyAdmin) {
      const { error: roleInsertError } = await admin.from("user_roles").insert({
        user_id: owner.id,
        role: "admin",
      });
      if (roleInsertError) {
        await admin.from("admin_password_bootstrap_state")
          .update({ used_at: null, claim_id: null })
          .eq("id", true)
          .eq("claim_id", claimId);
        throw roleInsertError;
      }
      grantedAdminRole = true;
    }

    const { error: passwordError } = await admin.auth.admin.updateUserById(owner.id, { password });
    if (passwordError) {
      if (grantedAdminRole) {
        await admin.from("user_roles").delete().eq("user_id", owner.id).eq("role", "admin");
      }
      await admin.from("admin_password_bootstrap_state")
        .update({ used_at: null, claim_id: null })
        .eq("id", true)
        .eq("claim_id", claimId);
      throw passwordError;
    }
    return json({ success: true });
  } catch (error) {
    console.error("admin-password-bootstrap failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "ثبت رمز انجام نشد؛ پس از بررسی تنظیمات دوباره تلاش کنید." }, 500);
  }
});
