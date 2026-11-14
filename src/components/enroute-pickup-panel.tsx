import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Btn, Card, Badge } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { neshanRoute } from "@/lib/neshan.functions";
import type { Point } from "@/lib/geo";
import { toman, fa } from "@/lib/fare";

type Candidate = {
  id: string; passengerName: string; origin: string; destination: string;
  originLat: number; originLng: number; destinationLat: number; destinationLng: number;
  departureAt: string; km: number; fare: number;
};
type Active = {
  id: string; secondaryTripId: string; passengerName: string; origin: string; destination: string;
  detourKm: number; detourMinutes: number; state: "accepted" | "ongoing";
};
type Snapshot = { location: (Point & { updatedAt: string }) | null; active: Active | null; candidates: Candidate[] };
type Evaluated = Candidate & { detourKm: number; detourMinutes: number; totalKm: number };

export function EnroutePickupPanel({ tripId, status }: { tripId: string; status: string }) {
  const nav = useNavigate();
  const cache = useQueryClient();
  const parent = useQuery({
    queryKey: ["enroute-parent", tripId],
    enabled: status === "done" || status === "accepted",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("driver_enroute_parent" as never, { p_secondary_trip: tripId } as never);
      if (error) throw error;
      return data as string | null;
    },
  });
  const snapshot = useQuery({
    queryKey: ["enroute-candidates", tripId],
    enabled: status === "accepted",
    refetchInterval: 15000,
    refetchOnWindowFocus: "always",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("driver_enroute_candidates" as never, { p_primary_trip: tripId } as never);
      if (error) throw error;
      return data as unknown as Snapshot;
    },
  });
  const location = snapshot.data?.location;
  const candidates = snapshot.data?.candidates ?? [];
  const evaluated = useQuery({
    queryKey: ["enroute-route-evaluation", tripId, location?.lat, location?.lng, candidates.map((c) => c.id).join(",")],
    enabled: !!location && candidates.length > 0 && !snapshot.data?.active,
    staleTime: 12000,
    queryFn: async () => {
      const start = { lat: location!.lat, lng: location!.lng };
      const primary = await supabase.from("trips").select("origin_lat,origin_lng").eq("id", tripId).single();
      if (primary.error || primary.data.origin_lat == null || primary.data.origin_lng == null)
        throw new Error("مختصات مبدأ سفر اصلی در دسترس نیست.");
      const target = { lat: primary.data.origin_lat, lng: primary.data.origin_lng };
      const baseline = await neshanRoute({ data: { origin: start, destination: target } });
      if (!baseline.ok) throw new Error("مسیر اصلی با نشان محاسبه نشد.");
      const results = await Promise.all(candidates.slice(0, 12).map(async (candidate): Promise<Evaluated | null> => {
        const pickup = { lat: candidate.originLat, lng: candidate.originLng };
        const dropoff = { lat: candidate.destinationLat, lng: candidate.destinationLng };
        const [a, b, c] = await Promise.all([
          neshanRoute({ data: { origin: start, destination: pickup } }),
          neshanRoute({ data: { origin: pickup, destination: dropoff } }),
          neshanRoute({ data: { origin: dropoff, destination: target } }),
        ]);
        if (!a.ok || !b.ok || !c.ok) return null;
        const totalKm = a.distanceKm + b.distanceKm + c.distanceKm;
        const detourKm = Math.max(0, Math.round((totalKm - baseline.distanceKm) * 100) / 100);
        const detourMinutes = Math.max(1, a.durationMinutes + b.durationMinutes + c.durationMinutes - baseline.durationMinutes);
        return { ...candidate, detourKm, detourMinutes, totalKm };
      }));
      return results.filter((x): x is Evaluated => !!x && x.detourKm <= 7).sort((a, b) => a.detourKm - b.detourKm);
    },
  });
  const accept = async (candidate: Evaluated) => {
    try {
      const { error } = await supabase.rpc("accept_enroute_trip" as never, {
        p_primary_trip: tripId,
        p_secondary_trip: candidate.id,
        p_detour_km: candidate.detourKm,
        p_detour_minutes: candidate.detourMinutes,
      } as never);
      if (error) throw error;
      await cache.invalidateQueries({ queryKey: ["trips"] });
      await cache.invalidateQueries({ queryKey: ["enroute-candidates", tripId] });
      toast.success("مسافر بین‌راهی پذیرفته شد. ابتدا همین مسافر را جابه‌جا کنید.");
      await nav({ to: "/trip/$id", params: { id: candidate.id }, search: { as: "driver" } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "پذیرش مسافر بین‌راهی انجام نشد");
      await cache.invalidateQueries({ queryKey: ["trips"] });
      await cache.invalidateQueries({ queryKey: ["enroute-candidates", tripId] });
    }
  };

  if ((status === "done" || status === "accepted") && parent.data) {
    return <Card className="space-y-2">
      <Badge tone="primary">{status === "done" ? "سفر بین‌راهی پایان یافت" : "مسافر بین‌راهی"}</Badge>
      <p className="text-sm">{status === "done" ? "اکنون می‌توانید به سفر اختصاصی اصلی برگردید و حرکت به‌سمت مسافر اصلی را ادامه دهید." : "ابتدا همین مسافر را به مقصد برسانید؛ سپس به سفر اختصاصی اصلی برگردید. پذیرش مسافر دیگری تا آن زمان غیرفعال است."}</p>
      <Link className="text-primary font-bold" to="/trip/$id" params={{ id: parent.data }} search={{ as: "driver" }}>بازگشت به سفر اصلی</Link>
    </Card>;
  }
  if (status !== "accepted") return null;
  return <Card className="space-y-3">
    <div className="flex items-center justify-between gap-2">
      <b>مسافرگیری متوالی در مسیر</b>
      <Badge tone="primary">سفر اختصاصی</Badge>
    </div>
    <p className="text-sm text-muted-foreground">در راه رسیدن به مسافر اصلی، می‌توانید یک درخواست دیگر را بررسی کنید. این دو مسافر هم‌زمان در خودرو نخواهند بود.</p>
    {snapshot.isLoading && <p className="text-sm">در حال دریافت موقعیت و درخواست‌ها…</p>}
    {snapshot.error && <p role="alert" className="text-sm text-destructive">{snapshot.error.message}</p>}
    {!snapshot.data?.location && !snapshot.isLoading && <p className="text-sm text-muted-foreground">برای نمایش درخواست‌های هم‌مسیر، موقعیت زنده راننده باید فعال و تازه باشد.</p>}
    {snapshot.data?.active && <div className="rounded-xl bg-muted p-3 space-y-2">
      <b>مسافر بین‌راهی فعال: {snapshot.data.active.passengerName}</b>
      <p className="text-sm">{snapshot.data.active.origin} ← {snapshot.data.active.destination}</p>
      <p className="text-sm">انحراف مسیر: {Number(snapshot.data.active.detourKm).toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} کیلومتر · زمان اضافه: {fa(snapshot.data.active.detourMinutes)} دقیقه</p>
      <Link className="text-primary font-bold" to="/trip/$id" params={{ id: snapshot.data.active.secondaryTripId }} search={{ as: "driver" }}>رفتن به سفر مسافر بین‌راهی</Link>
      <p className="text-xs text-muted-foreground">تا پایان این سفر، شروع سفر اصلی قفل است.</p>
    </div>}
    {!snapshot.data?.active && evaluated.isFetching && <p className="text-sm">در حال محاسبه مسیرهای جاده‌ای با نشان…</p>}
    {!snapshot.data?.active && evaluated.error && <p role="alert" className="text-sm text-destructive">{evaluated.error.message}</p>}
    {!snapshot.data?.active && evaluated.data?.map((candidate) => (
      <div key={candidate.id} className="rounded-xl border border-border p-3 space-y-2">
        <div className="flex items-center justify-between gap-2"><b>{candidate.passengerName}</b><Badge tone="primary">هم‌مسیر</Badge></div>
        <p className="text-sm">{candidate.origin} ← {candidate.destination}</p>
        <p className="text-sm">انحراف اضافه: <b>{candidate.detourKm.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} کیلومتر</b> · زمان اضافه: {fa(candidate.detourMinutes)} دقیقه</p>
        <p className="text-sm">کرایه سفر دوم: {toman(candidate.fare)}</p>
        <Btn onClick={() => void accept(candidate)}>پذیرش مسافر بین‌راهی</Btn>
      </div>
    ))}
    {!snapshot.data?.active && !evaluated.isFetching && evaluated.data?.length === 0 && <p className="text-sm text-muted-foreground">درخواست مناسبی با انحراف حداکثر ۷ کیلومتر پیدا نشد.</p>}
    <p className="text-xs text-muted-foreground">مسافر اصلی رضایت جداگانه نمی‌دهد؛ مسافر دوم پیش از سوارشدن سفر اختصاصی خودش را دارد. پذیرش فقط یک مسافر بین‌راهی در هر نوبت ممکن است.</p>
  </Card>;
}
