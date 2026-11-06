import { describe, it, expect } from "vitest";
import { allowedTransition, contactsVisible, pendingForDriver, tripParty } from "./trip-rules";
describe("trip authorization", () => {
  it("passenger cannot accept their own trip", () =>
    expect(allowedTransition("pending", "accepted", "passenger")).toBe(false));
  it("only assigned driver can start trip", () => {
    expect(allowedTransition("accepted", "ongoing", "driver")).toBe(true);
    expect(allowedTransition("accepted", "ongoing", "passenger")).toBe(false);
  });
  it("completion requires ongoing state", () => {
    expect(allowedTransition("accepted", "done", "driver")).toBe(false);
    expect(allowedTransition("ongoing", "done", "driver")).toBe(true);
  });
  it("contacts hidden before acceptance", () =>
    expect(contactsVisible("pending", true)).toBe(false));
  it("contacts restricted to participants after acceptance", () => {
    expect(contactsVisible("accepted", true)).toBe(true);
    expect(contactsVisible("accepted", false)).toBe(false);
  });
  it("cancelled trip hides contacts", () => expect(contactsVisible("cancelled", true)).toBe(false));
});

describe("driver offers and identity", () => {
  const trip = {
    status: "pending",
    passenger_id: "passenger",
    driver_id: null,
    departure_at: "2030-01-01T00:00:00Z",
    created_at: "2029-12-31T23:55:00Z",
  };
  it("shows future passenger requests to other drivers", () => {
    expect(pendingForDriver(trip, "driver-a", 0)).toBe(true);
    expect(pendingForDriver(trip, "driver-b", 0)).toBe(true);
  });
  it("keeps immediate requests visible to drivers after creation", () => {
    const immediate = {
      ...trip,
      departure_at: "2030-01-01T00:00:00Z",
      created_at: "2030-01-01T00:00:02Z",
    };
    expect(pendingForDriver(immediate, "driver-a", Date.parse("2030-01-01T00:01:00Z"))).toBe(true);
    expect(pendingForDriver(immediate, "driver-a", Date.parse("2030-01-01T01:31:00Z"))).toBe(false);
  });
  it("never shows own request or accepted request as a pending offer", () => {
    expect(pendingForDriver(trip, "passenger", 0)).toBe(false);
    expect(pendingForDriver({ ...trip, status: "accepted" }, "driver-a", 0)).toBe(false);
  });
  it("does not infer passenger permissions for an unrelated driver", () => {
    expect(tripParty(trip, "driver-a")).toBeNull();
    expect(tripParty(trip, "passenger")).toBe("passenger");
    expect(tripParty({ ...trip, driver_id: "driver-a" }, "driver-a")).toBe("driver");
  });
});
