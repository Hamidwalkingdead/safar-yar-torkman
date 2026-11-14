import { describe, expect, it } from "vitest";
import { toIranE164 } from "@/components/shared-auth";

describe("Iranian mobile phone normalization", () => {
  it.each([
    ["09123456789", "+989123456789"],
    ["۰۹۱۲۳۴۵۶۷۸۹", "+989123456789"],
    ["989123456789", "+989123456789"],
    ["00989123456789", "+989123456789"],
    ["+989123456789", "+989123456789"],
  ])("normalizes %s", (input, expected) => {
    expect(toIranE164(input)).toBe(expected);
  });

  it.each(["0912345678", "08123456789", "12345678901", ""])(
    "rejects invalid mobile number %s",
    (input) => {
      expect(toIranE164(input)).toBeNull();
    },
  );
});
