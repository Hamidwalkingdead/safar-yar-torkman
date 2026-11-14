import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Btn } from "./ui-kit";
import { APP_TARGET } from "@/lib/app-target";

const AuthContext = createContext<{ userId: string | null; ready: boolean; isAnonymous: boolean }>({
  userId: null,
  ready: false,
  isAnonymous: false,
});
export const useSharedAuth = () => useContext(AuthContext);
export function SharedAuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const cache = useQueryClient();
  useEffect(() => {
    // INITIAL_SESSION is the authoritative startup snapshot. Avoid racing
    // getUser() against SIGNED_IN/SIGNED_OUT during app initialization.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED", "INITIAL_SESSION"].includes(event)) return;
      setUserId(session?.user.id ?? null);
      setIsAnonymous(session?.user.is_anonymous ?? false);
      setReady(true);
      if (event === "SIGNED_IN" || event === "USER_UPDATED") cache.invalidateQueries();
      if (event === "SIGNED_OUT") {
        void cache.cancelQueries();
        cache.clear();
      }
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, [cache]);
  return <AuthContext.Provider value={{ userId, ready, isAnonymous }}>{children}</AuthContext.Provider>;
}
const faDigits = (s: string) => s.replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)));
export function toIranE164(input: string): string | null {
  const d = faDigits(input).replace(/\D/g, "");
  const m = d.match(/^(?:0098|98|0)?(9\d{9})$/);
  return m ? `+98${m[1]}` : null;
}
export function SharedSignIn({ requireAdminPassword = false }: { requireAdminPassword?: boolean } = {}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [role, setRole] = useState<"passenger" | "driver">(() => APP_TARGET === "driver" ? "driver" : "passenger");

  async function beginWithoutCode() {
    setError("");
    setBusy(true);
    const { error } = await supabase.auth.signInAnonymously({
      options: { data: { requested_role: role } },
    });
    setBusy(false);
    if (error) {
      setError(
        error.message.toLowerCase().includes("anonymous") || error.message.toLowerCase().includes("disabled")
          ? "ثبت‌نام بدون پیامک هنوز در تنظیمات Supabase فعال نشده است."
          : "ساخت حساب بدون کد انجام نشد؛ دوباره تلاش کنید.",
      );
      return;
    }
    if (role === "driver") window.location.assign("/profile");
  }

  async function signInAdminWithPassword() {
    setError("");
    const e164 = toIranE164(phone);
    if (!e164) return setError("شماره همراه معتبر ایران وارد کنید (مثلاً ۰۹۱۲۳۴۵۶۷۸۹).");
    if (!password) return setError("رمز عبور مدیر را وارد کنید.");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ phone: e164, password });
    setBusy(false);
    if (error) {
      setError("ورود انجام نشد؛ شماره همراه یا رمز عبور نادرست است.");
    }
  }

  async function sendCode() {
    setError("");
    const e164 = toIranE164(phone);
    if (!e164) return setError("شماره همراه معتبر ایران وارد کنید (مثلاً ۰۹۱۲۳۴۵۶۷۸۹).");
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
    setBusy(false);
    if (error) {
      const code = "code" in error && typeof error.code === "string" ? error.code : "";
      const message = error.message.toLowerCase();
      if (code === "phone_provider_disabled" || message.includes("unsupported phone provider")) {
        setError("ورود پیامکی هنوز در Supabase فعال نشده است؛ ارائه‌دهنده پیامک برای پروژه تنظیم نشده. تا اتصال سرویس پیامک، ورود مدیر با شماره ممکن نیست.");
      } else if (message.includes("hook") || message.includes("sms")) {
        setError("سرویس ارسال پیامک پاسخ نداد. تنظیمات اتصال سرویس پیامک و گزارش خطای Supabase باید بررسی شود.");
      } else {
        setError(`ارسال کد ناموفق بود: ${error.message || "خطای نامشخص"}`);
      }
    } else setSentTo(e164);
  }

  async function verify() {
    if (!sentTo) return;
    setError("");
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({
      phone: sentTo,
      token: faDigits(code).trim(),
      type: "sms",
    });
    setBusy(false);
    if (error) return setError("کد نادرست یا منقضی است.");
    if (role === "driver" && window.location.pathname !== "/profile") {
      window.location.assign("/profile");
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="text-sm text-muted-foreground">
        {requireAdminPassword
          ? "برای ورود به مدیریت، شماره همراه و رمز عبور مالک را وارد کنید."
          : APP_TARGET === "driver"
            ? "برای ثبت‌نام راننده، حساب خود را بسازید و مدارک خودرو را ارسال کنید."
            : APP_TARGET === "passenger"
              ? "برای درخواست سفر، حساب مسافر خود را بسازید و پروفایل را تکمیل کنید."
              : "مسافر و راننده می‌توانند بدون دریافت پیامک حساب بسازند و اطلاعات و مدارک را ثبت کنند."}
      </p>
      {!sentTo && !requireAdminPassword && (
        <>
          {APP_TARGET === "all" && (
            <div className="flex gap-2" role="radiogroup" aria-label="نقش">
              {(["passenger", "driver"] as const).map((r) => (
                <Btn key={r} variant={role === r ? "primary" : "ghost"} aria-pressed={role === r} onClick={() => setRole(r)}>
                  {r === "passenger" ? "مسافر هستم" : "راننده هستم"}
                </Btn>
              ))}
            </div>
          )}
          <Btn disabled={busy} onClick={() => void beginWithoutCode()}>
            {busy ? "در حال ساخت حساب…" : "شروع ثبت‌نام بدون کد پیامکی"}
          </Btn>
          <p className="text-xs text-muted-foreground">
            حساب بدون کد به همین دستگاه وابسته است؛ خروج از حساب یا پاک‌کردن اطلاعات برنامه می‌تواند دسترسی را از بین ببرد.
          </p>
          {role === "driver" && <p className="text-xs text-muted-foreground">پس از ساخت حساب، مشخصات خودرو و هفت مدرک لازم را در پروفایل ثبت کنید.</p>}
        </>
      )}
      {!sentTo && requireAdminPassword && (
        <div className="space-y-3">
          <input aria-label="شماره همراه مدیر" autoComplete="username" inputMode="tel" dir="ltr" placeholder="09123456789" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-2xl bg-muted p-3 text-left" />
          <input aria-label="رمز عبور مدیر" type="password" autoComplete="current-password" dir="ltr" placeholder="رمز عبور" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-2xl bg-muted p-3 text-left" />
          <Btn disabled={busy || !phone.trim() || !password} onClick={() => void signInAdminWithPassword()}>{busy ? "در حال ورود…" : "ورود به مدیریت"}</Btn>
        </div>
      )}
      {sentTo && (
        <>
          <p className="text-sm">کد پیامک‌شده به {sentTo} را وارد کنید.</p>
          <input aria-label="کد تأیید" inputMode="numeric" dir="ltr" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} className="w-full rounded-2xl bg-muted p-3 text-center tracking-widest" />
          <div className="flex flex-wrap gap-2">
            <Btn disabled={busy || code.length < 4} onClick={() => void verify()}>تأیید و ورود</Btn>
            <Btn variant="ghost" disabled={busy} onClick={() => setSentTo(null)}>تغییر شماره</Btn>
          </div>
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
