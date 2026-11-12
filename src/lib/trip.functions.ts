import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const point = z.object({
  lat: z.number().min(24).max(40.5),
  lng: z.number().min(43).max(64),
});

const input = z.object({
  origin: point,
  destination: point,
  originName: z.string().trim().min(2).max(160),
  destinationName: z.string().trim().min(2).max(160),
  departure: z.string().datetime({ offset: true }),
  mountain: z.boolean(),
  suggested: z.number().int().min(80_000).max(2_147_483_647).nullable(),
  paymentMethod: z.enum(["cash", "wallet"]),
  rideType: z.enum(["urban", "intercity"]),
});

type DirectionResponse = {
  routes?: {
    legs?: {
      distance?: { value?: number };
      duration?: { value?: number };
    }[];
  }[];
};

/**
 * Recalculate the road distance on the server before creating a paid trip.
 * Never accept the browser's displayed kilometer count as a financial input.
 */
export const createTripFromRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value) => input.parse(value))
  .handler(async ({ data, context }) => {
    const key = process.env["NESHAN_SERVICE_KEY"];
    if (!key) throw new Error("سرویس مسیریابی نشان روی سرور تنظیم نشده است.");

    const { origin, destination } = data;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let response: Response;
    try {
      const query = new URLSearchParams({
        type: "car",
        origin: `${origin.lat},${origin.lng}`,
        destination: `${destination.lat},${destination.lng}`,
      });
      response = await fetch(`https://api.neshan.org/v4/direction?${query}`, {
        headers: { "Api-Key": key },
        signal: controller.signal,
      });
    } catch {
      throw new Error("ارتباط با سرویس مسیریابی برقرار نشد؛ سفر ثبت نشد.");
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error("سرویس مسیریابی مسیر را تأیید نکرد؛ سفر ثبت نشد.");
    }

    const routeData = (await response.json()) as DirectionResponse;
    const legs = routeData.routes?.[0]?.legs ?? [];
    const meters = legs.reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0);
    const seconds = legs.reduce((sum, leg) => sum + (leg.duration?.value ?? 0), 0);
    if (!Number.isFinite(meters) || meters <= 0 || !Number.isFinite(seconds) || seconds <= 0) {
      throw new Error("مسیر جاده‌ای معتبر پیدا نشد؛ مبدأ و مقصد را بررسی کنید.");
    }

    const distanceKm = Math.max(1, Math.round(meters / 1000));
    if (distanceKm > 3000) throw new Error("مسافت این مسیر از محدوده مجاز بیشتر است.");

    const { data: tripId, error } = await context.supabase.rpc("create_trip", {
      p_origin: data.originName,
      p_destination: data.destinationName,
      p_departure: data.departure,
      p_km: distanceKm,
      // The database migration derives night status from p_departure itself.
      p_night: false,
      p_mountain: data.mountain,
      p_origin_lat: data.origin.lat,
      p_origin_lng: data.origin.lng,
      p_destination_lat: data.destination.lat,
      p_destination_lng: data.destination.lng,
      p_suggested: data.suggested,
      p_payment_method: data.paymentMethod,
      p_ride_type: data.rideType,
    });
    if (error) throw new Error(error.message);
    if (!tripId) throw new Error("شناسه سفر از پایگاه داده دریافت نشد.");

    return {
      id: tripId,
      distanceKm,
      durationMinutes: Math.max(1, Math.round(seconds / 60)),
    };
  });
