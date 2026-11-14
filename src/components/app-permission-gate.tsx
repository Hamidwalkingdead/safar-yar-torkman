import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { BackgroundGeolocation } from "@/lib/background-geolocation";
import { BackgroundLocationPermission } from "@/lib/background-location-permission";
import { APP_TARGET } from "@/lib/app-target";
import { Btn, Card } from "@/components/ui-kit";

type GateState = "checking" | "blocked" | "ready";
type PermissionStep = "foreground" | "background" | "notifications" | "gps";

const stepDetails: Record<PermissionStep, { title: string; detail: string; action: string }> = {
  foreground: {
    title: "مکان‌یابی هنگام استفاده",
    detail: "اجازه مکان‌یابی دقیق (Precise location) هنگام استفاده از سفر‌یار باید فعال باشد.",
    action: "بازکردن تنظیمات مکان",
  },
  background: {
    title: "مکان‌یابی همیشگی در پس‌زمینه",
    detail: "در صفحه مجوزهای برنامه، مسیر مکان ← «همیشه مجاز / Allow all the time» را انتخاب کنید. صرفاً روشن‌بودن GPS کافی نیست.",
    action: "رفتن به تنظیم مجوز مکان",
  },
  notifications: {
    title: "اعلان سرویس GPS",
    detail: "اعلان‌های سفر‌یار را فعال کنید تا اندروید بتواند سرویس مکان‌یابی پس‌زمینه را با اعلان دائمی اجرا کند.",
    action: "بازکردن تنظیم اعلان‌ها",
  },
  gps: {
    title: "دریافت موقعیت GPS",
    detail: "GPS گوشی را روشن کنید، دسترسی مکان دقیق را بررسی کنید و دوباره تلاش کنید.",
    action: "بازکردن تنظیمات برنامه",
  },
};

export function AppPermissionGate({ children }: { children: ReactNode }) {
  const nativeRole = APP_TARGET === "passenger" || APP_TARGET === "driver";
  const required = Capacitor.isNativePlatform() && nativeRole;
  const [state, setState] = useState<GateState>(required ? "checking" : "ready");
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
      // This requests foreground precise location only; it does not request camera or media access.
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (watcherId) {
            void BackgroundGeolocation.removeWatcher({ id: watcherId });
            watcherId = null;
          }
          if (error) reject(error);
          else resolve();
        };

        const timeout = setTimeout(() => finish(new Error("برای دریافت GPS زمان زیادی گذشت. GPS گوشی را روشن کنید و دوباره تلاش کنید.")), 30000);
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

      setStep("background");
      const background = await BackgroundLocationPermission.check();
      if (background.required && !background.granted) {
        setMessage("مجوز مشخصِ ناقص: مکان‌یابی همیشگی در پس‌زمینه (Allow all the time).");
        setState("blocked");
        return;
      }

      setStep("notifications");
      let notification = await LocalNotifications.checkPermissions();
      if (notification.display !== "granted") {
        notification = await LocalNotifications.requestPermissions();
      }
      if (notification.display !== "granted") {
        setMessage("مجوز مشخصِ ناقص: نمایش اعلان‌های سفر‌یار برای سرویس GPS پس‌زمینه.");
        setState("blocked");
        return;
      }

      setState("ready");
    } catch (error) {
      if (watcherId) void BackgroundGeolocation.removeWatcher({ id: watcherId });
      setStep("gps");
      setMessage(error instanceof Error ? error.message : "بررسی مکان‌یابی ناموفق بود.");
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
    return () => document.removeEventListener("visibilitychange", retry);
  }, [required, state]);

  if (state === "ready") return <>{children}</>;

  const details = stepDetails[step];
  const openSettings = async () => {
    if (step === "background") {
      await BackgroundLocationPermission.openSettings({ permission: "background_location" });
      return;
    }
    if (step === "notifications") {
      await BackgroundLocationPermission.openSettings({ permission: "notifications" });
      return;
    }
    await BackgroundGeolocation.openSettings();
  };

  return (
    <main dir="rtl" className="flex min-h-screen items-center justify-center p-5">
      <Card className="w-full max-w-md space-y-4 text-right">
        <h1 className="text-xl font-black">دسترسی‌های ضروری سفر‌یار</h1>
        {state === "checking" ? (
          <div className="space-y-2">
            <p className="text-sm font-bold">در حال بررسی مجوزها…</p>
            <p className="text-sm text-muted-foreground">ابتدا مکان دقیق، سپس مکان‌یابی همیشگی و در پایان اعلان سرویس GPS بررسی می‌شود.</p>
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <p className="font-bold text-destructive">{details.title}</p>
              <p role="alert" className="mt-1 text-sm">{message}</p>
              <p className="mt-2 text-sm text-muted-foreground">{details.detail}</p>
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>✓ مکان دقیق هنگام استفاده از برنامه بررسی شد.</p>
              <p>{step === "background" ? "✕" : "✓"} مکان‌یابی همیشگی در پس‌زمینه</p>
              <p>{step === "notifications" ? "✕" : step === "background" ? "در انتظار" : "✓"} اعلان سرویس GPS</p>
            </div>
            <div className="flex flex-col gap-2">
              <Btn onClick={() => void openSettings()}>{details.action}</Btn>
              <Btn variant="ghost" onClick={() => setAttempt((value) => value + 1)}>بررسی دوباره مجوزها</Btn>
            </div>
          </>
        )}
      </Card>
    </main>
  );
}
