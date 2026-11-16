import { json, preflight } from "../_shared/http.ts";
import { isPoint } from "../_shared/validation.ts";

const requestBuckets = new Map<string, { count: number; resetAt: number }>();
function allowGuestRequest(request: Request): boolean {
  const ip = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  const now = Date.now();
  const current = requestBuckets.get(ip);
  if (!current || current.resetAt <= now) {
    requestBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    if (requestBuckets.size > 10_000) {
      for (const [key, bucket] of requestBuckets) if (bucket.resetAt <= now) requestBuckets.delete(key);
    }
    return true;
  }
  if (current.count >= 40) return false;
  current.count += 1;
  return true;
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    if (!allowGuestRequest(request))
      return json({ error: "تعداد درخواست‌ها زیاد است؛ یک دقیقه دیگر دوباره تلاش کنید." }, 429);
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
    if (!isPoint(body)) return json({ error: "مختصات معتبر نیست." }, 400);

    const params = new URLSearchParams({ location: `${body.lng},${body.lat}` });
    const response = await fetch(`https://reverse-geocoding.raah.ir/v1?${params}`, {
      headers: {
        "Origin": "https://balad.ir", "Referer": "https://balad.ir/",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      console.error("Balad reverse geocoding returned HTTP", response.status);
      return json({ error: "سرویس نشانی‌یابی بلد پاسخ معتبر نداد.", providerStatus: response.status }, 502);
    }
    const result = await response.json() as { formatted_address?: string };
    const address = result.formatted_address?.trim() || "";
    if (!address) return json({ error: "برای این نقطه نشانی متنی پیدا نشد." }, 404);
    return json({ name: address });
  } catch (error) {
    console.error("balad reverse geocoding failed", error);
    return json({ error: "دریافت نشانی از بلد ناموفق بود." }, 502);
  }
});
