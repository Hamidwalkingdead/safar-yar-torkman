import { createClient } from "npm:@supabase/supabase-js@2";
import { authenticate } from "../_shared/auth.ts";
import { allowRequest } from "../_shared/rate-limit.ts";
import { json, preflight } from "../_shared/http.ts";

type Point = { lat: number; lng: number };
type Direction = { routes?: { legs?: { distance?: { value?: number }; duration?: { value?: number } }[] }[] };

async function route(a: Point, b: Point, key: string): Promise<{ meters: number; seconds: number } | null> {
  const params = new URLSearchParams({ type: "car", origin: `${a.lat},${a.lng}`, destination: `${b.lat},${b.lng}` });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`https://api.neshan.org/v4/direction?${params}`, {
      headers: { "Api-Key": key }, signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json() as Direction;
    const legs = data.routes?.[0]?.legs ?? [];
    const meters = legs.reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0);
    const seconds = legs.reduce((sum, leg) => sum + (leg.duration?.value ?? 0), 0);
    return meters > 0 && seconds > 0 ? { meters, seconds } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    const auth = await authenticate(request);
    if (!auth) return json({ error: "برای پذیرش مسافر بین‌راهی وارد حساب شوید." }, 401);
    if (!(await allowRequest(auth.client, "enroute-pickup", 8)))
      return json({ error: "تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید." }, 429);
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
    if (!body || typeof body !== "object") return json({ error: "درخواست نامعتبر است." }, 400);
    const input = body as { primaryTripId?: unknown; secondaryTripId?: unknown };
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (typeof input.primaryTripId !== "string" || !uuid.test(input.primaryTripId)
      || typeof input.secondaryTripId !== "string" || !uuid.test(input.secondaryTripId)
      || input.primaryTripId === input.secondaryTripId) {
      return json({ error: "شناسه سفر نامعتبر است." }, 400);
    }
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const neshanKey = Deno.env.get("NESHAN_SERVICE_KEY");
    if (!url || !serviceKey || !neshanKey) return json({ error: "تنظیمات امن مسیریابی روی سرور کامل نیست." }, 503);
    const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const [primaryResult, secondaryResult, locationResult] = await Promise.all([
      service.from("trips").select("id,driver_id,status,origin_lat,origin_lng").eq("id", input.primaryTripId).maybeSingle(),
      service.from("trips").select("id,passenger_id,status,departure_at,origin_lat,origin_lng,destination_lat,destination_lng").eq("id", input.secondaryTripId).maybeSingle(),
      service.from("trip_locations").select("latitude,longitude,updated_at").eq("trip_id", input.primaryTripId).eq("user_id", auth.userId).maybeSingle(),
    ]);
    if (primaryResult.error || secondaryResult.error || locationResult.error)
      return json({ error: "اطلاعات سفر یا موقعیت راننده دریافت نشد." }, 502);
    const primary = primaryResult.data;
    const secondary = secondaryResult.data;
    const location = locationResult.data;
    if (!primary || primary.driver_id !== auth.userId || primary.status !== "accepted"
      || primary.origin_lat == null || primary.origin_lng == null)
      return json({ error: "سفر اصلی در وضعیت مجاز نیست." }, 409);
    if (!secondary || secondary.status !== "pending" || secondary.passenger_id === auth.userId
      || new Date(secondary.departure_at).getTime() <= Date.now()
      || secondary.origin_lat == null || secondary.origin_lng == null
      || secondary.destination_lat == null || secondary.destination_lng == null)
      return json({ error: "درخواست مسافر بین‌راهی دیگر در دسترس نیست." }, 409);
    if (!location || Date.now() - new Date(location.updated_at).getTime() > 10 * 60 * 1000)
      return json({ error: "موقعیت زنده راننده تازه نیست؛ ابتدا موقعیت‌یابی را فعال کنید." }, 409);

    const start = { lat: location.latitude, lng: location.longitude };
    const primaryPickup = { lat: primary.origin_lat, lng: primary.origin_lng };
    const secondaryPickup = { lat: secondary.origin_lat, lng: secondary.origin_lng };
    const secondaryDropoff = { lat: secondary.destination_lat, lng: secondary.destination_lng };
    const [baseline, firstLeg, secondLeg, thirdLeg] = await Promise.all([
      route(start, primaryPickup, neshanKey),
      route(start, secondaryPickup, neshanKey),
      route(secondaryPickup, secondaryDropoff, neshanKey),
      route(secondaryDropoff, primaryPickup, neshanKey),
    ]);
    if (!baseline || !firstLeg || !secondLeg || !thirdLeg)
      return json({ error: "نشان نتوانست همه مسیرهای جاده‌ای را محاسبه کند؛ پذیرش انجام نشد." }, 422);
    const totalMeters = firstLeg.meters + secondLeg.meters + thirdLeg.meters;
    const detourKm = Math.max(0, Math.round(((totalMeters - baseline.meters) / 1000) * 100) / 100);
    if (detourKm > 7)
      return json({ error: `انحراف این درخواست ${detourKm.toLocaleString("fa-IR")} کیلومتر است و از سقف ۷ کیلومتر بیشتر می‌شود.` }, 422);
    const totalSeconds = firstLeg.seconds + secondLeg.seconds + thirdLeg.seconds;
    const detourMinutes = Math.max(1, Math.ceil((totalSeconds - baseline.seconds) / 60));
    if (detourMinutes > 600) return json({ error: "زمان اضافه این مسیر بیش از حد مجاز است." }, 422);

    const { data: linkId, error } = await service.rpc("accept_enroute_trip_verified", {
      p_driver_id: auth.userId,
      p_primary_trip: input.primaryTripId,
      p_secondary_trip: input.secondaryTripId,
      p_detour_km: detourKm,
      p_detour_minutes: detourMinutes,
    });
    if (error) return json({ error: error.message || "پذیرش مسافر بین‌راهی انجام نشد." }, 409);
    return json({ success: true, linkId, detourKm, detourMinutes });
  } catch (error) {
    console.error("enroute-pickup failed", error);
    return json({ error: "خطای سرور هنگام بررسی مسافر بین‌راهی رخ داد." }, 500);
  }
});
