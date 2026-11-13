export type BillingEnvironment = {
  VITE_FEATURE_WALLET_ENABLED?: string;
  VITE_FEATURE_BANK_GATEWAY_ENABLED?: string;
};

export type BillingFeatures = {
  wallet: boolean;
  bankGateway: boolean;
};

/** Payment capabilities stay off until deliberately enabled at build/deploy time. */
export function getBillingFeatures(env: BillingEnvironment): BillingFeatures {
  return {
    wallet: env.VITE_FEATURE_WALLET_ENABLED === "true",
    bankGateway: env.VITE_FEATURE_BANK_GATEWAY_ENABLED === "true",
  };
}

export const billingFeatures = getBillingFeatures(import.meta.env);
