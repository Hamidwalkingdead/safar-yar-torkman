import { authenticate } from "../_shared/auth.ts";
import { allowRequest } from "../_shared/rate-limit.ts";
import { json, preflight } from "../_shared/http.ts";
import { isPoint } from "../_shared/validation.ts";

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
    const center = isPoint(input.center) ? input.center : { lat: 37.0, lng: 54.8 };
    const key = Deno.env.get("NESHAN_SERVICE_KEY");
    if (!key) return json({ place: null }, 503);
    const query = new URLSearchParams({ term: q.trim(), lat: String(center.lat), lng: String(center.lng) });
    const response = await fetch(`https://api.neshan.org/v1/search?${query}`, {
      headers: { "Api-Key": key },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return json({ place: null }, 502);
    const result = await response.json() as { items?: { location?: { x: number; y: number } }[] };
    const location = result.items?.[0]?.location;
    return json({ place: location ? { lat: location.y, lng: location.x, name: q.trim() } : null });
  } catch (error) {
    console.error("neshan-search failed", error);
    return json({ place: null }, 502);
  }
});
