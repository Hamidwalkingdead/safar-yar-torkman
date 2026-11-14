import { useEffect, useRef, useState } from "react";
import { MapPin, Radio, RadioTower } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
  const watcher = useRef<number | null>(null);
  const lastSentAt = useRef(0);
  const lastPoint = useRef<Coordinates | null>(null);

  async function sendPresence(point: Coordinates, isOnline: boolean) {
    const { error: rpcError } = await supabase.rpc("heartbeat_driver_presence", {
      p_latitude: point.latitude,
      p_longitude: point.longitude,
      p_accuracy_m: point.accuracy,
      p_heading_deg: point.heading,
      p_is_online: isOnline,
    });
    if (rpcError) throw rpcError;
  }

  function stopWatcher() {
    if (watcher.current !== null) {
      navigator.geolocation.clearWatch(watcher.current);
      watcher.current = null;
    }
  }

  async function goOnline() {
    if (!navigator.geolocation) {
      setError("موقعیت‌یابی در این دستگاه پشتیبانی نمی‌شود.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 5000,
          timeout: 20000,
        });
      });
      const coords = position.coords;
      const point: Coordinates = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
        heading: coords.heading !== null && Number.isFinite(coords.heading) ? coords.heading : null,
      };
      await sendPresence(point, true);
      lastPoint.current = point;
      lastSentAt.current = Date.now();
      setOnline(true);
      watcher.current = navigator.geolocation.watchPosition(
        (next) => {
          const now = Date.now();
          if (now - lastSentAt.current < 15000) return;
          const c = next.coords;
          const fresh: Coordinates = {
            latitude: c.latitude,
            longitude: c.longitude,
            accuracy: Number.isFinite(c.accuracy) ? c.accuracy : null,
            heading: c.heading !== null && Number.isFinite(c.heading) ? c.heading : null,
          };
          lastSentAt.current = now;
          void sendPresence(fresh, true)
            .then(() => { lastPoint.current = fresh; setError(""); })
            .catch(() => setError("به‌روزرسانی موقعیت ناموفق بود؛ وضعیت آنلاین پس از دو دقیقه خودکار از فهرست خارج می‌شود."));
        },
        () => setError("دریافت موقعیت تازه ناموفق بود؛ GPS و مجوز مکان را بررسی کنید."),
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
      );
    } catch (cause) {
      setOnline(false);
      const message = cause instanceof Error ? cause.message : "";
      setError(message || "فعال‌کردن وضعیت آنلاین ناموفق بود؛ اجازه GPS و اتصال اینترنت را بررسی کنید.");
    } finally {
      setBusy(false);
    }
  }

  async function goOffline() {
    setBusy(true);
    stopWatcher();
    try {
      if (lastPoint.current) await sendPresence(lastPoint.current, false);
      setOnline(false);
      setError("");
    } catch {
      setError("ثبت آفلاین شدن در سرور انجام نشد؛ وضعیت آنلاین با پایان تازگی GPS حداکثر پس از دو دقیقه منقضی می‌شود.");
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
        با آنلاین شدن، موقعیت تقریبی شما فقط برای یافتن راننده مناسب در سامانه ثبت می‌شود. مسافر تا زمان تخصیص سفر به موقعیت خام شما دسترسی ندارد.
      </p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Btn disabled={busy} variant={online ? "ghost" : "primary"} onClick={() => void (online ? goOffline() : goOnline())}>
        <MapPin className="ml-2 size-4" />
        {busy ? "در حال ثبت…" : online ? "رفتن به حالت آفلاین" : "فعال‌کردن دریافت سفر"}
      </Btn>
    </Card>
  );
}
