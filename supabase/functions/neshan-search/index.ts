import { authenticate } from "../_shared/auth.ts";
import { allowRequest } from "../_shared/rate-limit.ts";
import { json, preflight } from "../_shared/http.ts";
import { isPoint } from "../_shared/validation.ts";

type SearchItem = {
  title?: string;
  address?: string;
  location?: { x?: number; y?: number };
};

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    const auth = await authenticate(request);
    if (!auth) return json({ error: "ابتدا وارد حساب شوید." }, 401);
    if (!(await allowRequest(auth.client, "neshan-search", 20)))
      return json({ error: "تعداد درخواست‌ها زیاد است؛ یک دقیقه دیگر دوباره تلاش کنید." }, 429);

    let body: unknown;
    try { body = await request.json(); }
    catch { return json({ error: "درخواست نامعتبر است." }, 400); }
    const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const q = input.q;
    if (typeof q !== "string" || q.trim().length < 2 || q.trim().length > 100)
      return json({ error: "عبارت جست‌وجو معتبر نیست." }, 400);

    const center = isPoint(input.center) ? input.center : { lat: 37.25, lng: 55.17 };
    const key = Deno.env.get("NESHAN_SEARCH_KEY");
    if (!key) {
      console.error("NESHAN_SERVICE_KEY is not configured");
      return json({ error: "کلید سرویس نشان در تنظیمات سرور ثبت نشده است." }, 503);
    }

    const query = new URLSearchParams({ term: q.trim(), lat: String(center.lat), lng: String(center.lng) });
    const response = await fetch(`https://api.neshan.org/v1/search?${query}`, {
      headers: { "Api-Key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error("Neshan search returned HTTP", response.status);
      return json({ error: "جست‌وجوی مکان در نشان ناموفق بود." }, 502);
    }

    const result = await response.json() as { items?: SearchItem[] };
    const item = result.items?.find((candidate) =>
      typeof candidate.location?.x === "number" && Number.isFinite(candidate.location.x)
      && typeof candidate.location?.y === "number" && Number.isFinite(candidate.location.y)
    );
    if (!item?.location) return json({ place: null });
    const name = item.title?.trim() || item.address?.trim() || q.trim();
    return json({ place: { lat: item.location.y!, lng: item.location.x!, name } });
  } catch (error) {
    console.error("neshan-search failed", error);
    return json({ error: "جست‌وجوی مکان در نشان ناموفق بود." }, 502);
  }
});
