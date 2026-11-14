import { useEffect, useRef, useState } from "react";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { MapPin, Radio, RadioTower } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BackgroundGeolocation } from "@/lib/background-geolocation";
import { Btn, Card } from "@/components/ui-kit";

type Coordinates = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
};

export function DriverPresenceControl() {
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const watcher = useRef<string | null>(null);
  const lastSentAt = useRef(0);
  const lastPoint = useRef<Coordinates | null>(null);

  async function sendPresence(point: Coordinates, isOnline: boolean) {
    const args = {
      p_latitude: point.latitude,
      p_longitude: point.longitude,
      p_accuracy_m: point.accuracy,
      p_heading_deg: point.heading,
      p_is_online: isOnline,
    };
    if (!Capacitor.isNativePlatform()) {
      const { error: rpcError } = await supabase.rpc("heartbeat_driver_presence", args);
      if (rpcError) throw rpcError;
      return;
    }

    const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, "");
    const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !apiKey) throw new Error("تنظیمات ارتباط با سرور کامل نیست.");
    const current = await supabase.auth.getSession();
    let session = current.data.session;
    if (current.error || !session) throw new Error("نشست کاربری برای ارسال موقعیت در دسترس نیست.");

    const send = () => CapacitorHttp.request({
      url: url + "/rest/v1/rpc/heartbeat_driver_presence",
      method: "POST",
      headers: {
        apikey: apiKey,
        Authorization: "Bearer " + session!.access_token,
        "Content-Type": "application/json",
      },
      data: args,
    });
    let response = await send();
    if (response.status === 401 && session.refresh_token) {
      const refreshed = await CapacitorHttp.request({
        url: url + "/auth/v1/token?grant_type=refresh_token",
        method: "POST",
        headers: { apikey: apiKey, "Content-Type": "application/json" },
        data: { refresh_token: session.refresh_token },
      });
      const tokens = refreshed.data as { access_token?: string; refresh_token?: string };
      if (refreshed.status >= 200 && refreshed.status < 300 && tokens.access_token && tokens.refresh_token) {
        const updated = await supabase.auth.setSession({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
        });
        if (updated.error || !updated.data.session) throw new Error("نشست کاربری تازه‌سازی نشد.");
        session = updated.data.session;
        response = await send();
      }
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error("ارسال موقعیت راننده به سرور ناموفق بود (HTTP " + response.status + ").");
    }
  }

  function stopWatcher() {
    if (watcher.current) {
      const id = watcher.current;
      watcher.current = null;
      void BackgroundGeolocation.removeWatcher({ id });
    }
  }

  async function goOnline() {
    setBusy(true);
    setError("");
    try {
      await new Promise<void>((resolve, reject) => {
        let firstFix = false;
        let failed = false;
        let createdId: string | null = null;
        const timeout = setTimeout(() => {
          if (!firstFix) {
            failed = true;
            if (createdId) void BackgroundGeolocation.removeWatcher({ id: createdId });
            reject(new Error("دریافت GPS انجام نشد. مجوز مکان‌یابی و روشن‌بودن GPS را بررسی کنید."));
          }
        }, 30000);

        void BackgroundGeolocation.addWatcher(
          {
            requestPermissions: false,
            stale: false,
            distanceFilter: 20,
            backgroundTitle: "سفر‌یار ترکمن — موقعیت راننده",
            backgroundMessage: "برای دریافت سفر و ثبت موقعیت، GPS در پس‌زمینه فعال است.",
          },
          (location, callbackError) => {
            if (callbackError) {
              if (!firstFix) {
                failed = true;
                clearTimeout(timeout);
                if (createdId) void BackgroundGeolocation.removeWatcher({ id: createdId });
                reject(new Error(callbackError.message || "ردیابی GPS شروع نشد."));
              } else {
                setError("ردیابی GPS در پس‌زمینه دچار خطا شد؛ مجوزها و تنظیمات باتری را بررسی کنید.");
              }
              return;
            }
            if (!location) return;

            const point: Coordinates = {
              latitude: location.latitude,
              longitude: location.longitude,
              accuracy: Number.isFinite(location.accuracy) ? location.accuracy : null,
              heading: location.bearing !== null && Number.isFinite(location.bearing) ? location.bearing : null,
            };
            const now = Date.now();
            if (!firstFix) {
              firstFix = true;
              clearTimeout(timeout);
              void sendPresence(point, true).then(() => {
                lastPoint.current = point;
                lastSentAt.current = now;
                setOnline(true);
                resolve();
              }).catch((cause: unknown) => {
                failed = true;
                if (createdId) void BackgroundGeolocation.removeWatcher({ id: createdId });
                reject(cause instanceof Error ? cause : new Error("ثبت موقعیت راننده انجام نشد."));
              });
              return;
            }
            if (now - lastSentAt.current < 15000) return;
            lastSentAt.current = now;
            void sendPresence(point, true)
              .then(() => { lastPoint.current = point; setError(""); })
              .catch(() => setError("ارسال موقعیت تازه ناموفق بود؛ پس از دو دقیقه از فهرست رانندگان آنلاین خارج می‌شوید."));
          },
        ).then((id) => {
          createdId = id;
          if (failed) {
            void BackgroundGeolocation.removeWatcher({ id });
            return;
          }
          watcher.current = id;
        }).catch((cause: unknown) => {
          clearTimeout(timeout);
          reject(cause instanceof Error ? cause : new Error("راه‌اندازی GPS پس‌زمینه ناموفق بود."));
        });
      });
    } catch (cause) {
      stopWatcher();
      setOnline(false);
      setError(cause instanceof Error ? cause.message : "فعال‌کردن وضعیت آنلاین ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  async function goOffline() {
    setBusy(true);
    stopWatcher();
    setOnline(false);
    try {
      if (lastPoint.current) await sendPresence(lastPoint.current, false);
      setError("");
    } catch {
      setError("ثبت آفلاین شدن در سرور انجام نشد؛ وضعیت آنلاین پس از دو دقیقه بدون GPS تازه منقضی می‌شود.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => () => stopWatcher(), []);

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        {online ? <RadioTower className="size-5 text-primary" /> : <Radio className="size-5 text-muted-foreground" />}
        <b>وضعیت دریافت سفر</b>
        <span className={online ? "text-sm font-bold text-primary" : "text-sm text-muted-foreground"}>
          {online ? "آنلاین" : "آفلاین"}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        هنگام آنلاین‌بودن، GPS حتی با خاموش‌شدن صفحه و رفتن برنامه به پس‌زمینه فعال می‌ماند و اعلان دائمی اندروید نمایش داده می‌شود. موقعیت خام شما فقط برای یافتن راننده مناسب در سامانه ثبت می‌شود.
      </p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Btn disabled={busy} variant={online ? "ghost" : "primary"} onClick={() => void (online ? goOffline() : goOnline())}>
        <MapPin className="ml-2 size-4" />
        {busy ? "در حال ثبت…" : online ? "رفتن به حالت آفلاین" : "فعال‌کردن دریافت سفر"}
      </Btn>
    </Card>
  );
}
