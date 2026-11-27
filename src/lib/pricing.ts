import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PricingSettings = {
  minimum: number;
  standardPerKm: number;
  mountainPerKm: number;
  nightSurchargePerKm: number;
  longDistanceThresholdKm: number;
  longDistancePerKm: number;
  commissionRate: number;
  nightStartHour: number;
  nightEndHour: number;
};

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  minimum: 80_000,
  standardPerKm: 14_000,
  mountainPerKm: 16_000,
  nightSurchargePerKm: 1_500,
  longDistanceThresholdKm: 300,
  longDistancePerKm: 1_000,
  commissionRate: 0.1,
  nightStartHour: 22,
  nightEndHour: 6,
};

export function usePricingSettings() {
  return useQuery({
    queryKey: ["platform-pricing-settings"],
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<PricingSettings> => {
      const { data, error } = await supabase.rpc("get_public_pricing_settings");
      if (error) throw error;
      const value = data as Partial<Record<string, number>> | null;
      if (!value) throw new Error("تنظیمات تعرفه دریافت نشد");
      return {
        minimum: Number(value.minimum_fare ?? DEFAULT_PRICING_SETTINGS.minimum),
        standardPerKm: Number(value.standard_per_km ?? DEFAULT_PRICING_SETTINGS.standardPerKm),
        mountainPerKm: Number(value.mountain_per_km ?? DEFAULT_PRICING_SETTINGS.mountainPerKm),
        nightSurchargePerKm: Number(value.night_surcharge_per_km ?? DEFAULT_PRICING_SETTINGS.nightSurchargePerKm),
        longDistanceThresholdKm: Number(value.long_distance_threshold_km ?? DEFAULT_PRICING_SETTINGS.longDistanceThresholdKm),
        longDistancePerKm: Number(value.long_distance_per_km ?? DEFAULT_PRICING_SETTINGS.longDistancePerKm),
        commissionRate: Number(value.commission_rate ?? DEFAULT_PRICING_SETTINGS.commissionRate),
        nightStartHour: Number(value.night_start_hour ?? DEFAULT_PRICING_SETTINGS.nightStartHour),
        nightEndHour: Number(value.night_end_hour ?? DEFAULT_PRICING_SETTINGS.nightEndHour),
      };
    },
  });
}
