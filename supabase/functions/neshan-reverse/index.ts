import { json, preflight } from "../_shared/http.ts";
import { isPoint } from "../_shared/validation.ts";

const recent = new Map<string, { start: number; count: number }>();

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
    if (!isPoint(body)) return json({ error: "مختصات معتبر نیست." }, 400);

    const clientIp = request.headers.get("cf-connecting-ip")
      ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? "unknown";
    const now = Date.now();
    const bucket = recent.get(clientIp);
    if (bucket && now - bucket.start < 60_000 && bucket.count >= 40)
      return json({ error: "تعداد درخواست‌ها زیاد است؛ یک دقیقه دیگر دوباره تلاش کنید." }, 429);
    if (!bucket || now - bucket.start >= 60_000) recent.set(clientIp, { start: now, count: 1 });
    else bucket.count += 1;

    const key = Deno.env.get("NESHAN_SERVICE_KEY");
    if (!key) {
      console.error("NESHAN_SERVICE_KEY is not configured");
      return json({ error: "سرویس نشانی‌یابی نشان روی سرور تنظیم نشده است." }, 503);
    }
    const query = new URLSearchParams({ lat: String(body.lat), lng: String(body.lng) });
    const response = await fetch(`https://api.neshan.org/v5/reverse?${query}`, {
      headers: { "Api-Key": key },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error("Neshan reverse returned HTTP", response.status);
      return json({ error: "سرویس نشانی‌یابی نشان پاسخ معتبر نداد." }, 502);
    }
    const result = await response.json() as {
      city?: string; neighbourhood?: string; formatted_address?: string;
      route_name?: string; name?: string;
    };
    const address = result.formatted_address?.trim();
    const name = address || [result.route_name, result.neighbourhood, result.city].filter(Boolean).join("، ") || result.name?.trim() || "";
    return json({ name });
  } catch (error) {
    console.error("neshan-reverse failed", error);
    return json({ error: "دریافت نشانی از نشان ناموفق بود." }, 502);
  }
});