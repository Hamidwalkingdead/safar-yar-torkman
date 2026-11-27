import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

function normalizeIranPhone(input: unknown): { national: string; e164: string } | null {
  if (typeof input !== "string") return null;
  const digits = input
    .replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)))
    .replace(/\D/g, "");
  const match = digits.match(/^(?:0098|98|0)?(9\d{9})$/);
  return match ? { national: `0${match[1]}`, e164: `+98${match[1]}` } : null;
}

async function allow(admin: ReturnType<typeof createClient>, key: string, limit: number) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const { data, error } = await admin.rpc("consume_driver_login_rate_limit", {
    p_key: hash, p_limit: limit, p_window_seconds: 900,
  });
  if (error) throw error;
  return data === true;
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

function temporaryPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "روش درخواست معتبر نیست." }, 405);

  try {
    const body = await req.json();
    const action = body?.action;
    const phone = normalizeIranPhone(body?.phone);
    if (!phone) return json({ error: "شماره همراه معتبر وارد کنید." }, 400);

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ error: "سرویس ورود پیکربندی نشده است." }, 503);
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    if (action === "send_otp") {
      if (!(await allow(admin, `passenger-send:${ip}:${phone.national}`, 3))) {
        return json({ error: "تعداد درخواست پیامک زیاد است؛ ۱۵ دقیقه دیگر دوباره تلاش کنید." }, 429);
      }
      if (!(await otpRequest("send", phone.national))) {
        return json({ error: "ارسال پیامک انجام نشد؛ شماره و اعتبار سرویس پیامک را بررسی کنید." }, 502);
      }
      return json({ ok: true });
    }

    if (action !== "verify_otp") return json({ error: "درخواست معتبر نیست." }, 400);
    const otpCode = typeof body?.otp_code === "string"
      ? body.otp_code
          .replace(/[۰-۹]/g, (c: string) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))
          .replace(/[٠-٩]/g, (c: string) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)))
          .replace(/\D/g, "")
      : "";
    if (!/^\d{6}$/.test(otpCode)) return json({ error: "کد شش‌رقمی پیامک را وارد کنید." }, 400);
    if (!(await allow(admin, `passenger-verify:${ip}:${phone.national}`, 8))) {
      return json({ error: "تعداد تلاش‌ها زیاد است؛ ۱۵ دقیقه دیگر دوباره تلاش کنید." }, 429);
    }
    if (!(await otpRequest("verify", phone.national, otpCode))) {
      return json({ error: "کد تأیید نادرست یا منقضی شده است." }, 401);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    let currentUserId: string | null = null;
    let currentIsAnonymous = false;
    if (token) {
      const { data, error } = await admin.auth.getUser(token);
      if (!error && data.user) {
        currentUserId = data.user.id;
        currentIsAnonymous = data.user.is_anonymous === true;
      }
    }

    const { data: verifiedMatches, error: matchError } = await admin.from("profiles")
      .select("id,phone,phone_verified")
      .eq("phone", phone.national).eq("phone_verified", true).limit(2);
    if (matchError) throw matchError;
    let currentProfile: { id: string; phone: string; phone_verified: boolean; first_name: string; last_name: string; display_name: string; emergency_phone: string } | null = null;
    if (currentUserId) {
      const { data, error } = await admin.from("profiles")
        .select("id,phone,phone_verified,first_name,last_name,display_name,emergency_phone").eq("id", currentUserId).maybeSingle();
      if (error) throw error;
      currentProfile = data;
    }
    const rows = verifiedMatches ?? [];
    if (rows.length > 1) return json({ error: "شماره همراه به بیش از یک حساب تأییدشده متصل است؛ پشتیبانی باید بررسی کند." }, 409);

    let targetId: string | null = null;
    if (rows.length === 1) {
      targetId = rows[0].id;
    } else if (currentUserId) {
      // Never take over an old account merely because its unverified contact
      // field contains this phone. Only its current session may verify it.
      if (currentProfile?.phone_verified && currentProfile.phone !== phone.national) {
        return json({ error: "شماره همراه این حساب قبلاً تأیید شده و قابل جایگزینی خودکار نیست." }, 409);
      }
      targetId = currentUserId;
    } else {
      return json({ error: "برای ساخت حساب تازه، برنامه را دوباره باز کنید تا حساب موقت ایجاد شود." }, 401);
    }

    if (!targetId) return json({ error: "حساب کاربری پیدا نشد." }, 404);

    if (currentUserId && currentIsAnonymous && currentUserId !== targetId) {
      const hasProfileData = !!currentProfile && [
        currentProfile.first_name, currentProfile.last_name,
        currentProfile.display_name, currentProfile.emergency_phone,
      ].some((value) => !!value?.trim());
      const dataChecks = await Promise.all([
        admin.from("trips").select("*", { count: "exact", head: true }).eq("passenger_id", currentUserId),
        admin.from("wallet_accounts").select("*", { count: "exact", head: true }).eq("user_id", currentUserId),
        admin.from("wallet_transactions").select("*", { count: "exact", head: true }).eq("user_id", currentUserId),
        admin.from("shared_bookings").select("*", { count: "exact", head: true }).eq("user_id", currentUserId),
        admin.from("shared_rides").select("*", { count: "exact", head: true }).eq("owner_id", currentUserId),
        admin.from("passenger_cancellation_debts").select("*", { count: "exact", head: true }).eq("passenger_id", currentUserId),
        admin.from("driver_ratings").select("*", { count: "exact", head: true }).eq("passenger_id", currentUserId),
        admin.from("support_tickets").select("*", { count: "exact", head: true }).eq("user_id", currentUserId),
        admin.from("profile_private_data").select("*", { count: "exact", head: true }).eq("user_id", currentUserId),
      ]);
      const dataError = dataChecks.find((result) => result.error)?.error;
      if (dataError) throw dataError;
      const hasAccountHistory = dataChecks.some((result) => (result.count ?? 0) > 0);
      if (hasProfileData || hasAccountHistory) {
        return json({
          error: "این نصب اطلاعات یا سوابق دارد و شماره واردشده متعلق به حساب دیگری است؛ برای جلوگیری از جا ماندن اطلاعات، پشتیبانی باید حساب‌ها را بررسی کند.",
        }, 409);
      }
    }

    if (currentUserId && !currentIsAnonymous && currentUserId !== targetId) {
      return json({ error: "برای تغییر حساب، ابتدا از حساب فعلی خارج شوید." }, 409);
    }

    const [{ data: restrictedRoles, error: roleError }, { data: targetProfile, error: targetProfileError }] =
      await Promise.all([
        admin.from("user_roles").select("role").eq("user_id", targetId).in("role", ["driver", "admin"]),
        admin.from("profiles").select("id,phone,phone_verified").eq("id", targetId).maybeSingle(),
      ]);
    if (roleError) throw roleError;
    if (targetProfileError) throw targetProfileError;
    if (!targetProfile) return json({ error: "حساب کاربری پیدا نشد." }, 404);
    if (restrictedRoles?.length) {
      return json({ error: "این شماره متعلق به حساب راننده یا مدیر است؛ از روش ورود همان پنل استفاده کنید." }, 403);
    }
    if (targetProfile.phone_verified && targetProfile.phone !== phone.national) {
      return json({ error: "شماره همراه این حساب قبلاً تأیید شده و قابل جایگزینی خودکار نیست." }, 409);
    }

    // OTPy proves possession of the phone. A random server-only password lets
    // Supabase Auth issue a normal session for the same passenger user ID.
    const password = temporaryPassword();
    const { error: updateError } = await admin.auth.admin.updateUserById(targetId, {
      phone: phone.e164,
      phone_confirm: true,
      password,
    });
    if (updateError) throw updateError;

    const { error: profileUpdateError } = await admin.from("profiles")
      .update({ phone: phone.national, phone_verified: true })
      .eq("id", targetId);
    if (profileUpdateError) throw profileUpdateError;

    const { data: signedIn, error: signInError } = await admin.auth.signInWithPassword({
      phone: phone.e164,
      password,
    });
    if (signInError || !signedIn.session) {
      console.error("[passenger-phone-auth] Supabase phone sign-in failed:", signInError?.message ?? "no session");
      return json({ error: "ورود تلفنی Supabase فعال نیست یا نشست ورود ساخته نشد؛ تنظیمات احراز هویت را بررسی کنید." }, 503);
    }
    if (signedIn.user?.is_anonymous !== false) {
      return json({ error: "تبدیل حساب موقت به حساب دائمی انجام نشد؛ تنظیم Phone در بخش احراز هویت Supabase را بررسی کنید." }, 409);
    }

    return json({
      ok: true,
      session: {
        access_token: signedIn.session.access_token,
        refresh_token: signedIn.session.refresh_token,
      },
    });
  } catch (error) {
    console.error("[passenger-phone-auth] request failed:", error instanceof Error ? error.message : "unknown");
    return json({ error: "تأیید شماره انجام نشد؛ دوباره تلاش کنید." }, 500);
  }
});
