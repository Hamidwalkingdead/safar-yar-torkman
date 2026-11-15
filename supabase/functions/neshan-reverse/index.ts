import { json, preflight } from "../_shared/http.ts";
import { isPoint } from "../_shared/validation.ts";

// Guest passenger mode must be able to resolve a selected map point.
// Bound requests per client IP to reduce abuse of the server-side Neshan key.
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
      for (const [key, bucket] of requestBuckets) {
        if (bucket.resetAt <= now) requestBuckets.delete(key);
      }
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
    try { body = await request.json(); }
    catch { return json({ error: "درخواست نامعتبر است." }, 400); }
    if (!isPoint(body)) return json({ error: "مختصات معتبر نیست." }, 400);

    const key = Deno.env.get("NESHAN_REVERSE_KEY") || Deno.env.get("NESHAN_SERVICE_KEY");
    if (!key) {
      console.error("NESHAN_REVERSE_KEY is not configured");
      return json({ error: "کلید سرویس نشان در تنظیمات سرور ثبت نشده است." }, 503);
    }

    const query = new URLSearchParams({ lat: String(body.lat), lng: String(body.lng) });
    const response = await fetch(`https://api.neshan.org/v5/reverse?${query}`, {
      headers: { "Api-Key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error("Neshan reverse returned HTTP", response.status);
      return json({ error: "سرویس نشانی‌یابی نشان پاسخ معتبر نداد.", providerStatus: response.status }, 502);
    }

    const result = await response.json() as {
      formatted_address?: string;
      route_name?: string;
      neighbourhood?: string;
      city?: string;
      name?: string;
    };
    const address = result.formatted_address?.trim()
      || [result.route_name, result.neighbourhood, result.city].filter(Boolean).join("، ")
      || result.name?.trim()
      || "";
    if (!address) return json({ error: "برای این نقطه نشانی متنی پیدا نشد." }, 404);
    return json({ name: address });
  } catch (error) {
    console.error("neshan-reverse failed", error);
    return json({ error: "دریافت نشانی از نشان ناموفق بود." }, 502);
  }
});
