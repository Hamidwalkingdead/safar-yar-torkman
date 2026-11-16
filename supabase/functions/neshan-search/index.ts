import { authenticate } from "../_shared/auth.ts";
import { allowRequest } from "../_shared/rate-limit.ts";
import { json, preflight } from "../_shared/http.ts";
import { isPoint } from "../_shared/validation.ts";

type BaladSearchResponse = {
  results?: Array<{
    maintext?: string;
    subtext1?: string;
    center_point?: [number, number];
    geometry?: { type?: string; coordinates?: unknown };
  }>;
};

function searchView(lat: number, lng: number, radiusKm: number) {
  const dlat = radiusKm / 111.32;
  const dlng = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));
  const north = lat + dlat, south = lat - dlat;
  const west = lng - dlng, east = lng + dlng;
  const polygon = [[west,north],[east,north],[east,south],[west,south],[west,north]]
    .map(([x,y]) => `${x.toFixed(6)},${y.toFixed(6)}`).join("|");
  const zoom = radiusKm <= 0.5 ? 16 : radiusKm <= 1 ? 15 : radiusKm <= 2 ? 14 : radiusKm <= 5 ? 13 : radiusKm <= 10 ? 12 : 10;
  return { polygon, zoom: String(zoom), camera: `${lng.toFixed(6)},${lat.toFixed(6)}` };
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    const auth = await authenticate(request);
    if (!auth) return json({ error: "ابتدا وارد حساب شوید." }, 401);
    if (!(await allowRequest(auth.client, "neshan-search", 20)))
      return json({ error: "تعداد درخواست‌ها زیاد است؛ یک دقیقه دیگر دوباره تلاش کنید." }, 429);

    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
    const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const q = input.q;
    if (typeof q !== "string" || q.trim().length < 2 || q.trim().length > 100)
      return json({ error: "عبارت جست‌وجو معتبر نیست." }, 400);
    const center = isPoint(input.center) ? input.center : { lat: 37.25, lng: 55.17 };
    const params = new URLSearchParams({ text: q.trim(), ...searchView(center.lat, center.lng, 25) });
    const site = "https://balad.ir";
    const headers = {
      "Origin": site, "Referer": site + "/",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8",
      "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors",
      "app-session": crypto.randomUUID(), "platform": "web",
      "search-session": crypto.randomUUID(), "device-id": crypto.randomUUID(),
    };
    const response = await fetch(`https://search.raah.ir/v6/?${params}`, {
      headers, signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      console.error("Balad search returned HTTP", response.status);
      return json({ error: "جست‌وجوی مکان در بلد ناموفق بود." }, 502);
    }
    const payload = await response.json() as BaladSearchResponse;
    const item = payload.results?.find((candidate) =>
      Array.isArray(candidate.center_point) && candidate.center_point.length >= 2
      && Number.isFinite(candidate.center_point[0]) && Number.isFinite(candidate.center_point[1])
      && candidate.center_point[0] >= 43 && candidate.center_point[0] <= 64
      && candidate.center_point[1] >= 24 && candidate.center_point[1] <= 40.5
    );
    if (!item?.center_point) return json({ place: null });
    return json({ place: {
      lat: item.center_point[1], lng: item.center_point[0],
      name: item.maintext?.trim() || item.subtext1?.trim() || q.trim(),
    } });
  } catch (error) {
    console.error("balad search failed", error);
    return json({ error: "جست‌وجوی مکان در بلد ناموفق بود." }, 502);
  }
});
