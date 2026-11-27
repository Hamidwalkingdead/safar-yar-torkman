import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { APP_TARGET } from "@/lib/app-target";
import { useSharedAuth } from "./shared-auth";

export function DriverCodeAccess() {
  const { userId, ready, isAnonymous } = useSharedAuth();
  const [approvedOnThisDevice, setApprovedOnThisDevice] = useState(false);
  const [checking, setChecking] = useState(true);
  const [driverCode, setDriverCode] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [issuedCode, setIssuedCode] = useState("");
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    let active = true;
    async function checkApproval() {
      if (!ready || !userId || !isAnonymous || APP_TARGET !== "driver") {
        setChecking(false);
        return;
      }
      setChecking(true);
      const [role, verification] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "driver").maybeSingle(),
        supabase.from("driver_verifications").select("status").eq("user_id", userId)
          .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (active) {
        setApprovedOnThisDevice(!role.error && !verification.error &&
          !!role.data && verification.data?.status === "approved");
        setChecking(false);
      }
    }
    void checkApproval();
    return () => { active = false; };
  }, [ready, userId, isAnonymous]);

  if (APP_TARGET !== "driver" || !ready || (!isAnonymous && !issuedCode && !!userId)) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const action = approvedOnThisDevice ? (otpSent ? "enroll" : "send_enrollment_otp") : "login";
      const body = action === "login"
        ? { action, driver_code: driverCode, password }
        : action === "send_enrollment_otp"
          ? { action }
          : { action, otp_code: otpCode, password };
      const { data, error: invokeError } = await supabase.functions.invoke("driver-credentials", { body });
      if (invokeError) throw invokeError;
      if (!data?.ok) throw new Error(data?.error || "عملیات انجام نشد.");
      if (action === "send_enrollment_otp") {
        setOtpSent(true);
        setNotice("کد تأیید به شماره همراه ثبت‌شده شما ارسال شد.");
        return;
      }
      if (!data?.session?.access_token || !data?.session?.refresh_token) {
        throw new Error("نشست ورود از سرور دریافت نشد.");
      }
      if (data.driver_code) setIssuedCode(data.driver_code);
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      if (sessionError) throw sessionError;
      setPassword("");
      setOtpCode("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "عملیات انجام نشد؛ دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-3 my-4 rounded-3xl border border-primary/25 bg-card p-4 shadow-soft">
      <h2 className="font-bold">ورود راننده</h2>
      {issuedCode ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm">شماره کاربری اختصاصی شما صادر شد. آن را یادداشت و نگهداری کنید:</p>
          <div dir="ltr" className="rounded-2xl bg-muted p-4 text-center text-2xl font-black tracking-widest">
            {issuedCode}
          </div>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(issuedCode)}
            className="w-full rounded-2xl border border-border py-2 text-sm">کپی شماره کاربری</button>
          <p className="text-xs text-muted-foreground">از این پس با همین شماره کاربری و رمزی که تعیین کردید وارد شوید.</p>
          <button type="button" onClick={() => setIssuedCode("")}
            className="w-full rounded-2xl bg-primary py-3 font-bold text-primary-foreground">ادامه به برنامه</button>
        </div>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            {approvedOnThisDevice
              ? "مدارک شما تأیید شده است؛ شماره همراه ثبت‌شده را یک‌بار تأیید کنید و رمز ورود بسازید."
              : "اگر قبلاً شماره کاربری راننده دارید، از همان وارد شوید. ثبت‌نام و تکمیل مدارک از بخش پروفایل انجام می‌شود."}
          </p>
          {!approvedOnThisDevice && <button type="button" onClick={() => setShowLogin((value) => !value)} className="mt-3 w-full rounded-2xl border border-border py-2 text-sm font-semibold">{showLogin ? "بستن فرم ورود" : "قبلاً حساب راننده دارم · ورود"}</button>}
          {(approvedOnThisDevice || showLogin) && <form onSubmit={(event) => void submit(event)} className="mt-3 space-y-2">
            {!approvedOnThisDevice ? (
              <>
                <label htmlFor="driver-code" className="block text-sm">شماره کاربری راننده</label>
                <input id="driver-code" dir="ltr" autoCapitalize="characters"
                  value={driverCode} onChange={(event) => setDriverCode(event.target.value.toUpperCase())}
                  placeholder="DR12345678" required
                  className="w-full rounded-2xl border border-border bg-background px-3 py-3 text-left" />
                <label htmlFor="driver-password" className="block text-sm">رمز عبور</label>
                <input id="driver-password" dir="ltr" type="password" autoComplete="current-password"
                  minLength={8} value={password} onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••" required
                  className="w-full rounded-2xl border border-border bg-background px-3 py-3 text-left" />
                <button type="submit" disabled={busy || checking || password.length < 8 || !driverCode.trim()}
                  className="w-full rounded-2xl bg-primary px-4 py-3 font-bold text-primary-foreground disabled:opacity-50">
                  {busy ? "لطفاً صبر کنید…" : "ورود به حساب راننده"}
                </button>
              </>
            ) : (
              <>
                {otpSent && (
                  <>
                    <label htmlFor="driver-enroll-otp" className="block text-sm">کد تأیید پیامک‌شده</label>
                    <input id="driver-enroll-otp" dir="ltr" inputMode="numeric" autoComplete="one-time-code"
                      maxLength={6} value={otpCode}
                      onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="------" required
                      className="w-full rounded-2xl border border-border bg-background px-3 py-3 text-center tracking-[0.4em]" />
                    <label htmlFor="driver-new-password" className="block text-sm">رمز عبور جدید (حداقل ۸ نویسه)</label>
                    <input id="driver-new-password" dir="ltr" type="password" autoComplete="new-password"
                      minLength={8} value={password} onChange={(event) => setPassword(event.target.value)}
                      placeholder="••••••••" required
                      className="w-full rounded-2xl border border-border bg-background px-3 py-3 text-left" />
                  </>
                )}
                <button type="submit" disabled={busy || checking || (otpSent && (otpCode.length !== 6 || password.length < 8))}
                  className="w-full rounded-2xl bg-primary px-4 py-3 font-bold text-primary-foreground disabled:opacity-50">
                  {busy ? "لطفاً صبر کنید…" : otpSent ? "تأیید شماره و ساخت حساب ورود" : "ارسال کد تأیید برای ساخت حساب"}
                </button>
              </>
            )}
          </form>}
        </>
      )}
      {checking && <p className="mt-2 text-xs text-muted-foreground">در حال بررسی وضعیت حساب…</p>}
      {notice && <p role="status" className="mt-2 text-sm text-primary">{notice}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  );
}
