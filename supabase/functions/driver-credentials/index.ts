import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

async function allow(admin: ReturnType<typeof createClient>, key: string, limit: number) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const { data, error } = await admin.rpc("consume_driver_login_rate_limit", {
    p_key: hash, p_limit: limit, p_window_seconds: 900,
  });
  if (error) throw error;
  return data === true;
}
function normalizeIranPhone(input: unknown): { national: string; e164: string } | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/\D/g, "");
  const match = digits.match(/^(?:0098|98|0)?(9\d{9})$/);
  return match ? { national: `0${match[1]}`, e164: `+98${match[1]}` } : null;
}
function newDriverCode() {
  const values = crypto.getRandomValues(new Uint32Array(1));
  return `DR${String(values[0] % 100_000_000).padStart(8, "0")}`;
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
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "روش درخواست معتبر نیست." }, 405);
  try {
    const body = await req.json();
    const action = body?.action;
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ error: "سرویس ورود پیکربندی نشده است." }, 503);
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (action === "login") {
      const code = typeof body?.driver_code === "string"
        ? body.driver_code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
        : "";
      const password = typeof body?.password === "string" ? body.password : "";
      if (!/^DR\d{8}$/.test(code) || password.length < 8 || password.length > 128) {
        return json({ error: "شماره کاربری یا رمز عبور نادرست است." }, 401);
      }
      if (!(await allow(admin, `login:${ip}:${code}`, 8))) {
        return json({ error: "تلاش‌های زیاد؛ ۱۵ دقیقه دیگر دوباره امتحان کنید." }, 429);
      }
      const { data: profile, error: profileError } = await admin
        .from("profiles").select("id,phone").eq("driver_code", code).maybeSingle();
      if (profileError) throw profileError;
      if (!profile?.phone) return json({ error: "شماره کاربری یا رمز عبور نادرست است." }, 401);
      const [role, verification] = await Promise.all([
        admin.from("user_roles").select("role").eq("user_id", profile.id).eq("role", "driver").maybeSingle(),
        admin.from("driver_verifications").select("status").eq("user_id", profile.id)
          .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (role.error) throw role.error;
      if (verification.error) throw verification.error;
      if (!role.data || verification.data?.status !== "approved") {
        return json({ error: "شماره کاربری یا رمز عبور نادرست است." }, 401);
      }
      const phone = normalizeIranPhone(profile.phone);
      if (!phone) return json({ error: "اطلاعات ورود راننده کامل نیست؛ با مدیر تماس بگیرید." }, 403);
      const { data: signedIn, error: signInError } = await admin.auth.signInWithPassword({
        phone: phone.e164, password,
      });
      if (signInError || !signedIn.session) {
        return json({ error: "شماره کاربری یا رمز عبور نادرست است." }, 401);
      }
      return json({ ok: true, session: {
        access_token: signedIn.session.access_token,
        refresh_token: signedIn.session.refresh_token,
      } });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ error: "نشست معتبر نیست؛ برنامه را دوباره باز کنید." }, 401);
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "نشست معتبر نیست." }, 401);
    const userId = authData.user.id;
    if (!(await allow(admin, `enroll:${ip}:${userId}`, 5))) return json({ error: "تعداد تلاش‌ها زیاد است." }, 429);

    const [role, verification, profile] = await Promise.all([
      admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "driver").maybeSingle(),
      admin.from("driver_verifications").select("status").eq("user_id", userId)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("profiles").select("driver_code,phone").eq("id", userId).maybeSingle(),
    ]);
    if (role.error) throw role.error;
    if (verification.error) throw verification.error;
    if (profile.error) throw profile.error;
    if (!role.data || verification.data?.status !== "approved" || !profile.data) {
      return json({ error: "صدور شماره کاربری فقط پس از تأیید مدارک ممکن است." }, 403);
    }
    if (profile.data.driver_code) return json({ error: "برای این راننده قبلاً شماره کاربری صادر شده است." }, 409);
    const phone = normalizeIranPhone(profile.data.phone);
    if (!phone) return json({ error: "شماره همراه معتبر در پروفایل راننده ثبت نشده است." }, 400);

    if (action === "send_enrollment_otp") {
      if (!(await allow(admin, `otp-send:${ip}:${userId}`, 3))) {
        return json({ error: "تعداد درخواست پیامک زیاد است؛ بعداً دوباره تلاش کنید." }, 429);
      }
      if (!(await otpRequest("send", phone.national))) {
        return json({ error: "ارسال پیامک انجام نشد؛ شماره و اعتبار OTP را بررسی کنید." }, 502);
      }
      return json({ ok: true, message: "کد تأیید به شماره ثبت‌شده ارسال شد." });
    }
    if (action !== "enroll") return json({ error: "درخواست معتبر نیست." }, 400);

    const password = typeof body?.password === "string" ? body.password : "";
    const otpCode = typeof body?.otp_code === "string"
      ? body.otp_code.replace(/[۰-۹]/g, (c: string) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/\D/g, "")
      : "";
    if (password.length < 8 || password.length > 128) {
      return json({ error: "رمز عبور باید حداقل ۸ نویسه داشته باشد." }, 400);
    }
    if (!/^\d{6}$/.test(otpCode)) return json({ error: "کد تأیید پیامک‌شده معتبر نیست." }, 400);
    if (!(await otpRequest("verify", phone.national, otpCode))) {
      return json({ error: "کد تأیید نادرست یا منقضی شده است." }, 401);
    }

    // OTPy verifies the real phone once. Supabase Auth then stores the password
    // against the same user ID; the public driver code is only a username alias.
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
      phone: phone.e164, phone_confirm: true, password,
    });
    if (updateError) throw updateError;

    const { data: signedIn, error: signInError } = await admin.auth.signInWithPassword({
      phone: phone.e164, password,
    });
    if (signInError || !signedIn.session) throw signInError ?? new Error("Session creation failed");
    if (signedIn.user?.is_anonymous !== false) {
      return json({ error: "تبدیل حساب موقت به حساب دائمی انجام نشد؛ تنظیم Phone در بخش احراز هویت Supabase را بررسی کنید." }, 409);
    }

    let driverCode = "";
    for (let i = 0; i < 8; i++) {
      const candidate = newDriverCode();
      const { error: codeError } = await admin.from("profiles")
        .update({ driver_code: candidate }).eq("id", userId).is("driver_code", null);
      if (codeError) {
        if (codeError.code === "23505") continue;
        throw codeError;
      }
      const { data: saved, error: readError } = await admin.from("profiles")
        .select("driver_code").eq("id", userId).maybeSingle();
      if (readError) throw readError;
      driverCode = saved?.driver_code || "";
      if (driverCode) break;
    }
    if (!driverCode) throw new Error("Could not allocate a unique driver number");

    const { error: verifiedUpdateError } = await admin.from("profiles")
      .update({ phone_verified: true }).eq("id", userId);
    if (verifiedUpdateError) throw verifiedUpdateError;
    return json({ ok: true, driver_code: driverCode, session: {
      access_token: signedIn.session.access_token,
      refresh_token: signedIn.session.refresh_token,
    } });
  } catch (error) {
    console.error("[driver-credentials] request failed:", error instanceof Error ? error.message : "unknown");
    return json({ error: "عملیات ورود انجام نشد؛ دوباره تلاش کنید." }, 500);
  }
});
