import { supabase } from "@/integrations/supabase/client";
import type { Point } from "@/lib/geo";

type CreateTripInput = {
  origin: Point;
  destination: Point;
  originName: string;
  destinationName: string;
  departure: string;
  mountain: boolean;
  suggested: number | null;
  paymentMethod: "cash" | "wallet";
  rideType: "urban" | "intercity";
};

export async function createTripFromRoute({ data }: { data: CreateTripInput }) {
  const { data: result, error } = await supabase.functions.invoke<{
    id?: string;
    distanceKm?: number;
    durationMinutes?: number;
    error?: string;
  }>("create-trip", { body: data });

  if (error) {
    const response = (error as { context?: Response }).context;
    if (response) {
      try {
        const payload = await response.clone().json() as { error?: string };
        if (payload.error) throw new Error(payload.error);
      } catch (parseError) {
        if (parseError instanceof Error && parseError.message !== "Unexpected end of JSON input") throw parseError;
      }
    }
    throw new Error("ثبت سفر انجام نشد؛ اتصال سرور را بررسی کنید.");
  }
  if (!result?.id) throw new Error(result?.error || "شناسه سفر دریافت نشد.");
  return {
    id: result.id,
    distanceKm: result.distanceKm ?? 0,
    durationMinutes: result.durationMinutes ?? 0,
  };
}
