import { useEffect, useState, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { BackgroundGeolocation } from "@/lib/background-geolocation";
import { APP_TARGET } from "@/lib/app-target";
import { Btn, Card } from "@/components/ui-kit";

type GateState = "checking" | "blocked" | "ready";

export function AppPermissionGate({ children }: { children: ReactNode }) {
  const required = Capacitor.isNativePlatform() && (APP_TARGET === "passenger" || APP_TARGET === "driver");
  const [state, setState] = useState<GateState>(required ? "checking" : "ready");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!required) {
      setState("ready");
      return;
    }

    let disposed = false;
    let completed = false;
    let watcherId: string | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const removeWatcher = () => {
      if (watcherId) {
        const id = watcherId;
        watcherId = null;
        void BackgroundGeolocation.removeWatcher({ id });
      }
    };

    setState("checking");
    setMessage("");
    timeoutId = setTimeout(() => {
      if (completed || disposed) return;
      completed = true;
      setMessage("دریافت موقعیت مکانی بیش از حد طول کشید. GPS گوشی و دسترسی مکان را بررسی کنید.");
      setState("blocked");
      removeWatcher();
    }, 30000);

    void BackgroundGeolocation.addWatcher(
      { requestPermissions: true, stale: false, distanceFilter: 0 },
      (location, error) => {
        if (disposed || completed) return;
        if (error) {
          completed = true;
          if (timeoutId) clearTimeout(timeoutId);
          setMessage(
            error.code === "NOT_AUTHORIZED"
              ? "برای استفاده از این برنامه، اجازه موقعیت مکانی دقیق ضروری است. بدون این اجازه امکان ادامه وجود ندارد."
              : error.message || "موقعیت مکانی دریافت نشد. GPS گوشی را روشن کنید و دوباره تلاش کنید.",
          );
          setState("blocked");
          removeWatcher();
          return;
        }
        if (location) {
          completed = true;
          if (timeoutId) clearTimeout(timeoutId);
          setState("ready");
          setMessage("");
          removeWatcher();
        }
      },
    ).then((id) => {
      watcherId = id;
      if (disposed || completed) removeWatcher();
    }).catch((error: unknown) => {
      if (disposed || completed) return;
      completed = true;
      if (timeoutId) clearTimeout(timeoutId);
      setMessage(error instanceof Error ? error.message : "گرفتن مجوز مکان ناموفق بود.");
      setState("blocked");
    });

    return () => {
      disposed = true;
      if (timeoutId) clearTimeout(timeoutId);
      removeWatcher();
    };
  }, [required, attempt]);

  if (state === "ready") return <>{children}</>;

  return (
    <main dir="rtl" className="flex min-h-screen items-center justify-center p-5">
      <Card className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-xl font-black">اجازه موقعیت مکانی لازم است</h1>
        {state === "checking" ? (
          <p className="text-sm text-muted-foreground">برای راه‌اندازی صحیح سفر‌یار، در حال درخواست مجوز مکان‌یابی دقیق هستیم. لطفاً درخواست اندروید را تأیید کنید…</p>
        ) : (
          <>
            <p role="alert" className="text-sm text-destructive">{message}</p>
            <p className="text-xs text-muted-foreground">تا زمانی که دسترسی مکان‌یابی فعال نشود، وارد برنامه نمی‌شوید. پس از رد دائمی مجوز، آن را از تنظیمات گوشی فعال کنید.</p>
            <div className="flex flex-col gap-2">
              <Btn onClick={() => setAttempt((value) => value + 1)}>تلاش دوباره برای دریافت مجوز</Btn>
              <Btn variant="ghost" onClick={() => void BackgroundGeolocation.openSettings()}>بازکردن تنظیمات دسترسی برنامه</Btn>
            </div>
          </>
        )}
      </Card>
    </main>
  );
}
