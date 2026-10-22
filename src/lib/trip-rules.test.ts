import { describe, it, expect } from "vitest";
import { allowedTransition, contactsVisible } from "./trip-rules";
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
