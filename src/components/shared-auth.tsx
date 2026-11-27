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
      // Passenger and driver apps start with a temporary session; phone verification
      // upgrades it to a recoverable account. Admin access remains invitation based.
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

export function SharedSignIn() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");

  // Passenger and driver accounts use their dedicated phone/code flows.
  // The owner signs in with the existing admin account's password; the email
  // identity stays internal and is never requested or opened in Gmail.
  if (APP_TARGET !== "admin") return null;

  async function signInAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) {
      setError("رمز عبور را وارد کنید.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: OWNER_ADMIN_EMAIL,
        password,
      });
      if (error) throw error;
      setPassword("");
    } catch {
      setError("ورود انجام نشد؛ رمز عبور حساب مدیر را بررسی کنید.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void signInAdmin(event)} className="space-y-3 border-t border-border pt-3">
      <p className="text-sm text-muted-foreground">
        ورود امن مدیر با رمز عبور انجام می‌شود؛ نیازی به باز کردن ایمیل یا دریافت پیوند جیمیل نیست.
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
