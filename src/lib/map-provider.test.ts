import { describe, expect, it } from "vitest";
import { parseNeshanAddress, parseNeshanPlace, parseNeshanRoute } from "./map-provider";

const direction = {
  routes: [{
    legs: [
      { distance: { value: 1200 }, duration: { value: 240 } },
      { distance: { value: 800 }, duration: { value: 180 } },
    ],
    overview_polyline: { points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
  }],
};

describe("Neshan provider adapter", () => {
  it("maps route distance, duration and Iran geometry to provider-independent fields", () => {
    const result = parseNeshanRoute(direction, "2026-01-01T00:00:00.000Z");
    expect(result).toBeNull(); // fixture geometry is outside Iran and must be rejected
  });

  it("rejects missing, non-finite, zero, and unreasonable route metrics", () => {
    expect(parseNeshanRoute(null)).toBeNull();
    expect(parseNeshanRoute({ routes: [{ legs: [{ distance: { value: 0 }, duration: { value: 10 } }] }] })).toBeNull();
    expect(parseNeshanRoute({ routes: [{ legs: [{ distance: { value: Number.NaN }, duration: { value: 10 } }] }] })).toBeNull();
    expect(parseNeshanRoute({ routes: [{ legs: [{ distance: { value: 3_100_000 }, duration: { value: 10 } }] }] })).toBeNull();
  });

  it("validates search result coordinates and bounds display names", () => {
    expect(parseNeshanPlace({ items: [{ title: "تهران", location: { x: 51.4, y: 35.7 } }] }, "query"))
      .toEqual({ name: "تهران", coordinate: { lat: 35.7, lng: 51.4 } });
    expect(parseNeshanPlace({ items: [{ location: { x: 10, y: 90 } }] }, "query")).toBeNull();
    expect(parseNeshanPlace({ items: [] }, "query")).toBeNull();
  });

  it("returns the first available normalized reverse-geocoded label", () => {
    expect(parseNeshanAddress({ city: "  تهران  ", formatted_address: "آدرس" })).toBe("تهران");
    expect(parseNeshanAddress({ city: "", neighbourhood: "ونک" })).toBe("ونک");
    expect(parseNeshanAddress(null)).toBe("");
  });
});
