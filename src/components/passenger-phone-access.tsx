import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toIranE164, useSharedAuth } from "@/components/shared-auth";
import { Btn, Card } from "@/components/ui-kit";

export function PassengerPhoneAccess() {
  const { ready, userId } = useSharedAuth();
  const [phone, setPhone] = useState("");
  const [sentPhone, setSentPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function sendCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const normalized = toIranE164(phone);
    if (!normalized) {
      setError("شماره همراه را به‌صورت ۰۹۱۲۳۴۵۶۷۸۹ وارد کنید.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!userId) {
        const { error: anonymousError } = await supabase.auth.signInAnonymously();
        if (anonymousError) throw anonymousError;
      }
      const { data, error: invokeError } = await supabase.functions.invoke("passenger-phone-auth", {
        body: { action: "send_otp", phone: normalized },
      });
      if (invokeError) throw invokeError;
      if (!data?.ok) throw new Error(data?.error || "ارسال کد انجام نشد.");
      setSentPhone(normalized);
      setSent(true);
      setOtp("");
      setNotice("کد تأیید برای شماره همراه شما ارسال شد.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ارسال پیامک انجام نشد؛ دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(otp)) {
      setError("کد شش‌رقمی پیامک را وارد کنید.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("passenger-phone-auth", {
        body: { action: "verify_otp", phone: sentPhone, otp_code: otp },
      });
      if (invokeError) throw invokeError;
      if (!data?.ok || !data?.session?.access_token || !data?.session?.refresh_token) {
        throw new Error(data?.error || "ورود امن انجام نشد.");
      }
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      if (sessionError) throw sessionError;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "کد تأیید نشد؛ دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return <div className="grid min-h-[65vh] place-items-center p-6 text-sm text-muted-foreground">در حال آماده‌سازی حساب شما…</div>;
  }

  return (
    <main className="flex min-h-[85vh] items-center justify-center p-4">
      <Card className="w-full max-w-md space-y-4 border border-primary/20 p-5 shadow-soft">
        <div className="space-y-1">
          <p className="text-xs font-bold text-primary">سفر یار ترکمن</p>
          <h1 className="text-2xl font-black">ورود مسافر</h1>
          <p className="text-sm text-muted-foreground">
            شماره همراهتان را تأیید کنید تا حساب و سوابق سفرهایتان محفوظ بماند.
          </p>
        </div>
        {!sent ? (
          <form onSubmit={(event) => void sendCode(event)} className="space-y-3">
            <label htmlFor="passenger-phone" className="block text-sm font-semibold">شماره همراه</label>
            <input id="passenger-phone" type="tel" inputMode="tel" autoComplete="tel"
              dir="ltr" value={phone} onChange={(event) => setPhone(event.target.value)}
              placeholder="09123456789" required
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-left" />
            <Btn className="w-full justify-center" disabled={busy || !toIranE164(phone)}>
              {busy ? "در حال ارسال…" : "دریافت کد تأیید"}
            </Btn>
          </form>
        ) : (
          <form onSubmit={(event) => void verifyCode(event)} className="space-y-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>کد ارسال‌شده به <b dir="ltr">{sentPhone}</b></span>
              <button type="button" className="font-bold text-primary" onClick={() => {
                setSent(false); setOtp(""); setError(""); setNotice("");
              }}>تغییر شماره</button>
            </div>
            <label htmlFor="passenger-otp" className="block text-sm font-semibold">کد شش‌رقمی پیامک</label>
            <input id="passenger-otp" dir="ltr" inputMode="numeric" autoComplete="one-time-code"
              maxLength={6} value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="------" required
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-center text-xl tracking-[0.5em]" />
            <Btn className="w-full justify-center" disabled={busy || otp.length !== 6}>
              {busy ? "در حال بررسی…" : "تأیید و ورود به پنل"}
            </Btn>
            <button type="button" disabled={busy} className="w-full py-2 text-sm font-bold text-primary disabled:opacity-50"
              onClick={() => void sendCode()}>
              ارسال دوباره کد
            </button>
          </form>
        )}
        {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          کد فقط برای تأیید شماره استفاده می‌شود؛ در ورودهای بعدی هم می‌توانید با پیامک وارد شوید.
        </p>
      </Card>
    </main>
  );
}
