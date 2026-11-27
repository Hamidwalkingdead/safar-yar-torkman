import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { APP_TARGET } from "@/lib/app-target";
import { useSharedAuth } from "./shared-auth";

export function DriverPhoneLogin() {
  const { isAnonymous } = useSharedAuth();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  if (APP_TARGET !== "driver" || !isAnonymous) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!sent) {
        const { data, error: invokeError } = await supabase.functions.invoke("driver-phone-auth", {
          body: { action: "send", phone },
        });
        if (invokeError) throw invokeError;
        if (!data?.ok) throw new Error(data?.error || "ارسال کد انجام نشد.");
        setSent(true);
        setNotice("کد تأیید برای شماره شما ارسال شد.");
        return;
      }

      const { data, error: invokeError } = await supabase.functions.invoke("driver-phone-auth", {
        body: { action: "verify", phone, code },
      });
      if (invokeError) throw invokeError;
      if (!data?.ok || !data?.session?.access_token || !data?.session?.refresh_token) {
        throw new Error(data?.error || "تأیید کد انجام نشد.");
      }
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      if (sessionError) throw sessionError;
      setCode("");
      setNotice("ورود موفق بود.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "عملیات انجام نشد؛ دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-3 mt-3 rounded-3xl border border-primary/25 bg-card p-4 shadow-soft">
      <h2 className="font-bold">بازیابی حساب راننده</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        پس از تأیید مدارک، با شماره همراه ثبت‌شده وارد شوید؛ حساب و سوابق قبلی حفظ می‌شود.
      </p>
      <form onSubmit={(event) => void submit(event)} className="mt-3 space-y-2">
        <label className="block text-sm" htmlFor="driver-recovery-phone">شماره همراه ثبت‌شده</label>
        <input
          id="driver-recovery-phone"
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="09123456789"
          required
          disabled={busy || sent}
          className="w-full rounded-2xl border border-border bg-background px-3 py-3 text-left"
        />
        {sent && (
          <>
            <label className="block text-sm" htmlFor="driver-recovery-code">کد تأیید پیامک‌شده</label>
            <input
              id="driver-recovery-code"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="------"
              required
              className="w-full rounded-2xl border border-border bg-background px-3 py-3 text-center tracking-[0.4em]"
            />
          </>
        )}
        <button
          type="submit"
          disabled={busy || (sent && code.length !== 6)}
          className="w-full rounded-2xl bg-primary px-4 py-3 font-bold text-primary-foreground disabled:opacity-50"
        >
          {busy ? "لطفاً صبر کنید…" : sent ? "تأیید کد و ورود" : "ارسال کد ورود"}
        </button>
        {sent && (
          <button
            type="button"
            disabled={busy}
            onClick={() => { setSent(false); setCode(""); setNotice(""); setError(""); }}
            className="w-full py-2 text-xs text-muted-foreground"
          >
            تغییر شماره همراه
          </button>
        )}
      </form>
      {notice && <p role="status" className="mt-2 text-sm text-primary">{notice}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  );
}
