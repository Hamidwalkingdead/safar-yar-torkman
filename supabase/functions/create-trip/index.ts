import { authenticate } from "../_shared/auth.ts";
import { allowRequest } from "../_shared/rate-limit.ts";
import { json, preflight } from "../_shared/http.ts";
import { parseCreateTripInput } from "../_shared/validation.ts";

type RouteMetrics = { meters: number; seconds: number };
type MapIrRouteResponse = {
  code?: string;
  routes?: Array<{ distance?: number; duration?: number }>;
};

async function fetchMapIrRoute(origin: { lat: number; lng: number }, destination: { lat: number; lng: number }): Promise<RouteMetrics | null> {
  const key = Deno.env.get("MAPIR_API_KEY")?.trim();
  if (!key) return null;

  const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const params = new URLSearchParams({
    alternatives: "false",
    steps: "false",
    overview: "false",
    geometries: "polyline6",
  });
  try {
    const response = await fetch(`https://map.ir/routes/route/v1/driving/${coordinates}?${params}`, {
      headers: { "x-api-key": key, "Mapir-SDK": "reactjs" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as MapIrRouteResponse;
    const route = payload.routes?.[0];
    const meters = Number(route?.distance);
    const seconds = Number(route?.duration);
    if (!["ok", "Ok"].includes(payload.code || "") || !Number.isFinite(meters) || meters <= 0 || !Number.isFinite(seconds) || seconds <= 0) return null;
    return { meters, seconds };
  } catch {
    return null;
  }
}

type BaladRouteResponse = {
  code?: string;
  routes?: Array<{ distance?: number; duration?: number }>;
};

async function fetchBaladRoute(origin: { lat: number; lng: number }, destination: { lat: number; lng: number }): Promise<RouteMetrics | null> {
  const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = `https://direction.raah.ir/navigation-v7/directions/v5/mapbox/driving-traffic/${coordinates}`;
  try {
    const response = await fetch(url, {
      headers: {
        "Origin": "https://balad.ir",
        "Referer": "https://balad.ir/",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as BaladRouteResponse;
    const route = payload.code === "Ok" ? payload.routes?.[0] : undefined;
    const meters = Number(route?.distance);
    const seconds = Number(route?.duration);
    if (!Number.isFinite(meters) || meters <= 0 || !Number.isFinite(seconds) || seconds <= 0) return null;
    return { meters, seconds };
  } catch {
    return null;
  }
}

async function resolveDrivingRoute(origin: { lat: number; lng: number }, destination: { lat: number; lng: number }): Promise<RouteMetrics | null> {
  // Map.ir is the primary routing provider; Balad is the automatic fallback.
  return await fetchMapIrRoute(origin, destination) ?? await fetchBaladRoute(origin, destination);
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  try {
    const auth = await authenticate(request);
    if (!auth) return json({ error: "برای ثبت سفر ابتدا وارد حساب شوید." }, 401);
    if (!(await allowRequest(auth.client, "create-trip", 3)))
      return json({ error: "تعداد درخواست‌ها زیاد است؛ یک دقیقه دیگر دوباره تلاش کنید." }, 429);

    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
    const input = parseCreateTripInput(body);
    if (!input) return json({ error: "اطلاعات مبدأ، مقصد، زمان یا پرداخت معتبر نیست." }, 400);

    const route = await resolveDrivingRoute(input.origin, input.destination);
    if (!route) return json({ error: "مسیر‌یابی Map.ir و بلد در دسترس نیست؛ سفر ثبت نشد. کمی بعد دوباره تلاش کنید." }, 502);

    const distanceKm = Math.max(1, Math.round(route.meters / 1000));
    if (distanceKm > 3000) return json({ error: "مسافت این مسیر از محدوده مجاز بیشتر است." }, 422);

    const { data: tripId, error } = await auth.client.rpc("create_trip", {
      p_origin: input.originName,
      p_destination: input.destinationName,
      p_departure: input.departure,
      p_km: distanceKm,
      p_night: false,
      p_mountain: input.mountain,
      p_origin_lat: input.origin.lat,
      p_origin_lng: input.origin.lng,
      p_destination_lat: input.destination.lat,
      p_destination_lng: input.destination.lng,
      p_suggested: input.suggested,
      p_payment_method: input.paymentMethod,
      p_ride_type: input.rideType,
    });
    if (error) return json({ error: error.message || "ثبت سفر در پایگاه داده انجام نشد." }, 400);
    if (!tripId) return json({ error: "شناسه سفر از پایگاه داده دریافت نشد." }, 500);

    return json({
      id: tripId,
      distanceKm,
      durationMinutes: Math.max(1, Math.round(route.seconds / 60)),
    });
  } catch (error) {
    console.error("create-trip failed", error);
    return json({ error: "خطای سرور هنگام ثبت سفر رخ داد." }, 500);
  }
});
