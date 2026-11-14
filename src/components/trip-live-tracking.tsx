import type { SupabaseClient } from "@supabase/supabase-js";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { BackgroundGeolocation } from "@/lib/background-geolocation";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Btn, Card } from "@/components/ui-kit";
import { RouteMap, type Place } from "@/components/route-map";
import type { Point } from "@/lib/geo";


type NativeLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  bearing: number | null;
  speed: number | null;
  time: number | null;
};

async function nativeUpsertLocation(tripId: string, userId: string, location: NativeLocation) {
  const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, "");
  const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !apiKey) throw new Error("تنظیمات ارتباط با سرور کامل نیست.");

  let { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("نشست کاربری منقضی شده است؛ دوباره وارد شوید.");
  const headers = {
    apikey: apiKey,
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  };
  const request = () => CapacitorHttp.request({
    url: `${url}/rest/v1/trip_locations?on_conflict=trip_id,user_id`,
    method: "POST",
    headers,
    data: {
      trip_id: tripId,
      user_id: userId,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy_m: Number.isFinite(location.accuracy) ? location.accuracy : null,
      heading_deg: Number.isFinite(location.bearing) ? location.bearing : null,
      speed_mps: Number.isFinite(location.speed) ? location.speed : null,
      updated_at: new Date(location.time ?? Date.now()).toISOString(),
    },
  });
  let response = await request();
  if (response.status === 401 && session.refresh_token) {
    const refreshed = await CapacitorHttp.request({
      url: `${url}/auth/v1/token?grant_type=refresh_token`,
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      data: { refresh_token: session.refresh_token },
    });
    const tokens = refreshed.data as { access_token?: string; refresh_token?: string };
    if (refreshed.status >= 200 && refreshed.status < 300 && tokens.access_token && tokens.refresh_token) {
      const updated = await supabase.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
      if (updated.error) throw updated.error;
      if (!updated.data.session) throw new Error("نشست کاربری تازه‌سازی نشد.");
      session = updated.data.session;
      headers.Authorization = `Bearer ${session.access_token}`;
      response = await request();
    }
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`ثبت موقعیت در سرور انجام نشد (HTTP ${response.status}).`);
  }
}

// trip_locations stores one current point per participant, so the offline queue deliberately keeps only the newest unsent point (not a full breadcrumb history).
async function sendNativeLocationWithQueue(tripId: string, userId: string, location: NativeLocation) {
  const key = `safar-yar-location:${tripId}:${userId}`;
  const raw = localStorage.getItem(key);
  if (raw) {
    try {
      const pending = JSON.parse(raw) as NativeLocation;
      if (pending.time !== null && Date.now() - pending.time < 120_000) await nativeUpsertLocation(tripId, userId, pending);
    } catch {
      // Keep the newest point below; an older queued point is not useful after a long outage.
    }
  }
  try {
    await nativeUpsertLocation(tripId, userId, location);
    localStorage.removeItem(key);
  } catch (error) {
    localStorage.setItem(key, JSON.stringify(location));
    throw error;
  }
}

type LiveLocation = {
  trip_id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  heading_deg: number | null;
  speed_mps: number | null;
  updated_at: string;
};

// trip_locations comes from a migration not yet in the generated types.
const untypedDb = supabase as unknown as SupabaseClient;

