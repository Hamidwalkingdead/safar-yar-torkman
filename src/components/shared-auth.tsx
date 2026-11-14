import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Btn } from "./ui-kit";

const AuthContext = createContext<{ userId: string | null; ready: boolean }>({
  userId: null,
  ready: false,
});
export const useSharedAuth = () => useContext(AuthContext);
export function SharedAuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const cache = useQueryClient();
  useEffect(() => {
    // INITIAL_SESSION is the authoritative startup snapshot. Avoid racing
    // getUser() against SIGNED_IN/SIGNED_OUT during app initialization.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED", "INITIAL_SESSION"].includes(event)) return;
      setUserId(session?.user.id ?? null);
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
  return <AuthContext.Provider value={{ userId, ready }}>{children}</AuthContext.Provider>;
}
const faDigits = (s: string) => s.replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)));
export function toIranE164(input: string): string | null {
  const d = faDigits(input).replace(/\D/g, "");
  const m = d.match(/^(?:0098|98|0)?(9\d{9})$/);
  return m ? `+98${m[1]}` : null;
}
export function SharedSignIn() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [role, setRole] = useState<"passenger" | "driver">("passenger");
  async function sendCode() {
    setError("");
    const e164 = toIranE164(phone);
    if (!e164) return setError("شماره همراه معتبر ایران وارد کنید (مثلاً ۰۹۱۲۳۴۵۶۷۸۹).");
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
    setBusy(false);
    if (error)
      setError(
        error.message.toLowerCase().includes("provider") || error.message.includes("phone")
          ? "ارسال پیامک فعال نیست؛ سرویس پیامک باید در تنظیمات حساب‌ها متصل شود."
          : "ارسال کد انجام نشد؛ کمی بعد دوباره تلاش کنید.",
      );
    else setSentTo(e164);
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
        ثبت‌نام و ورود فقط با شماره همراه؛ حساب جدید به‌صورت خودکار ساخته می‌شود.
      </p>
      {!sentTo ? (
        <>
          <div className="flex gap-2" role="radiogroup" aria-label="نقش">
            {(["passenger", "driver"] as const).map((r) => (
              <Btn
                key={r}
                variant={role === r ? "primary" : "ghost"}
                aria-pressed={role === r}
                onClick={() => setRole(r)}
              >
                {r === "passenger" ? "مسافر هستم" : "راننده هستم"}
              </Btn>
            ))}
          </div>
          <input
            aria-label="شماره همراه"
            inputMode="tel"
            dir="ltr"
            placeholder="09123456789"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-2xl bg-muted p-3 text-left"
          />
          <Btn disabled={busy} onClick={sendCode}>
            ارسال کد تأیید
          </Btn>
        </>
      ) : (
        <>
          <p className="text-sm">کد پیامک‌شده به {sentTo} را وارد کنید.</p>
          <input
            aria-label="کد تأیید"
            inputMode="numeric"
            dir="ltr"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full rounded-2xl bg-muted p-3 text-center tracking-widest"
          />
          <div className="flex flex-wrap gap-2">
            <Btn disabled={busy || code.length < 4} onClick={verify}>
              تأیید و ورود
            </Btn>
            <Btn variant="ghost" disabled={busy} onClick={() => setSentTo(null)}>
              تغییر شماره
            </Btn>
          </div>
        </>
      )}
      {role === "driver" && !sentTo && (
        <p className="text-xs text-muted-foreground">
          پس از ورود، مشخصات خودرو را در پروفایل تکمیل و «ثبت‌نام راننده» را بزنید.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
