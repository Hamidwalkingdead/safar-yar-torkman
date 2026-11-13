# Optional integrations: authentication and billing

This release keeps the passenger trip workflow independent from SMS delivery, wallet operations, and bank payment processing.

## Current release behavior

- Trip requests use the existing cash-at-destination flow.
- Wallet controls and wallet history are hidden unless the wallet feature switch is enabled.
- Bank gateway processing is not implemented or called by the passenger trip flow.
- Existing wallet tables, RPCs, and settlement migrations are retained for compatibility; they are not a reason to enable wallet UI or collect money online.
- No payment gateway credentials are required to build or run the cash-only trip flow.

## Feature switches

The switches are evaluated at build time in `src/lib/billing-config.ts`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_FEATURE_WALLET_ENABLED` | off | Shows the existing wallet panel and wallet trip-payment option |
| `VITE_FEATURE_BANK_GATEWAY_ENABLED` | off | Reserved capability flag only; it does not implement a gateway |

Do not enable the bank gateway switch until a real provider adapter, server-side signature verification, idempotent callback handling, reconciliation, refund handling, and automated integration tests are implemented. Never put gateway secrets in VITE variables or client code.

To enable wallet in a later release, set `VITE_FEATURE_WALLET_ENABLED=true`, rebuild, and first verify the live database migration history and wallet settlement functions. Keep it off for the current cash-only release.

## SMS authentication

The current sign-in screen is an adapter to Supabase Phone OTP. Its delivery depends on Supabase Auth phone-provider configuration and the SMS hook/provider secrets. SMS provider setup and delivery testing are deliberately outside the current passenger-panel implementation scope.

Authentication itself is not bypassed: trip and profile data are protected by Supabase Auth and row-level security. A future non-SMS sign-in method should be added as another auth adapter, not by making passenger or trip data public. Keep the stable authenticated user ID as the application identity so switching providers does not require changing trip ownership or database relationships.

## Design rule

Passenger trip creation, route verification, trip status, chat, support, and location tracking must not depend on wallet availability or bank-provider availability. Billing integrations are optional adapters around the trip lifecycle, not prerequisites for creating or managing a trip.
