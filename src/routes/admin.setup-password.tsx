import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Btn, Card } from "@/components/ui-kit";
import { toIranE164 } from "@/components/shared-auth";

export const Route = createFileRoute("/admin/setup-password")({
  head: () => ({
    meta: [
      { title: "تعیین رمز اولیه مدیر | سفر یار ترکمن" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AdminPasswordSetup,
});

function AdminPasswordSetup() {
  const [phone, setPhone] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    const e164 = toIranE164(phone);
    if (!e164) return setError("شماره همراه معتبر ایران وارد کنید.");
    if (setupSecret.trim().length < 32) return setError("کلید راه‌اندازی معتبر نیست.");
    if (password.length < 12) return setError("رمز باید حداقل ۱۲ نویسه داشته باشد.");
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password))
      return setError("رمز باید شامل حروف کوچک و بزرگ انگلیسی، عدد و نشانه باشد.");
    if (password !== confirmPassword) return setError("تکرار رمز با رمز اصلی یکسان نیست.");

    setBusy(true);
    const { data, error: invokeError } = await supabase.functions.invoke("admin-password-bootstrap", {
      body: { phone: e164, setupSecret: setupSecret.trim(), password },
    });
    setBusy(false);
    if (invokeError) {
      setError("ثبت رمز انجام نشد. تنظیمات راه‌اندازی در Supabase را بررسی کنید.");
      return;
    }
    if (!data?.success) {
      setError(data?.error || "امکان تعیین رمز وجود ندارد.");
      return;
    }
    setDone(true);
    setPhone("");
    setSetupSecret("");
    setPassword("");
    setConfirmPassword("");
    toast.success("رمز اولیه حساب مالک با موفقیت ثبت شد.");
  }

  return (
    <main dir="rtl" className="mx-auto flex min-h-screen max-w-xl items-center p-4">
      <Card className="w-full space-y-4 p-5">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-black">تعیین رمز اولیه مدیر</h1>
          <p className="text-sm text-muted-foreground">
            این صفحه فقط برای حساب مالک است و پس از ثبت موفق رمز، برای همیشه بسته می‌شود.
          </p>
        </div>
        {done ? (
          <div className="space-y-3">
            <p role="status" className="text-sm font-semibold text-green-700">رمز حساب مالک ثبت شد. اکنون می‌توانید با شماره همراه و رمز جدید وارد پنل مدیریت شوید.</p>
            <Link to="/admin" className="block rounded-xl bg-primary p-3 text-center font-bold text-primary-foreground">رفتن به ورود مدیریت</Link>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block space-y-1 text-sm">
              <span>شماره همراه حساب مالک</span>
              <input autoComplete="username" inputMode="tel" dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="09123456789" className="w-full rounded-xl border border-border bg-background p-3 text-left" />
            </label>
            <label className="block space-y-1 text-sm">
              <span>کلید یک‌بارمصرف راه‌اندازی</span>
              <input type="password" autoComplete="off" dir="ltr" value={setupSecret} onChange={e => setSetupSecret(e.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-left" />
            </label>
            <label className="block space-y-1 text-sm">
              <span>رمز جدید (حداقل ۱۲ نویسه)</span>
              <input type="password" autoComplete="new-password" dir="ltr" value={password} onChange={e => setPassword(e.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-left" />
            </label>
            <label className="block space-y-1 text-sm">
              <span>تکرار رمز جدید</span>
              <input type="password" autoComplete="new-password" dir="ltr" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-left" />
            </label>
            <p className="text-xs text-muted-foreground">رمز و کلید راه‌اندازی فقط به تابع امن Supabase ارسال می‌شوند و در جدول‌های برنامه ذخیره نمی‌شوند.</p>
            <Btn disabled={busy || !phone || !setupSecret || !password || !confirmPassword} onClick={() => void submit()}>{busy ? "در حال ثبت امن رمز…" : "ثبت رمز اولیه مالک"}</Btn>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <Link to="/admin" className="block text-center text-sm text-muted-foreground underline">بازگشت به ورود مدیریت</Link>
      </Card>
    </main>
  );
}
