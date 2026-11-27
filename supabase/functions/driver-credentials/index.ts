import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const attempts = new Map<string, { count: number; until: number }>();
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

function allow(key: string, limit: number) {
  const now = Date.now();
  const item = attempts.get(key);
  if (!item || item.until <= now) {
    attempts.set(key, { count: 1, until: now + 15 * 60_000 });
    return true;
  }
  if (item.count >= limit) return false;
  item.count++;
  return true;
}
function newDriverCode() {
  const n = new DataView(crypto.getRandomValues(new Uint32Array(1)).buffer).getUint32(0);
  return `DR${String(n % 100_000_000).padStart(8, "0")}`;
}
function driverEmail(userId: string) {
  return `driver.${userId}@accounts.safaryar.invalid`;
}
function newTemporaryPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "روش درخواست معتبر نیست." }, 405);

  try {
    const body = await req.json();
    const action = body?.action;
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (action !== "enroll" && action !== "login") {
      return json({ error: "درخواست معتبر نیست." }, 400);
    }

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
      if (!allow(`login:${ip}:${code}`, 8)) {
        return json({ error: "تلاش‌های زیاد؛ ۱۵ دقیقه دیگر دوباره امتحان کنید." }, 429);
      }

      const { data: profile, error: profileError } = await admin
        .from("profiles").select("id").eq("driver_code", code).maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return json({ error: "شماره کاربری یا رمز عبور نادرست است." }, 401);
      const userId = profile.id as string;
      const [role, verification] = await Promise.all([
        admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "driver").maybeSingle(),
        admin.from("driver_verifications").select("status").eq("user_id", userId)
          .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (role.error) throw role.error;
      if (verification.error) throw verification.error;
      if (!role.data || verification.data?.status !== "approved") {
        return json({ error: "شماره کاربری یا رمز عبور نادرست است." }, 401);
      }
      const { data: signedIn, error: signInError } = await admin.auth.signInWithPassword({
        email: driverEmail(userId), password,
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
    if (!allow(`enroll:${ip}:${userId}`, 5)) {
      return json({ error: "تعداد تلاش‌ها زیاد است." }, 429);
    }
    const password = typeof body?.password === "string" ? body.password : "";
    if (password.length < 8 || password.length > 128) {
      return json({ error: "رمز عبور باید حداقل ۸ نویسه داشته باشد." }, 400);
    }
    const [role, verification, profile] = await Promise.all([
      admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "driver").maybeSingle(),
      admin.from("driver_verifications").select("status").eq("user_id", userId)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("profiles").select("driver_code").eq("id", userId).maybeSingle(),
    ]);
    if (role.error) throw role.error;
    if (verification.error) throw verification.error;
    if (profile.error) throw profile.error;
    if (!role.data || verification.data?.status !== "approved" || !profile.data) {
      return json({ error: "صدور شماره کاربری فقط پس از تأیید مدارک ممکن است." }, 403);
    }
    if (profile.data.driver_code) {
      return json({ error: "برای این راننده قبلاً شماره کاربری صادر شده است." }, 409);
    }

    const email = driverEmail(userId);
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
      email, email_confirm: true, password,
    });
    if (updateError) throw updateError;

    let driverCode = "";
    for (let i = 0; i < 8; i++) {
      const candidate = newDriverCode();
      const { error: codeError } = await admin.from("profiles")
        .update({ driver_code: candidate }).eq("id", userId).is("driver_code", null);
      if (!codeError) {
        const { data: saved } = await admin.from("profiles")
          .select("driver_code").eq("id", userId).maybeSingle();
        driverCode = saved?.driver_code || "";
        if (driverCode) break;
      }
      if (codeError && codeError.code !== "23505") throw codeError;
    }
    if (!driverCode) throw new Error("Could not allocate a unique driver number");

    const { data: signedIn, error: signInError } = await admin.auth.signInWithPassword({
      email, password,
    });
    if (signInError || !signedIn.session) throw signInError ?? new Error("Session creation failed");
    return json({ ok: true, driver_code: driverCode, session: {
      access_token: signedIn.session.access_token,
      refresh_token: signedIn.session.refresh_token,
    } });
  } catch (error) {
    console.error("[driver-credentials] request failed:", error instanceof Error ? error.message : "unknown");
    return json({ error: "عملیات ورود انجام نشد؛ دوباره تلاش کنید." }, 500);
  }
});
