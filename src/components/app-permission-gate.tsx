import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { BackgroundGeolocation } from "@/lib/background-geolocation";
import { BackgroundLocationPermission } from "@/lib/background-location-permission";
import { APP_TARGET } from "@/lib/app-target";
import { Btn, Card } from "@/components/ui-kit";

type GateState = "checking" | "blocked" | "ready";
type PermissionStep = "foreground" | "background" | "notifications" | "gps";

export function AppPermissionGate({ children }: { children: ReactNode }) {
  const nativeRole = APP_TARGET === "passenger" || APP_TARGET === "driver";
  const required = Capacitor.isNativePlatform() && nativeRole;
  const [state, setState] = useState<GateState>(nativeRole ? "checking" : "ready");
  const [step, setStep] = useState<PermissionStep>("foreground");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);

  const verify = useCallback(async () => {
    if (!required) {
      setState("ready");
      return;
    }

    setState("checking");
    setMessage("");
    setStep("foreground");

    let watcherId: string | null = null;
    try {
      // First obtain a fresh foreground GPS fix and let Android request precise location.
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          if (timeout) clearTimeout(timeout);
          if (watcherId) {
            void BackgroundGeolocation.removeWatcher({ id: watcherId });
            watcherId = null;
          }
          if (error) reject(error);
          else resolve();
        };

        const timeoutId = setTimeout(() => finish(new Error("برای دریافت GPS زمان زیادی گذشت. GPS گوشی را روشن کنید و دوباره تلاش کنید.")), 30000);
        timeout = timeoutId;
        void BackgroundGeolocation.addWatcher(
          { requestPermissions: true, stale: false, distanceFilter: 0 },
          (location, error) => {
            if (error) return finish(new Error(error.message || "مجوز مکان‌یابی دقیق داده نشد."));
            if (location) finish();
          },
        ).then((id) => {
          watcherId = id;
        }).catch((error: unknown) => {
          finish(error instanceof Error ? error : new Error("درخواست مجوز مکان‌یابی ناموفق بود."));
        });
      });

      // Android 10+ requires a separate, explicit Allow all the time grant.
      setStep("background");
      const background = await BackgroundLocationPermission.check();
      if (background.required && !background.granted) {
        setMessage("دسترسی مکان در پس‌زمینه هنوز فعال نیست. در تنظیمات برنامه، مجوز مکان را روی «همیشه مجاز / Allow all the time» قرار دهید. بدون آن، GPS هنگام خاموش‌شدن صفحه یا رفتن برنامه به پس‌زمینه درست کار نخواهد کرد.");
        setState("blocked");
        return;
      }

      // The background location service must show its persistent notification.
      setStep("notifications");
      let notification = await LocalNotifications.checkPermissions();
      if (notification.display !== "granted") {
        notification = await LocalNotifications.requestPermissions();
      }
      if (notification.display !== "granted") {
        setMessage("برای اجرای قانونی و پایدار GPS در پس‌زمینه، اجازه اعلان دائمی سفر‌یار لازم است. اعلان را در تنظیمات گوشی فعال کنید.");
        setState("blocked");
        return;
      }

      setState("ready");
    } catch (error) {
      if (watcherId) void BackgroundGeolocation.removeWatcher({ id: watcherId });
      setStep("gps");
      setMessage(error instanceof Error ? error.message : "دریافت مجوزهای ضروری ناموفق بود.");
      setState("blocked");
    }
  }, [required]);

  useEffect(() => {
    void verify();
  }, [verify, attempt]);

  useEffect(() => {
    if (!required || state !== "blocked") return;
    const retry = () => setAttempt((value) => value + 1);
    document.addEventListener("visibilitychange", retry);
    return () => {
      document.removeEventListener("visibilitychange", retry);
    };
  }, [required, state]);

  if (state === "ready") return <>{children}</>;

  const openSettings = async () => {
    if (step === "background" || step === "notifications") {
      await BackgroundLocationPermission.openSettings();
      return;
    }
    await BackgroundGeolocation.openSettings();
  };

  return (
    <main dir="rtl" className="flex min-h-screen items-center justify-center p-5">
      <Card className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-xl font-black">مجوزهای ضروری سفر‌یار</h1>
        {state === "checking" ? (
          <p className="text-sm text-muted-foreground">در حال بررسی GPS دقیق، اجازه مکان‌یابی همیشگی و اعلان اجرای پس‌زمینه هستیم. تا تکمیل همه مجوزهای لازم، وارد برنامه نمی‌شوید…</p>
        ) : (
          <>
            <p role="alert" className="text-sm text-destructive">{message}</p>
            {step === "background" && <p className="text-xs text-muted-foreground">تنظیمات برنامه ← مجوزها ← مکان ← همیشه مجاز</p>}
            <div className="flex flex-col gap-2">
              <Btn onClick={() => void openSettings()}>بازکردن تنظیمات مجوزها</Btn>
              <Btn variant="ghost" onClick={() => setAttempt((value) => value + 1)}>بررسی دوباره مجوزها</Btn>
            </div>
          </>
        )}
      </Card>
    </main>
  );
}
