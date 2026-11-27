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
    // Never treat a temporary anonymous session as an authenticated passenger or driver.
    // Existing anonymous sessions are retained so OTP can upgrade the same user ID
    // with updateUser({ phone }) instead of orphaning their trips and profile.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED", "INITIAL_SESSION"].includes(event)) return;
      const anonymous = session?.user.is_anonymous ?? false;
      setUserId(anonymous ? null : (session?.user.id ?? null));
      setIsAnonymous(anonymous);
      setReady(true);

      if (event === "SIGNED_IN" || event === "USER_UPDATED") cache.invalidateQueries();
      if (event === "SIGNED_OUT") {
        void cache.cancelQueries();
        cache.clear();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [cache]);

  return (
    <AuthContext.Provider value={{ userId, ready, isAnonymous }}>
      {children}
    </AuthContext.Provider>
  );
}

const faDigits = (value: string) =>
  value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });

export function toIranE164(input: string): string | null {
  const digits = faDigits(input).replace(/\D/g, "");
  const match = digits.match(/^(?:0098|98|0)?(9\d{9})$/);
  return match ? `+98${match[1]}` : null;
}

const OWNER_ADMIN_EMAIL = "hamidgh6446@gmail.com";

type OtpType = "sms" | "phone_change";

export function SharedSignIn() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpType, setOtpType] = useState<OtpType>("sms");

  async function signInAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) {
      setError("رمز عبور را وارد کنید.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: OWNER_ADMIN_EMAIL,
        password,
      });
      if (signInError) throw signInError;
      setPassword("");
    } catch {
      setError("ورود انجام نشد؛ رمز عبور حساب مدیر را بررسی کنید.");
    } finally {
      setBusy(false);
    }
  }

  async function requestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedPhone = toIranE164(phone);
    if (!normalizedPhone) {
      setError("شماره همراه معتبر ایران را وارد کنید؛ مانند ۰۹۱۲۳۴۵۶۷۸۹.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;

      if (sessionData.session?.user.is_anonymous) {
        // Upgrade the existing anonymous identity in place. This preserves the
        // user's profile, trip ownership, chat, and other rows linked to its ID.
        const { error: updateError } = await supabase.auth.updateUser({ phone: normalizedPhone });
        if (updateError) throw updateError;
        setOtpType("phone_change");
      } else {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          phone: normalizedPhone,
          options: { shouldCreateUser: true },
        });
        if (otpError) throw otpError;
        setOtpType("sms");
      }

      setPhone(normalizedPhone);
      setOtpSent(true);
      setCode("");
    } catch {
      setError("ارسال کد انجام نشد. فعال‌بودن ورود تلفنی و سرویس پیامک در Supabase را بررسی کنید. اگر شماره قبلاً به حساب دیگری متصل است، برای جلوگیری از جابه‌جایی ناخواسته اطلاعات، حساب فعلی را تغییر ندهید.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedPhone = toIranE164(phone);
    const token = faDigits(code).replace(/\D/g, "");
    if (!normalizedPhone || !/^\d{6}$/.test(token)) {
      setError("شماره همراه و کد شش‌رقمی معتبر را وارد کنید.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        phone: normalizedPhone,
        token,
        type: otpType,
      });
      if (verifyError) throw verifyError;
      if (!data.user || data.user.is_anonymous) {
        throw new Error("Phone verification did not produce a permanent user session.");
      }
      setOtpSent(false);
      setCode("");
    } catch {
      setError("کد تأیید معتبر نیست یا منقضی شده است. کد را بررسی کنید یا دوباره درخواست دهید.");
    } finally {
      setBusy(false);
    }
  }

  if (APP_TARGET === "admin") {
    return (
      <form onSubmit={(event) => void signInAdmin(event)} className="space-y-3 border-t border-border pt-3">
        <p className="text-sm text-muted-foreground">
          ورود امن مدیر با رمز عبور انجام می‌شود؛ ورود مدیر از احراز هویت تلفنی مسافر و راننده جداست.
        </p>
        <input aria-label="رمز عبور مدیر" type="password" autoComplete="current-password" dir="ltr"
          placeholder="رمز عبور مدیر" value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-2xl bg-muted p-3 text-left" />
        <Btn disabled={busy || !password}>
          {busy ? "در حال ورود…" : "ورود به پنل مدیریت"}
        </Btn>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>
    );
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      {!otpSent ? (
        <form onSubmit={(event) => void requestOtp(event)} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            برای ورود یا ساخت حساب، شماره همراه خود را وارد کنید. کد تأیید پیامکی برای شما ارسال می‌شود.
          </p>
          <input aria-label="شماره همراه" type="tel" inputMode="tel" autoComplete="tel-national"
            dir="ltr" placeholder="09123456789" value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="w-full rounded-2xl bg-muted p-3 text-left" />
          <Btn disabled={busy || !phone.trim()}>
            {busy ? "در حال ارسال کد…" : "ارسال کد تأیید"}
          </Btn>
        </form>
      ) : (
        <form onSubmit={(event) => void verifyOtp(event)} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            کد شش‌رقمی ارسال‌شده به {phone} را وارد کنید.
          </p>
          <input aria-label="کد تأیید" type="text" inputMode="numeric" autoComplete="one-time-code"
            dir="ltr" maxLength={6} placeholder="------" value={code}
            onChange={(event) => setCode(event.target.value)}
            className="w-full rounded-2xl bg-muted p-3 text-center tracking-[0.5em]" />
          <Btn disabled={busy || faDigits(code).replace(/\D/g, "").length !== 6}>
            {busy ? "در حال بررسی…" : "تأیید کد و ورود"}
          </Btn>
          <button type="button" disabled={busy} onClick={() => { setOtpSent(false); setCode(""); setError(""); }}
            className="w-full text-sm text-muted-foreground underline">
            تغییر شماره همراه
          </button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
