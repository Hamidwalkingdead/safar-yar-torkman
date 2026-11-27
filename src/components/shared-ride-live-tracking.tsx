import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { BackgroundGeolocation } from "@/lib/background-geolocation";
import { supabase } from "@/integrations/supabase/client";
import { Card, Btn } from "@/components/ui-kit";
import { RouteMap } from "@/components/route-map";

type SharedLocation = {
  ride_id: string; user_id: string; latitude: number; longitude: number;
  accuracy_m: number | null; heading_deg: number | null; speed_mps: number | null; updated_at: string;
};

export function SharedRideLiveTracking({ rideId, userId, driverId, enabled }: {
  rideId: string; userId: string; driverId: string | null; enabled: boolean;
}) {
  const cache = useQueryClient();
  const lastSent = useRef(0);
  const [gpsError, setGpsError] = useState("");
  const [consentLoaded, setConsentLoaded] = useState(false);
  const [sharingEnabled, setSharingEnabled] = useState(false);
  const consentKey = `safaryar:shared-tracking:${userId}:${rideId}`;
  const trackingActive = enabled && consentLoaded && sharingEnabled;

  useEffect(() => {
    if (!enabled) {
      localStorage.removeItem(consentKey);
      setSharingEnabled(false);
      setConsentLoaded(true);
      return;
    }
    setSharingEnabled(localStorage.getItem(consentKey) === "1");
    setConsentLoaded(true);
  }, [consentKey, enabled]);

  function toggleSharing() {
    if (!enabled || !consentLoaded) return;
    const next = !sharingEnabled;
    setSharingEnabled(next);
    if (next) localStorage.setItem(consentKey, "1");
    else localStorage.removeItem(consentKey);
  }
  const locations = useQuery({
    queryKey: ["shared-ride-live-locations", rideId],
    enabled: trackingActive,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
      const { data, error } = await supabase.from("shared_ride_locations").select("*").eq("ride_id", rideId).gte("updated_at", cutoff);
      if (error) throw error;
      return (data ?? []) as SharedLocation[];
    },
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!trackingActive || !userId) return;
    let cancelled = false;
    let watcherId: string | undefined;
    const publish = async (latitude: number, longitude: number, accuracy: number | null, heading: number | null, speed: number | null) => {
      if (cancelled || Date.now() - lastSent.current < 8000) return;
      lastSent.current = Date.now();
      const { error } = await supabase.rpc("upsert_shared_ride_location", {
        p_ride: rideId, p_latitude: latitude, p_longitude: longitude,
        p_accuracy: accuracy, p_heading: heading, p_speed: speed,
      });
      if (error) setGpsError("ارسال موقعیت گروه انجام نشد؛ اتصال اینترنت و دسترسی GPS را بررسی کنید.");
      else {
        setGpsError("");
        void cache.invalidateQueries({ queryKey: ["shared-ride-live-locations", rideId] });
      }
    };

    if (Capacitor.getPlatform() === "android") {
      const start = async () => {
        let permission = await LocalNotifications.checkPermissions();
        if (permission.display !== "granted") permission = await LocalNotifications.requestPermissions();
        if (permission.display !== "granted") {
          setGpsError("برای اشتراک موقعیت در پس‌زمینه، اجازه اعلان دائمی را فعال کنید.");
          return;
        }
        const id = await BackgroundGeolocation.addWatcher({
          backgroundTitle: "سفر یار ترکمن",
          backgroundMessage: "موقعیت شما فقط با اعضای گروه سفر اشتراکی به اشتراک گذاشته می‌شود.",
          requestPermissions: true,
          stale: false,
          distanceFilter: 0,
        }, (location, error) => {
          if (cancelled) return;
          if (error) { setGpsError(error.message || "سرویس GPS پس‌زمینه با خطا روبه‌رو شد."); return; }
          if (!location || cancelled) return;
          void publish(location.latitude, location.longitude, location.accuracy, location.bearing, location.speed);
        });
        if (cancelled) await BackgroundGeolocation.removeWatcher({ id });
        else { watcherId = id; setGpsError(""); }
      };
      void start().catch((error) => setGpsError(error instanceof Error ? error.message : "راه‌اندازی GPS ناموفق بود."));
      return () => {
        cancelled = true;
        if (watcherId) void BackgroundGeolocation.removeWatcher({ id: watcherId });
      };
    }

    if (!navigator.geolocation) {
      setGpsError("موقعیت‌یابی در این دستگاه پشتیبانی نمی‌شود.");
      return () => { cancelled = true; };
    }
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const coords = position.coords;
        void publish(coords.latitude, coords.longitude,
          Number.isFinite(coords.accuracy) ? coords.accuracy : null,
          Number.isFinite(coords.heading) ? coords.heading : null,
          Number.isFinite(coords.speed) ? coords.speed : null);
      },
      (error) => setGpsError(error.code === error.PERMISSION_DENIED
        ? "اجازه GPS داده نشده؛ دسترسی مکان را فعال کنید."
        : "دریافت موقعیت GPS ممکن نشد."),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [trackingActive, rideId, userId, cache]);

  if (!enabled) return null;
  const rows = locations.data ?? [];
  const pins = rows.map((row) => ({
    lat: row.latitude, lng: row.longitude,
    role: row.user_id === driverId ? "driver" as const : "passenger" as const,
    label: row.user_id === driverId ? "راننده" : "هم‌سفر",
  }));
  return <Card className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h3 className="font-bold">اشتراک موقعیت زنده گروه</h3>
        <p className="text-xs text-muted-foreground">فقط پس از شروع سفر و با انتخاب شما فعال می‌شود.</p>
      </div>
      <Btn variant={sharingEnabled ? "ghost" : "primary"} disabled={!consentLoaded} onClick={toggleSharing}>
        {sharingEnabled ? "توقف اشتراک" : "فعال‌سازی"}
      </Btn>
    </div>
    {trackingActive && <>
      {gpsError && <div role="status" className="space-y-2 text-sm text-destructive">
        <p>{gpsError}</p>
        {Capacitor.getPlatform() === "android" && <Btn variant="ghost" onClick={() => void BackgroundGeolocation.openSettings()}>تنظیمات دسترسی برنامه</Btn>}
      </div>}
      {locations.error && <p role="alert" className="text-sm text-destructive">دریافت موقعیت اعضای گروه ممکن نشد.</p>}
      <RouteMap origin={null} destination={null} route={null} liveLocations={pins} readOnly onPick={() => undefined} />
      {rows.length ? <div className="space-y-2">
        {rows.map((row) => <div key={row.user_id} className="flex justify-between gap-3 border-t pt-2 text-sm">
          <b>{row.user_id === driverId ? "راننده" : row.user_id === userId ? "موقعیت شما" : "هم‌سفر"}</b>
          <span className="text-xs text-muted-foreground">آخرین ارسال: {new Date(row.updated_at).toLocaleTimeString("fa-IR")}</span>
        </div>)}
      </div> : <p className="text-sm text-muted-foreground">در انتظار دریافت موقعیت اعضای گروه…</p>}
      <p className="text-xs text-muted-foreground">{Capacitor.getPlatform() === "android" ? "در اندروید، GPS با اعلان دائمی در پس‌زمینه فعال می‌ماند؛ توقف اجباری برنامه می‌تواند ردیابی را متوقف کند." : "در نسخه وب، اشتراک موقعیت فقط هنگام باز بودن صفحه گروه و فعال بودن GPS ادامه دارد."}</p>
    </>}
  </Card>;
}
