# Optional integrations: authentication and billing

This release keeps the passenger trip workflow independent from SMS delivery, wallet operations, and bank payment processing.

## Current release behavior

- Trip requests use the existing cash-at-destination flow. No wallet balance is created automatically for new accounts.
- Cash-trip completion records the agreed commission on the trip only; it does not debit a driver wallet or block acceptance based on a wallet debt limit.
- Cash cancellation debt is carried to the next trip and collected in cash by the driver; it is marked settled without wallet transfers.
- In the cash-only release, the full prior cancellation debt is collected by the driver in cash. The 90/10 allocation remains a recorded calculation only; no platform share is transferred until the wallet/settlement integration is enabled.
- Wallet controls and wallet history are hidden unless the wallet feature switch is enabled.
- Bank gateway processing is not implemented or called by the passenger trip flow.
- Existing wallet tables, RPCs, and settlement migrations are retained for compatibility; they are not a reason to enable wallet UI or collect money online.
- No payment gateway credentials are required to build or run the cash-only trip flow.

## Feature switches

The UI switches are evaluated at build time in `src/lib/billing-config.ts`. The database also has a server-side `platform_billing_features` gate; wallet operations require both gates to be enabled.

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_FEATURE_WALLET_ENABLED` | off | Shows the existing wallet panel and wallet trip-payment option |
| `VITE_FEATURE_BANK_GATEWAY_ENABLED` | off | Reserved capability flag only; it does not implement a gateway |

The database wallet gate defaults to off. A future admin-only `admin_set_billing_features(true, false)` call enables the server-side wallet gate after the UI build flag is enabled. The database refuses to disable it while wallet-paid trips or withdrawal requests are still active. The bank gateway flag cannot be enabled until an actual provider adapter and its security/reconciliation tests exist.

Do not enable the bank gateway switch until a real provider adapter, server-side signature verification, idempotent callback handling, reconciliation, refund handling, and automated integration tests are implemented. Never put gateway secrets in VITE variables or client code.

To enable wallet in a later release, set `VITE_FEATURE_WALLET_ENABLED=true`, rebuild, and first verify the live database migration history and wallet settlement functions. Keep it off for the current cash-only release.

## SMS authentication

The current sign-in screen is an adapter to Supabase Phone OTP. Its delivery depends on Supabase Auth phone-provider configuration and the SMS hook/provider secrets. SMS provider setup and delivery testing are deliberately outside the current passenger-panel implementation scope.

Authentication itself is not bypassed: trip and profile data are protected by Supabase Auth and row-level security. A future non-SMS sign-in method should be added as another auth adapter, not by making passenger or trip data public. Keep the stable authenticated user ID as the application identity so switching providers does not require changing trip ownership or database relationships.

## Design rule

Passenger trip creation, route verification, trip status, chat, support, and location tracking must not depend on wallet availability or bank-provider availability. Billing integrations are optional adapters around the trip lifecycle, not prerequisites for creating or managing a trip.
