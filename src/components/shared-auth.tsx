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
export function SharedSignIn() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  // Passenger and driver access does not ask for phone, SMS, voice call, or email.
  if (APP_TARGET !== "admin") return null;

  async function sendAdminLink() {
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError("نشانی ایمیل معتبر مدیر را وارد کنید.");
      return;
    }
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email: normalized,
      options: { emailRedirectTo: "https://safar-yar-torkman.lovable.app/admin", shouldCreateUser: false },
    });
    setBusy(false);
    if (error) setError("ارسال پیوند ورود مدیر انجام نشد؛ ایمیل و تنظیمات ورود را بررسی کنید.");
    else setSent(true);
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="text-sm text-muted-foreground">
        ورود مدیر فقط با پیوند امن ایمیل انجام می‌شود. حساب باید از قبل توسط مدیر اصلی دعوت شده باشد.
      </p>
      {!sent ? (
        <>
          <input aria-label="ایمیل مدیر" type="email" inputMode="email" autoComplete="email" dir="ltr"
            placeholder="admin@example.com" value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-2xl bg-muted p-3 text-left" />
          <Btn disabled={busy} onClick={() => void sendAdminLink()}>
            {busy ? "در حال ارسال…" : "ارسال پیوند ورود به ایمیل"}
          </Btn>
        </>
      ) : (
        <p className="rounded-xl bg-muted p-3 text-sm">پیوند ورود ارسال شد؛ صندوق ورودی ایمیل مدیر را بررسی کنید.</p>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
