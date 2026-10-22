import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
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
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (alive) {
        setUserId(data.user?.id ?? null);
        setReady(true);
      }
    });
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
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [cache]);
  return <AuthContext.Provider value={{ userId, ready }}>{children}</AuthContext.Provider>;
}
export function SharedSignIn() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function login(provider: "google" | "lovable") {
    setBusy(true);
    setError("");
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: `${window.location.origin}${window.location.pathname}${window.location.search}`,
      });
      if (result.error) setError("ورود انجام نشد؛ دوباره تلاش کنید.");
    } catch {
      setError("ورود انجام نشد؛ دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="text-sm text-muted-foreground">برای ثبت یا پذیرش سفر وارد حساب شوید.</p>
      <div className="flex flex-wrap gap-2">
        <Btn disabled={busy} onClick={() => login("google")}>
          ورود با گوگل
        </Btn>
        <Btn variant="ghost" disabled={busy} onClick={() => login("lovable")}>
          ورود با Lovable
        </Btn>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
