import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { RouteMap, type Place } from "@/components/route-map";
import type { Point } from "@/lib/geo";

type SharedTrip = {
  status: "accepted" | "ongoing";
  origin: string;
  destination: string;
  origin_lat: number | null;
  origin_lng: number | null;
  destination_lat: number | null;
  destination_lng: number | null;
  driver_lat: number | null;
  driver_lng: number | null;
  location_updated_at: string | null;
};

export const Route = createFileRoute("/track/$token")({
  head: () => ({
    meta: [
      { title: "موقعیت زنده سفر | سفر یار ترکمن" },
      { name: "description", content: "مشاهده موقعیت زنده سفر به‌صورت امن و با لینک اشتراک‌گذاری." },
    ],
  }),
  component: SharedTripTracking,
});

function SharedTripTracking() {
  const { token } = Route.useParams();
  const trip = useQuery({
    queryKey: ["public-trip-share", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_trip_share", { p_token: token });
      if (error) throw error;
      return (data ?? null) as SharedTrip | null;
    },
    refetchInterval: 5000,
    retry: 1,
  });
  const data = trip.data;
  const origin: Place | null = data?.origin_lat != null && data.origin_lng != null
    ? { lat: data.origin_lat, lng: data.origin_lng, name: data.origin }
    : null;
  const destination: Place | null = data?.destination_lat != null && data.destination_lng != null
    ? { lat: data.destination_lat, lng: data.destination_lng, name: data.destination }
    : null;
  const liveLocations = data?.driver_lat != null && data.driver_lng != null
    ? [{ lat: data.driver_lat, lng: data.driver_lng, role: "driver" as const, label: "موقعیت زنده راننده" }]
    : [];

  return (
    <main className="shared-dashboard mx-auto min-h-screen max-w-xl space-y-4 p-4 pb-10">
      <header className="space-y-1 text-center">
        <h1 className="text-xl font-black">موقعیت زنده سفر</h1>
        <p className="text-sm text-muted-foreground">سفر یار ترکمن</p>
      </header>
      {trip.isLoading && <p className="rounded-xl bg-muted p-4 text-center">در حال دریافت موقعیت سفر…</p>}
      {trip.error && <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm">دریافت موقعیت ممکن نشد؛ اتصال اینترنت را بررسی کنید.</p>}
      {trip.data === null && !trip.isLoading && !trip.error && (
        <section className="rounded-2xl border border-border p-5 text-center">
          <h2 className="font-bold">این لینک دیگر فعال نیست</h2>
          <p className="mt-2 text-sm text-muted-foreground">سفر پایان یافته، لغو شده یا اعتبار لینک به پایان رسیده است.</p>
        </section>
      )}
      {data && (
        <>
          <section className="rounded-2xl border border-border p-4">
            <p className="text-sm"><b>مبدأ:</b> {data.origin}</p>
            <p className="mt-2 text-sm"><b>مقصد:</b> {data.destination}</p>
            <p className="mt-3 text-sm font-bold text-green-600">{data.status === "ongoing" ? "سفر در حال انجام است" : "راننده در مسیر مبدأ است"}</p>
            {data.location_updated_at && (
              <p className="mt-1 text-xs text-muted-foreground">آخرین به‌روزرسانی: {new Date(data.location_updated_at).toLocaleTimeString("fa-IR")}</p>
            )}
          </section>
          <RouteMap origin={origin} destination={destination} liveLocations={liveLocations} readOnly />
          {liveLocations.length === 0 && <p className="text-center text-sm text-muted-foreground">هنوز موقعیت راننده دریافت نشده است؛ نقشه هر ۵ ثانیه به‌روزرسانی می‌شود.</p>}
          <p className="text-center text-xs text-muted-foreground">این لینک فقط موقعیت زنده و مسیر همین سفر را نشان می‌دهد و اطلاعات تماس یا مشخصات شخصی را نمایش نمی‌دهد.</p>
        </>
      )}
    </main>
  );
}
