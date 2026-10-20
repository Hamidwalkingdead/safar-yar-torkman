import { describe, it, expect } from "vitest";
import { calculateFare, commission } from "./fare";

describe("fare rules", () => {
  it("minimum fare 80,000", () => expect(calculateFare({ km: 2, night: false, mountain: false }).total).toBe(80_000));
  it("standard 14,000/km", () => expect(calculateFare({ km: 10, night: false, mountain: false }).total).toBe(140_000));
  it("night adds 1,500/km", () => expect(calculateFare({ km: 10, night: true, mountain: false }).total).toBe(155_000));
  it("mountain 16,000/km replaces standard", () => expect(calculateFare({ km: 10, night: false, mountain: true }).total).toBe(160_000));
  it("long distance +1,000 only over 300 km", () => expect(calculateFare({ km: 400, night: false, mountain: false }).total).toBe(400 * 14_000 + 100 * 1_000));
  it("all combined", () => expect(calculateFare({ km: 350, night: true, mountain: true }).total).toBe(350 * 16_000 + 350 * 1_500 + 50 * 1_000));
  it("minimum applied last with night", () => expect(calculateFare({ km: 5, night: true, mountain: false }).total).toBe(80_000));
  it("commission 10%", () => expect(commission(200_000)).toEqual({ commission: 20_000, driverNet: 180_000 }));
});
