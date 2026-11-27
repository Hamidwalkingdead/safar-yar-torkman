import type { PricingSettings } from "./pricing";

export const FARE = {
  minimum: 80_000,
  standardPerKm: 14_000,
  mountainPerKm: 16_000,
  nightSurchargePerKm: 1_500,
  longDistanceThresholdKm: 300,
  longDistancePerKm: 1_000,
  commissionRate: 0.1,
} as const;

export type FareInput = { km: number; night: boolean; mountain: boolean };
export type FareConfig = Pick<PricingSettings,
  "minimum" | "standardPerKm" | "mountainPerKm" | "nightSurchargePerKm" |
  "longDistanceThresholdKm" | "longDistancePerKm" | "commissionRate"
>;

export type FareBreakdown = {
  baseRate: number;
  base: number;
  night: number;
  longKm: number;
  long: number;
  subtotal: number;
  minimumApplied: boolean;
  total: number;
};

/** Base (mountain replaces standard) + night surcharge + long-distance surcharge; minimum enforced last. */
export function calculateFare(
  { km, night, mountain }: FareInput,
  config: FareConfig = FARE,
): FareBreakdown {
  const d = Math.max(0, km);
  const baseRate = mountain ? config.mountainPerKm : config.standardPerKm;
  const base = d * baseRate;
  const nightAmt = night ? d * config.nightSurchargePerKm : 0;
  const longKm = Math.max(0, d - config.longDistanceThresholdKm);
  const long = longKm * config.longDistancePerKm;
  const subtotal = Math.round(base + nightAmt + long);
  const total = Math.max(config.minimum, subtotal);
  return {
    baseRate, base, night: nightAmt, longKm, long, subtotal,
    minimumApplied: total > subtotal, total,
  };
}

export function commission(fare: number, config: Pick<FareConfig, "commissionRate"> = FARE) {
  const c = Math.round(fare * config.commissionRate);
  return { commission: c, driverNet: fare - c };
}

export const fa = (n: number) => Math.round(n).toLocaleString("fa-IR");
export const toman = (n: number) => `${fa(n)} تومان`;
