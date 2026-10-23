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

/** Order: base (mountain replaces standard) + night on top + long-distance over 300 km; minimum enforced last. */
export function calculateFare({ km, night, mountain }: FareInput): FareBreakdown {
  const d = Math.max(0, km);
  const baseRate = mountain ? FARE.mountainPerKm : FARE.standardPerKm;
  const base = d * baseRate;
  const nightAmt = night ? d * FARE.nightSurchargePerKm : 0;
  const longKm = Math.max(0, d - FARE.longDistanceThresholdKm);
  const long = longKm * FARE.longDistancePerKm;
  const subtotal = Math.round(base + nightAmt + long);
  const total = Math.max(FARE.minimum, subtotal);
  return {
    baseRate,
    base,
    night: nightAmt,
    longKm,
    long,
    subtotal,
    minimumApplied: total > subtotal,
    total,
  };
}

export function commission(fare: number) {
  const c = Math.round(fare * FARE.commissionRate);
  return { commission: c, driverNet: fare - c };
}

export const fa = (n: number) => Math.round(n).toLocaleString("fa-IR");
export const toman = (n: number) => `${fa(n)} تومان`;
