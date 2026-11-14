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
    if (!(await allowRequest(auth.client, "neshan-reverse", 30)))
      return json({ error: "تعداد درخواست‌ها زیاد است؛ یک دقیقه دیگر دوباره تلاش کنید." }, 429);
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
    if (!isPoint(body)) return json({ error: "مختصات معتبر نیست." }, 400);
    const key = Deno.env.get("NESHAN_SERVICE_KEY");
    if (!key) return json({ name: "" }, 503);
    const query = new URLSearchParams({ lat: String(body.lat), lng: String(body.lng) });
    const response = await fetch(`https://api.neshan.org/v5/reverse?${query}`, {
      headers: { "Api-Key": key },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return json({ name: "" }, 502);
    const result = await response.json() as { city?: string; neighbourhood?: string; formatted_address?: string };
    const address = result.formatted_address?.trim();
    const name = address || [result.neighbourhood, result.city].filter(Boolean).join("، ");
    return json({ name });
  } catch (error) {
    console.error("neshan-reverse failed", error);
    return json({ name: "" }, 502);
  }
});
