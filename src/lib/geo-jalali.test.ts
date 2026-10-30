import { describe, expect, it } from "vitest";
import { estimatedRoadKm, isNightDeparture } from "./geo";
import { isoDateToJalali, jalaliMonthLength, jalaliToIsoDate } from "./jalali";
import { departureISO } from "./shared-rides";

describe("shamsi dates", () => {
  it("converts Nowruz 1405 to 2026-03-21", () => {
    expect(jalaliToIsoDate(1405, 1, 1)).toBe("2026-03-21");
    expect(isoDateToJalali("2026-10-30")).toEqual([1405, 8, 8]);
  });
  it("has 29 or 30 days in Esfand", () => {
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
  });
});
describe("automatic night and distance", () => {
  it("22:00 Tehran is night, 21:59 and 06:00 are not", () => {
    expect(isNightDeparture(departureISO("2026-11-01", "22:00"))).toBe(true);
    expect(isNightDeparture(departureISO("2026-11-01", "05:59"))).toBe(true);
    expect(isNightDeparture(departureISO("2026-11-01", "21:59"))).toBe(false);
    expect(isNightDeparture(departureISO("2026-11-01", "06:00"))).toBe(false);
  });
  it("estimates Gorgan to Gonbad road distance", () => {
    const km = estimatedRoadKm({ lat: 36.84, lng: 54.43 }, { lat: 37.25, lng: 55.17 });
    expect(km).toBeGreaterThan(90);
    expect(km).toBeLessThan(110);
  });
});
