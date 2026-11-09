import { describe, expect, it } from "vitest";
import { isNightDeparture, nextPick, routeErrorMessage } from "./geo";
import { decodePolyline } from "./polyline";
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
});
describe("map picking", () => {
  it("first tap is origin, second destination, third restarts", () => {
    expect(nextPick(false, false)).toEqual({ which: "origin", reset: false });
    expect(nextPick(true, false)).toEqual({ which: "destination", reset: false });
    expect(nextPick(true, true)).toEqual({ which: "origin", reset: true });
  });
  it("decodes a Neshan/Google encoded polyline", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });
  it("explains a missing routing key", () => {
    expect(routeErrorMessage("missing_key")).toContain("NESHAN_SERVICE_KEY");
  });
});
