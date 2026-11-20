import { describe, expect, it } from "vitest";
import { isIranianMobile, passengerProfileComplete, passengerTripStatusLabel } from "./passenger-panel";

describe("passenger panel profile readiness", () => {
  const complete = {
    first_name: "حمید",
    last_name: "آزادی",
    display_name: "مستر",
    phone: "09123456789",
    phone_verified: true,
    emergency_phone: "09987654321",
  };

  it("requires all profile fields and a verified phone before requesting a trip", () => {
    expect(passengerProfileComplete(complete)).toBe(true);
    expect(passengerProfileComplete({ ...complete, emergency_phone: "" })).toBe(false);
    expect(passengerProfileComplete({ ...complete, first_name: "ح" })).toBe(false);
    expect(passengerProfileComplete({ ...complete, phone_verified: false })).toBe(false);
    expect(passengerProfileComplete({ ...complete, phone_verified: null })).toBe(false);
    expect(passengerProfileComplete({ ...complete, phone_verified: undefined })).toBe(false);
    expect(passengerProfileComplete(null)).toBe(false);
  });

  it("accepts Persian digits only when the phone has been verified", () => {
    expect(passengerProfileComplete({
      ...complete,
      phone: "۰۹۱۲۳۴۵۶۷۸۹",
      emergency_phone: "۰۹۹۸۷۶۵۴۳۲۱",
    })).toBe(true);
    expect(passengerProfileComplete({
      ...complete,
      phone: "۰۹۱۲۳۴۵۶۷۸۹",
      phone_verified: false,
      emergency_phone: "۰۹۹۸۷۶۵۴۳۲۱",
    })).toBe(false);
  });
});

describe("passenger trip status labels", () => {
  it("shows readable Persian labels for all trip states", () => {
    expect(passengerTripStatusLabel("pending")).toBe("در انتظار راننده");
    expect(passengerTripStatusLabel("accepted")).toBe("راننده پذیرفت");
    expect(passengerTripStatusLabel("ongoing")).toBe("در حال سفر");
    expect(passengerTripStatusLabel("done")).toBe("پایان‌یافته");
    expect(passengerTripStatusLabel("cancelled")).toBe("لغوشده");
    expect(passengerTripStatusLabel("unexpected")).toBe("وضعیت نامشخص");
  });
});

describe("Iranian mobile normalization", () => {
  it("accepts Persian and Arabic-Indic digits and rejects invalid numbers", () => {
    expect(isIranianMobile("۰۹۱۲۳۴۵۶۷۸۹")).toBe(true);
    expect(isIranianMobile("٠٩١٢٣٤٥٦٧٨٩")).toBe(true);
    expect(isIranianMobile("09123456789")).toBe(true);
    expect(isIranianMobile("0912345678")).toBe(false);
    expect(isIranianMobile("+989123456789")).toBe(true);
    expect(isIranianMobile("00989123456789")).toBe(true);
    expect(isIranianMobile("989123456789")).toBe(true);
    expect(isIranianMobile("9123456789")).toBe(true);
    expect(isIranianMobile(null)).toBe(false);
  });
});
