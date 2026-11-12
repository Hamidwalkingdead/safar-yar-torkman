import { authenticate } from "../_shared/auth.ts";
import { json, preflight } from "../_shared/http.ts";
import { parseCreateTripInput } from "../_shared/validation.ts";

type DirectionResponse = {
  routes?: {
    legs?: {
      distance?: { value?: number };
      duration?: { value?: number };
    }[];
  }[];
};

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  try {
    const auth = await authenticate(request);
    if (!auth) return json({ error: "برای ثبت سفر ابتدا وارد حساب شوید." }, 401);

    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
    const input = parseCreateTripInput(body);
    if (!input) return json({ error: "اطلاعات مبدأ، مقصد، زمان یا پرداخت معتبر نیست." }, 400);

    const key = Deno.env.get("NESHAN_SERVICE_KEY");
    if (!key) return json({ error: "کلید مسیریابی نشان روی سرور تنظیم نشده است." }, 503);

    const query = new URLSearchParams({
      type: "car",
      origin: `${input.origin.lat},${input.origin.lng}`,
      destination: `${input.destination.lat},${input.destination.lng}`,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let routeResponse: Response;
    try {
      routeResponse = await fetch(`https://api.neshan.org/v4/direction?${query}`, {
        headers: { "Api-Key": key },
        signal: controller.signal,
      });
    } catch {
      return json({ error: "ارتباط با سرویس مسیریابی برقرار نشد؛ سفر ثبت نشد." }, 502);
    } finally {
      clearTimeout(timeout);
    }

    if (!routeResponse.ok) return json({ error: "سرویس نشان مسیر را تأیید نکرد؛ سفر ثبت نشد." }, 502);
    const route = await routeResponse.json() as DirectionResponse;
    const legs = route.routes?.[0]?.legs ?? [];
    const meters = legs.reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0);
    const seconds = legs.reduce((sum, leg) => sum + (leg.duration?.value ?? 0), 0);
    if (!Number.isFinite(meters) || meters <= 0 || !Number.isFinite(seconds) || seconds <= 0)
      return json({ error: "مسیر جاده‌ای معتبر پیدا نشد؛ مبدأ و مقصد را بررسی کنید." }, 422);

    const distanceKm = Math.max(1, Math.round(meters / 1000));
    if (distanceKm > 3000) return json({ error: "مسافت این مسیر از محدوده مجاز بیشتر است." }, 422);

    const { data: tripId, error } = await auth.client.rpc("create_trip", {
      p_origin: input.originName,
      p_destination: input.destinationName,
      p_departure: input.departure,
      p_km: distanceKm,
      p_night: false,
      p_mountain: input.mountain,
      p_origin_lat: input.origin.lat,
      p_origin_lng: input.origin.lng,
      p_destination_lat: input.destination.lat,
      p_destination_lng: input.destination.lng,
      p_suggested: input.suggested,
      p_payment_method: input.paymentMethod,
      p_ride_type: input.rideType,
    });
    if (error) return json({ error: error.message || "ثبت سفر در پایگاه داده انجام نشد." }, 400);
    if (!tripId) return json({ error: "شناسه سفر از پایگاه داده دریافت نشد." }, 500);

    return json({
      id: tripId,
      distanceKm,
      durationMinutes: Math.max(1, Math.round(seconds / 60)),
    });
  } catch (error) {
    console.error("create-trip failed", error);
    return json({ error: "خطای سرور هنگام ثبت سفر رخ داد." }, 500);
  }
});
