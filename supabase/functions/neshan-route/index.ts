import { authenticate } from "../_shared/auth.ts";
import { json, preflight } from "../_shared/http.ts";
import { parseRouteInput } from "../_shared/validation.ts";

type DirectionResponse = {
  routes?: {
    overview_polyline?: { points?: string };
    legs?: { distance?: { value?: number }; duration?: { value?: number } }[];
  }[];
};

function decodePolyline(encoded: string) {
  const points: { lat: number; lng: number }[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let result = 0, shift = 0, byte: number;
    do {
      if (index >= encoded.length) return [];
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    result = 0; shift = 0;
    do {
      if (index >= encoded.length) return [];
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
    if (points.length > 20000) return [];
  }
  return points;
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    const auth = await authenticate(request);
    if (!auth) return json({ error: "برای مشاهده مسیر وارد حساب شوید." }, 401);
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
    const input = parseRouteInput(body);
    if (!input) return json({ error: "مختصات مبدأ یا مقصد معتبر نیست." }, 400);
    const key = Deno.env.get("NESHAN_SERVICE_KEY");
    if (!key) return json({ ok: false, reason: "missing_key" }, 503);

    const query = new URLSearchParams({
      type: "car",
      origin: `${input.origin.lat},${input.origin.lng}`,
      destination: `${input.destination.lat},${input.destination.lng}`,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let response: Response;
    try {
      response = await fetch(`https://api.neshan.org/v4/direction?${query}`, {
        headers: { "Api-Key": key },
        signal: controller.signal,
      });
    } catch {
      return json({ ok: false, reason: "failed" }, 502);
    } finally { clearTimeout(timeout); }
    if (!response.ok) return json({ ok: false, reason: "failed" }, 502);

    const payload = await response.json() as DirectionResponse;
    const route = payload.routes?.[0];
    const legs = route?.legs ?? [];
    const meters = legs.reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0);
    const seconds = legs.reduce((sum, leg) => sum + (leg.duration?.value ?? 0), 0);
    if (!route || meters <= 0 || seconds <= 0) return json({ ok: false, reason: "no_route" }, 422);
    const encoded = route.overview_polyline?.points ?? "";
    return json({
      ok: true,
      distanceKm: Math.max(1, Math.round(meters / 1000)),
      durationMinutes: Math.max(1, Math.round(seconds / 60)),
      geometry: encoded ? decodePolyline(encoded) : [],
    });
  } catch (error) {
    console.error("neshan-route failed", error);
    return json({ error: "خطا در دریافت مسیر جاده‌ای." }, 500);
  }
});
