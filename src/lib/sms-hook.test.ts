import { describe, expect, it } from "vitest";
import { toKavenegarReceptor } from "@/routes/api/public/auth/sms-hook";

describe("Kavenegar receptor", () => {
  it("converts +98 numbers to 09 format", () => expect(toKavenegarReceptor("+989123456789")).toBe("09123456789"));
  it("rejects non-Iranian numbers", () => expect(toKavenegarReceptor("+15551234567")).toBeNull());
});
