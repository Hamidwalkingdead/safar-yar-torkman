import { describe, it, expect } from "vitest";
import {
  canJoin,
  fareShares,
  joiningAmount,
  sharedEligible,
  matchesRide,
  parsePersianNumber,
} from "./shared-rides";

describe("shared ride rules", () => {
  it("enables only intercity trips", () => {
    expect(sharedEligible("urban")).toBe(false);
    expect(sharedEligible("intercity")).toBe(true);
  });
  it("never exceeds three passengers including multi-seat bookings", () => {
    expect(canJoin(2, 2, true)).toBe(false);
    expect(canJoin(2, 1, true)).toBe(true);
    expect(canJoin(3, 1, true)).toBe(false);
  });
  it("requires explicit consent", () => expect(canJoin(1, 1, false)).toBe(false));
  it("splits three passengers equally", () =>
    expect(fareShares(900000, 3)).toEqual([300000, 300000, 300000]));
  it("shows temporary shares for one and two", () => {
    expect(fareShares(900000, 1)).toEqual([900000]);
    expect(fareShares(900000, 2)).toEqual([450000, 450000]);
  });
  it("preserves total when rounding", () =>
    expect(fareShares(80000, 3).reduce((a, b) => a + b, 0)).toBe(80000));
  it("charges requested seats not reservation count", () =>
    expect(joiningAmount(900000, 1, 2)).toBe(600000));
  it("matches similar route within an hour", () =>
    expect(
      matchesRide(
        { origin: "تهران، ونک", destination: "رشت", departureAt: "2026-11-01T08:00:00+03:30" },
        "تهران آزادی",
        "رشت",
        "2026-11-01T09:00:00+03:30",
      ),
    ).toBe(true));
  it("rejects different routes", () =>
    expect(
      matchesRide(
        { origin: "تهران", destination: "رشت", departureAt: "2026-11-01T08:00:00+03:30" },
        "تهران",
        "قم",
        "2026-11-01T08:00:00+03:30",
      ),
    ).toBe(false));
  it("rejects departures more than one hour apart", () =>
    expect(
      matchesRide(
        { origin: "تهران", destination: "رشت", departureAt: "2026-11-01T08:00:00+03:30" },
        "تهران",
        "رشت",
        "2026-11-01T09:01:00+03:30",
      ),
    ).toBe(false));
  it("rejects different departure dates", () =>
    expect(
      matchesRide(
        { origin: "تهران", destination: "رشت", departureAt: "2026-11-01T23:45:00+03:30" },
        "تهران",
        "رشت",
        "2026-11-02T00:15:00+03:30",
      ),
    ).toBe(false));
  it("accepts Persian fare numerals", () => expect(parsePersianNumber("۹۰۰٬۰۰۰")).toBe(900000));
});
