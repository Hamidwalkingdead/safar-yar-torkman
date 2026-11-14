import { describe, expect, it } from "vitest";
import { getBillingFeatures } from "./billing-config";

describe("billing feature switches", () => {
  it("keeps wallet and bank gateway disabled by default", () => {
    expect(getBillingFeatures({})).toEqual({ wallet: false, bankGateway: false });
  });

  it("can enable wallet independently for a future release", () => {
    expect(getBillingFeatures({ VITE_FEATURE_WALLET_ENABLED: "true" })).toEqual({
      wallet: true,
      bankGateway: false,
    });
  });

  it("can enable the bank gateway independently in a future release", () => {
    expect(getBillingFeatures({ VITE_FEATURE_BANK_GATEWAY_ENABLED: "true" })).toEqual({
      wallet: false,
      bankGateway: true,
    });
  });
});
