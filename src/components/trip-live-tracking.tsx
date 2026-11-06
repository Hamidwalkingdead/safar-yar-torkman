import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui-kit";
import { RouteMap } from "@/components/route-map";

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
}: {
  tripId: string;
  userId: string;
  passengerId: string;
  driverId: string | null;
  status: string;
}) {
  const cache = useQueryClient();
  const lastSentAt = useRef(0);
  const [gpsError, setGpsError] = useState("");
  const active = status === "accepted" || status === "ongoing";
  const locations = useQuery({
    queryKey: ["trip-live-locations", tripId],
    enabled: active,
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
    if (!active || (userId !== passengerId && userId !== driverId)) return;
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
  }, [active, tripId, userId, passengerId, driverId, cache]);

  useEffect(() => {
    if (!active) return;
    const channel = supabase
      .channel(`trip-location-${tripId}-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trip_locations", filter: `trip_id=eq.${tripId}` },
        () => void cache.invalidateQueries({ queryKey: ["trip-live-locations", tripId] }),
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [active, tripId, userId, cache]);

  if (!active) return null;
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
      {gpsError && <p role="status" className="text-sm text-destructive">{gpsError}</p>}
      {locations.error && <p role="alert" className="text-sm text-destructive">دریافت موقعیت طرف مقابل ممکن نشد.</p>}
      {pins.length > 0 ? (
        <>
          <RouteMap origin={null} destination={null} liveLocations={pins} readOnly onPick={() => undefined} />
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
        </>
      ) : (
        <p className="text-sm text-muted-foreground">در انتظار دریافت GPS طرفین سفر… صفحه سفر را باز نگه دارید و اجازه موقعیت مکانی را فعال کنید.</p>
      )}
      <p className="text-xs text-muted-foreground">ارسال موقعیت هنگام باز بودن صفحه سفر و فعال بودن GPS انجام می‌شود؛ محدودیت‌های باتری و پس‌زمینه گوشی ممکن است به‌روزرسانی را متوقف کنند.</p>
    </Card>
  );
}
