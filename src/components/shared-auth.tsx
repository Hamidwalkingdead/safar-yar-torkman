import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
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
      // Passenger and driver apps use a device-scoped anonymous session.
      // Admin access remains invitation/email based.
      if (event === "INITIAL_SESSION" && !session && APP_TARGET !== "admin") {
        void supabase.auth.signInAnonymously().then(({ error }) => {
          if (error) console.error("[SafarYar] Anonymous session could not start:", error.message);
        });
      }
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
const OWNER_ADMIN_EMAIL = "hamidgh6446@gmail.com";

export function SharedSignIn({ target }: { target?: "driver" | "passenger" } = {}) {
  const authTarget = target ?? (APP_TARGET === "driver" ? "driver" : "passenger");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);

  async function signInAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) { setError("رمز عبور را وارد کنید."); return; }
    setBusy(true); setError("");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: OWNER_ADMIN_EMAIL, password });
      if (error) throw error;
      setPassword("");
    } catch {
      setError("ورود انجام نشد؛ رمز عبور حساب مدیر را بررسی کنید.");
    } finally { setBusy(false); }
  }

  async function sendCode() {
    setBusy(true); setError("");
    try {
      let session = (await supabase.auth.getSession()).data.session;
      if (!session) {
        const created = await supabase.auth.signInAnonymously();
        if (created.error) throw created.error;
        session = created.data.session;
      }
      if (!session) throw new Error("نشست امن برنامه آماده نشد؛ دوباره تلاش کنید.");
      const functionName = authTarget === "driver" ? "driver-phone-auth" : "passenger-phone-auth";
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: { action: "send_otp", phone },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "ارسال کد انجام نشد.");
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ارسال پیامک ناموفق بود.");
    } finally { setBusy(false); }
  }

  async function verifyCode() {
    setBusy(true); setError("");
    try {
      const functionName = APP_TARGET === "driver" ? "driver-phone-auth" : "passenger-phone-auth";
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: { action: "verify_otp", phone, otp_code: otp },
      });
      if (error) throw error;
      if (!data?.ok || !data?.session?.access_token || !data?.session?.refresh_token) {
        throw new Error(data?.error || "کد تأیید نشد.");
      }
      const { error: sessionError } = await supabase.auth.setSession(data.session);
      if (sessionError) throw sessionError;
    } catch (e) {
      setError(e instanceof Error ? e.message : "تأیید کد ناموفق بود.");
    } finally { setBusy(false); }
  }

  if (APP_TARGET === "admin") {
    return (
      <form onSubmit={(event) => void signInAdmin(event)} className="space-y-3 border-t border-border pt-3">
        <p className="text-sm text-muted-foreground">ورود امن مدیر با رمز عبور انجام می‌شود؛ نیازی به باز کردن ایمیل یا پیوند جیمیل نیست.</p>
        <input aria-label="رمز عبور مدیر" type="password" autoComplete="current-password" dir="ltr"
          placeholder="رمز عبور مدیر" value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-2xl bg-muted p-3 text-left" />
        <Btn disabled={busy || !password}>{busy ? "در حال ورود…" : "ورود به پنل مدیریت"}</Btn>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>
    );
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void (sent ? verifyCode() : sendCode()); }}
      className="space-y-3 rounded-2xl border border-border p-4">
      <h2 className="font-bold">{authTarget === "driver" ? "ورود راننده با پیامک" : "ورود مسافر با پیامک"}</h2>
      {!sent ? <>
        <label className="block space-y-1 text-sm">شماره همراه
          <input aria-label="شماره همراه" type="tel" inputMode="tel" autoComplete="tel"
            placeholder="۰۹۱۲۳۴۵۶۷۸۹" value={phone} onChange={e => setPhone(e.target.value)}
            className="w-full rounded-2xl bg-muted p-3 text-left" dir="ltr" />
        </label>
        <Btn disabled={busy || !toIranE164(phone)} className="w-full">
          {busy ? "در حال ارسال…" : "دریافت کد تأیید"}
        </Btn>
      </> : <>
        <p className="text-sm text-muted-foreground">کد شش‌رقمی به {phone} ارسال شد.</p>
        <input aria-label="کد تأیید پیامکی" inputMode="numeric" autoComplete="one-time-code"
          maxLength={6} placeholder="کد شش‌رقمی" value={otp} onChange={e => setOtp(e.target.value)}
          className="w-full rounded-2xl bg-muted p-3 text-center tracking-[0.4em]" dir="ltr" />
        <Btn disabled={busy || otp.replace(/\D/g, "").length !== 6} className="w-full">
          {busy ? "در حال بررسی…" : "تأیید و ورود"}
        </Btn>
        <button type="button" className="w-full text-sm text-primary" disabled={busy}
          onClick={() => { setSent(false); setOtp(""); setError(""); }}>تغییر شماره همراه</button>
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
