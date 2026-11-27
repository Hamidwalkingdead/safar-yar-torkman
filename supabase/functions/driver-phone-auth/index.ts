import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function normalizeIranPhone(input: unknown): { national: string; e164: string } | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/\D/g, "");
  const match = digits.match(/^(?:0098|98|0)?(9\d{9})$/);
  return match ? { national: `0${match[1]}`, e164: `+98${match[1]}` } : null;
}
function allowAttempt(key: string, limit: number): boolean {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}
function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function otpRequest(path: "send" | "verify", phone: string, code?: string) {
  const apiKey = Deno.env.get("OTPY_API_KEY");
  if (!apiKey) throw new Error("OTP service is not configured");
  const response = await fetch(`https://api.otpy.ir/v1/otp/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(path === "send" ? { phone } : { phone, code }),
  });
  if (!response.ok) return false;
  if (path === "send") return true;
  const result = await response.json().catch(() => null);
  return result?.verified === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "روش درخواست معتبر نیست." }, 405);
  try {
    const body = await req.json();
    const action = body?.action;
    const phone = normalizeIranPhone(body?.phone);
    if (!phone) return json({ error: "شماره همراه معتبر نیست." }, 400);
    if (action !== "send" && action !== "verify") return json({ error: "درخواست معتبر نیست." }, 400);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!allowAttempt(`${action}:${ip}:${phone.national}`, action === "send" ? 3 : 8)) {
      return json({ error: "تعداد تلاش‌ها زیاد است؛ کمی بعد دوباره امتحان کنید." }, 429);
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ error: "سرویس ورود هنوز کامل پیکربندی نشده است." }, 503);
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Recovery is restricted to one existing driver profile with approved documents.
    const { data: profiles, error: profileError } = await admin
      .from("profiles").select("id").eq("phone", phone.national).limit(2);
    if (profileError) throw profileError;
    if (!profiles || profiles.length !== 1) {
      return json({ error: "شماره یا وضعیت حساب راننده معتبر نیست." }, 403);
    }
    const userId = profiles[0].id as string;
    const [roleResult, verificationResult, authResult] = await Promise.all([
      admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "driver").maybeSingle(),
      admin.from("driver_verifications").select("status").eq("user_id", userId)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      admin.auth.admin.getUserById(userId),
    ]);
    if (roleResult.error) throw roleResult.error;
    if (verificationResult.error) throw verificationResult.error;
    if (authResult.error) throw authResult.error;
    if (!roleResult.data || verificationResult.data?.status !== "approved" || !authResult.data.user) {
      return json({ error: "شماره یا وضعیت حساب راننده معتبر نیست." }, 403);
    }
    const existingPhone = authResult.data.user.phone;
    if (!authResult.data.user.is_anonymous && existingPhone && existingPhone !== phone.e164) {
      return json({ error: "این شماره به حساب دیگری متصل است." }, 409);
    }

    if (action === "send") {
      if (!(await otpRequest("send", phone.national))) {
        return json({ error: "ارسال پیامک انجام نشد؛ کمی بعد دوباره تلاش کنید." }, 502);
      }
      return json({ ok: true, message: "کد تأیید ارسال شد." });
    }

    const code = typeof body?.code === "string"
      ? body.code.replace(/[۰-۹]/g, (c: string) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/\D/g, "")
      : "";
    if (!/^\d{6}$/.test(code)) return json({ error: "کد تأیید باید ۶ رقم باشد." }, 400);
    if (!(await otpRequest("verify", phone.national, code))) {
      return json({ error: "کد تأیید نادرست یا منقضی شده است." }, 401);
    }

    // Keep the same auth.users id so trips, wallet, documents and approval remain attached.
    const password = randomPassword();
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
      phone: phone.e164, phone_confirm: true, password,
    });
    if (updateError) throw updateError;
    const { data: signedIn, error: signInError } = await admin.auth.signInWithPassword({
      phone: phone.e164, password,
    });
    if (signInError || !signedIn.session) throw signInError ?? new Error("Session creation failed");
    const { error: profileUpdateError } = await admin.from("profiles")
      .update({ phone_verified: true }).eq("id", userId);
    if (profileUpdateError) throw profileUpdateError;

    return json({ ok: true, session: {
      access_token: signedIn.session.access_token,
      refresh_token: signedIn.session.refresh_token,
    } });
  } catch (error) {
    // Do not log OTP values, provider payloads, session tokens, or generated passwords.
    console.error("[driver-phone-auth] request failed:", error instanceof Error ? error.message : "unknown");
    return json({ error: "ورود انجام نشد؛ دوباره تلاش کنید." }, 500);
  }
});
