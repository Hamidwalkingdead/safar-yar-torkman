import { authenticate } from "../_shared/auth.ts";
import { allowRequest } from "../_shared/rate-limit.ts";
import { json, preflight } from "../_shared/http.ts";
import { parseRouteInput } from "../_shared/validation.ts";

function decodePolyline6(encoded: string) {
  const points: { lat: number; lng: number }[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length && points.length < 20000) {
    const deltas: number[] = [];
    for (let axis = 0; axis < 2; axis++) {
      let result = 0, shift = 0, byte: number;
      do {
        if (index >= encoded.length) return [];
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
        if (shift > 30) return [];
      } while (byte >= 0x20);
      deltas.push((result & 1) ? ~(result >> 1) : (result >> 1));
    }
    lat += deltas[0]; lng += deltas[1];
    points.push({ lat: lat / 1e6, lng: lng / 1e6 });
  }
  return points;
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    const auth = await authenticate(request);
    if (!auth) return json({ error: "برای مشاهده مسیر وارد حساب شوید." }, 401);
    if (!(await allowRequest(auth.client, "neshan-route", 30)))
      return json({ error: "تعداد درخواست‌ها زیاد است؛ یک دقیقه دیگر دوباره تلاش کنید." }, 429);
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
    const input = parseRouteInput(body);
    if (!input) return json({ error: "مختصات مبدأ یا مقصد معتبر نیست." }, 400);

    const coordinates = `${input.origin.lng},${input.origin.lat};${input.destination.lng},${input.destination.lat}`;
    const url = `https://direction.raah.ir/navigation-v7/directions/v5/mapbox/driving-traffic/${coordinates}`;
    const response = await fetch(url, {
      headers: {
        "Origin": "https://balad.ir", "Referer": "https://balad.ir/",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error("Balad driving route returned HTTP", response.status);
      return json({ ok: false, reason: "failed" }, 502);
    }
    const payload = await response.json() as {
      code?: string;
      routes?: Array<{ distance?: number; duration?: number; geometry?: string }>;
    };
    const route = payload.code === "Ok" ? payload.routes?.[0] : undefined;
    const meters = route?.distance ?? 0, seconds = route?.duration ?? 0;
    if (!route || !Number.isFinite(meters) || !Number.isFinite(seconds) || meters <= 0 || seconds <= 0)
      return json({ ok: false, reason: "no_route" }, 422);
    const geometry = typeof route.geometry === "string" ? decodePolyline6(route.geometry) : [];
    if (geometry.length < 2) return json({ ok: false, reason: "no_route" }, 422);
    return json({
      ok: true,
      distanceKm: Math.max(1, Math.round(meters / 1000)),
      durationMinutes: Math.max(1, Math.round(seconds / 60)),
      geometry,
    });
  } catch (error) {
    console.error("balad route failed", error);
    return json({ ok: false, reason: "failed" }, 502);
  }
});
