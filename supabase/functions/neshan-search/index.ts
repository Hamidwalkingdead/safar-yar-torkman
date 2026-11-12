import { authenticate } from "../_shared/auth.ts";
import { json, preflight } from "../_shared/http.ts";

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    const auth = await authenticate(request);
    if (!auth) return json({ error: "ابتدا وارد حساب شوید." }, 401);
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
    const q = body && typeof body === "object" ? (body as Record<string, unknown>).q : null;
    if (typeof q !== "string" || q.trim().length < 2 || q.trim().length > 100)
      return json({ error: "عبارت جست‌وجو معتبر نیست." }, 400);
    const key = Deno.env.get("NESHAN_SERVICE_KEY");
    if (!key) return json({ place: null }, 503);
    const query = new URLSearchParams({ term: q.trim(), lat: "37.0", lng: "54.8" });
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