export function TripLiveTracking({
  tripId,
  userId,
  passengerId,
  driverId,
  status,
  origin,
  destination,
  route,
  trackingEnabled = true,
  renderUI = true,
}: {
  tripId: string;
  userId: string;
  passengerId: string;
  driverId: string | null;
  status: string;
  origin: Place | null;
  destination: Place | null;
  route: Point[] | null;
  trackingEnabled?: boolean;
  renderUI?: boolean;
}) {
  const cache = useQueryClient();
  const lastSentAt = useRef(0);
  const [gpsError, setGpsError] = useState("");
  const active = status === "accepted" || status === "ongoing";
  const trackingActive = active || (status === "pending" && userId === passengerId);
  useEffect(() => {
    if (!trackingActive) localStorage.removeItem(`safar-yar-location:${tripId}:${userId}`);
  }, [trackingActive, tripId, userId]);
  const locations = useQuery({
    queryKey: ["trip-live-locations", tripId, userId],
    enabled: renderUI && trackingActive,
    queryFn: async () => {
      const { data, error } = await untypedDb
        .from("trip_locations")
        .select("trip_id,user_id,latitude,longitude,accuracy_m,heading_deg,speed_mps,updated_at")
        .eq("trip_id", tripId);
      if (error) throw error;
      return (data ?? []) as LiveLocation[];
    },
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!trackingEnabled || !trackingActive || (userId !== passengerId && userId !== driverId)) return;

    if (Capacitor.getPlatform() === "android") {
      let cancelled = false;
      let watcherId: string | undefined;
      const startBackgroundWatcher = async () => {
        let permission = await LocalNotifications.checkPermissions();
        if (permission.display !== "granted") permission = await LocalNotifications.requestPermissions();
        if (permission.display !== "granted") {
          setGpsError("برای ردیابی در پس‌زمینه، اجازه اعلان دائمی را فعال کنید.");
          return;
        }
        const raw = localStorage.getItem(`safar-yar-location:${tripId}:${userId}`);
        if (raw) {
          try {
            const pending = JSON.parse(raw) as NativeLocation;
            if (Date.now() - pending.time < 120_000) {
              await nativeUpsertLocation(tripId, userId, pending);
              localStorage.removeItem(`safar-yar-location:${tripId}:${userId}`);
            }
          } catch {
            // A new GPS point will replace an expired or unsent point.
          }
        }
        const id = await BackgroundGeolocation.addWatcher(
          {
            backgroundTitle: "سفر یار ترکمن",
            backgroundMessage: "موقعیت شما فقط برای سفر فعال با راننده یا مسافر همان سفر به اشتراک گذاشته می‌شود.",
            requestPermissions: true,
            stale: false,
            distanceFilter: 0,
          },
          (location, error) => {
            if (cancelled) return;
            if (error) {
              setGpsError(error.message || "سرویس GPS پس‌زمینه با خطا روبه‌رو شد.");
              return;
            }
            if (!location || cancelled) return;
            const now = Date.now();
            if (now - lastSentAt.current < 8000) return;
            lastSentAt.current = now;
            const point: NativeLocation = {
              latitude: location.latitude,
              longitude: location.longitude,
              accuracy: location.accuracy,
              bearing: location.bearing,
              speed: location.speed,
              time: location.time,
            };
            void sendNativeLocationWithQueue(tripId, userId, point)
              .then(() => {
                setGpsError("");
                void cache.invalidateQueries({ queryKey: ["trip-live-locations", tripId] });
              })
              .catch(() => setGpsError("ارسال موقعیت پس‌زمینه انجام نشد؛ آخرین موقعیت ذخیره و دوباره تلاش می‌شود."));
          },
        );
        if (cancelled) {
          await BackgroundGeolocation.removeWatcher({ id });
        } else {
          watcherId = id;
          setGpsError("");
        }
      };
      void startBackgroundWatcher().catch((error) => {
        setGpsError(error instanceof Error ? error.message : "راه‌اندازی ردیابی پس‌زمینه ناموفق بود.");
      });
      return () => {
        cancelled = true;
        if (watcherId) void BackgroundGeolocation.removeWatcher({ id: watcherId });
      };
    }

    if (!navigator.geolocation) {
      setGpsError("موقعیت‌یابی در این دستگاه پشتیبانی نمی‌شود.");
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const now = Date.now();
        if (now - lastSentAt.current < 8000) return;
        lastSentAt.current = now;
        setGpsError("");
        const { coords } = position;
        const { error } = await untypedDb.from("trip_locations").upsert(
          {
            trip_id: tripId,
            user_id: userId,
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy_m: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
            heading_deg: Number.isFinite(coords.heading) ? coords.heading : null,
            speed_mps: Number.isFinite(coords.speed) ? coords.speed : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "trip_id,user_id" },
        );
        if (error) setGpsError("ارسال موقعیت انجام نشد؛ اتصال اینترنت را بررسی کنید.");
        else void cache.invalidateQueries({ queryKey: ["trip-live-locations", tripId] });
      },
      (error) => {
        setGpsError(
          error.code === error.PERMISSION_DENIED
            ? "اجازه GPS داده نشده؛ برای اشتراک موقعیت، دسترسی مکان را فعال کنید."
            : "دریافت موقعیت GPS ممکن نشد؛ مکان‌یابی گوشی را بررسی کنید.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [trackingActive, trackingEnabled, tripId, userId, passengerId, driverId, cache]);

  useEffect(() => {
    if (!renderUI || !trackingActive) return;
    const channel = supabase
      .channel(`trip-location-${tripId}-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trip_locations", filter: `trip_id=eq.${tripId}` },
        () => void cache.invalidateQueries({ queryKey: ["trip-live-locations", tripId] }),
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [renderUI, trackingActive, tripId, userId, cache]);

  if (!trackingActive || !renderUI) return null;
  const rows = locations.data ?? [];
  const pins = rows.map((location) => ({
    lat: location.latitude,
    lng: location.longitude,
    role: location.user_id === driverId ? "driver" as const : "passenger" as const,
    label: location.user_id === driverId ? "راننده" : "مسافر",
  }));
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-bold">ردیابی زنده سفر</h2>
        <p className="text-xs text-muted-foreground">موقعیت فقط بین مسافر و راننده همین سفر به اشتراک گذاشته می‌شود.</p>
      </div>
      {gpsError && (
        <div role="status" className="space-y-2 text-sm text-destructive">
          <p>{gpsError}</p>
          {Capacitor.getPlatform() === "android" && (
            <Btn variant="ghost" onClick={() => void BackgroundGeolocation.openSettings()}>
              تنظیمات دسترسی برنامه
            </Btn>
          )}
        </div>
      )}
      {locations.error && <p role="alert" className="text-sm text-destructive">دریافت موقعیت طرف مقابل ممکن نشد.</p>}
      {(origin || destination || pins.length > 0) && (
        <RouteMap
          origin={origin}
          destination={destination}
          route={route}
          liveLocations={pins}
          readOnly
          onPick={() => undefined}
        />
      )}
      {pins.length > 0 ? (
        <div className="space-y-2">
          {rows.map((location) => (
            <div key={location.user_id} className="flex justify-between gap-3 border-t pt-2 text-sm">
              <span className="font-bold">{location.user_id === driverId ? "راننده" : "مسافر"}</span>
              <span className="text-left text-xs text-muted-foreground">
                آخرین به‌روزرسانی: {new Date(location.updated_at).toLocaleTimeString("fa-IR")}
                {location.accuracy_m !== null ? ` · دقت ${Math.round(location.accuracy_m)} متر` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">در انتظار دریافت GPS طرفین سفر… صفحه سفر را باز نگه دارید و اجازه موقعیت مکانی را فعال کنید.</p>
      )}
      <p className="text-xs text-muted-foreground">{Capacitor.getPlatform() === "android" ? "در اندروید، ردیابی با اعلان دائمی و ارسال حداکثر هر ۸ ثانیه در پس‌زمینه ادامه می‌یابد. برای پایداری، محدودیت باتری برنامه را روی بدون محدودیت بگذارید؛ توقف اجباری ممکن است ردیابی را متوقف کند." : "در نسخه وب، ارسال موقعیت فقط هنگام باز بودن صفحه سفر و فعال بودن GPS انجام می‌شود."}</p>
    </Card>
  );
}
