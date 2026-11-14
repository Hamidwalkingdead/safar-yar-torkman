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

function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
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

  const configuredEmail = normalizeEmail(Deno.env.get("ADMIN_OWNER_EMAIL") || "");
  const configuredSecret = Deno.env.get("ADMIN_PASSWORD_SETUP_SECRET") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = getSecretKey();
  if (!configuredEmail || configuredSecret.length < 32 || !supabaseUrl || !serviceKey)
    return json({ error: "راه‌اندازی امن مدیر هنوز در Supabase کامل نشده است." }, 503);

  let body: { email?: unknown; setupSecret?: unknown; password?: unknown };
  try { body = await req.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
  if (typeof body.email !== "string" || typeof body.setupSecret !== "string" || typeof body.password !== "string")
    return json({ error: "اطلاعات ورودی کامل نیست." }, 400);

  const email = normalizeEmail(body.email);
  const password = body.password;
  if (!email || email !== configuredEmail) return json({ error: "ایمیل با حساب مالک مطابقت ندارد." }, 403);
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
      owner = data.users.find(user => user.email?.toLowerCase() === email) ?? owner;
      if (owner || data.users.length < 1000) break;
    }
    if (owner?.is_anonymous) {
      return json({ error: "این ایمیل به حساب ناشناس متصل نیست؛ حساب ناشناس فعلی دست‌نخورده باقی می‌ماند." }, 409);
    }

    const { data: admins, error: adminsError } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    if (adminsError) throw adminsError;
    const alreadyAdmin = owner ? (admins ?? []).some(row => row.user_id === owner.id) : false;
    if ((admins ?? []).length > 0 && !alreadyAdmin)
      return json({ error: "در حال حاضر مدیر دیگری در سامانه وجود دارد؛ ایجاد حساب مالک جدید به‌صورت خودکار مجاز نیست." }, 403);

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

    let createdOwnerId: string | null = null;
    if (!owner) {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        password,
        user_metadata: { account_type: "owner_admin", provisioned_by: "one_time_admin_bootstrap" },
      });
      if (createError || !created.user) {
        await admin.from("admin_password_bootstrap_state")
          .update({ used_at: null, claim_id: null })
          .eq("id", true)
          .eq("claim_id", claimId);
        throw createError ?? new Error("Owner account creation failed");
      }
      owner = created.user;
      createdOwnerId = owner.id;
    }

    let grantedAdminRole = false;
    if (!alreadyAdmin) {
      const { error: roleInsertError } = await admin.from("user_roles").insert({
        user_id: owner.id,
        role: "admin",
      });
      if (roleInsertError) {
        if (createdOwnerId) await admin.auth.admin.deleteUser(createdOwnerId);
        await admin.from("admin_password_bootstrap_state")
          .update({ used_at: null, claim_id: null })
          .eq("id", true)
          .eq("claim_id", claimId);
        throw roleInsertError;
      }
      grantedAdminRole = true;
    }

    const passwordError = createdOwnerId
      ? null
      : (await admin.auth.admin.updateUserById(owner.id, { password })).error;
    if (passwordError) {
      if (grantedAdminRole) {
        await admin.from("user_roles").delete().eq("user_id", owner.id).eq("role", "admin");
      }
      if (createdOwnerId) await admin.auth.admin.deleteUser(createdOwnerId);
      await admin.from("admin_password_bootstrap_state")
        .update({ used_at: null, claim_id: null })
        .eq("id", true)
        .eq("claim_id", claimId);
      throw passwordError;
    }
    return json({ success: true, accountCreated: Boolean(createdOwnerId) });
  } catch (error) {
    console.error("admin-password-bootstrap failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "ثبت رمز انجام نشد؛ پس از بررسی تنظیمات دوباره تلاش کنید." }, 500);
  }
});
