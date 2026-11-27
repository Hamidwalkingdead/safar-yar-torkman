# Optional integrations: authentication and billing

This release keeps the passenger trip workflow independent from wallet operations and bank payment processing. Passenger and driver access requires a verified phone identity.

## Current release behavior

- Passenger and driver sign-in uses Supabase Phone OTP. Phone numbers are normalized to Iranian E.164 format before requests are sent.
- Existing anonymous sessions are upgraded in place by linking the phone identity, preserving the same Auth user ID and rows linked to it. This requires Supabase Auth manual identity linking to be enabled.
- New devices use the standard Supabase phone OTP sign-in flow.
- Passenger trip creation is blocked in the app until the profile phone is verified. The database migration history must also be kept in sync before adding or changing server-side verification guards.
- Admin sign-in remains a separate password-based flow; admin invitations continue to use email.
- SMS delivery depends on enabling the Supabase Auth Phone provider and configuring an SMS provider that can deliver to Iranian numbers. The application code does not send SMS itself.
- If a phone number is already attached to a different account, the app does not silently merge or replace identities. Existing trip/profile ownership must be reconciled through a reviewed migration process.
- Trip requests use the existing cash-at-destination flow. No wallet balance is created automatically for new accounts.
- Cash-trip completion records the agreed commission on the trip only; it does not debit a driver wallet or block acceptance based on a wallet debt limit.
- Cash cancellation debt is carried to the next trip and collected in cash by the driver; it is marked settled without wallet transfers.
- In the cash-only release, the full prior cancellation debt is collected by the driver in cash. The 90/10 allocation remains a recorded calculation only; no platform share is transferred until the wallet/settlement integration is enabled.
- Wallet controls and wallet history are hidden unless the wallet feature switch is enabled.
- Bank gateway processing is not implemented or called by the passenger trip flow.
- Existing wallet tables, RPCs, and settlement migrations are retained for compatibility; they are not a reason to enable wallet UI or collect money online.

## Feature switches

The UI switches are evaluated at build time in `src/lib/billing-config.ts`. The database also has a server-side `platform_billing_features` gate; wallet operations require both gates to be enabled.

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_FEATURE_WALLET_ENABLED` | off | Shows the existing wallet panel and wallet trip-payment option |
| `VITE_FEATURE_BANK_GATEWAY_ENABLED` | off | Reserved capability flag only; it does not implement a gateway |

The database wallet gate defaults to off. A future admin-only `admin_set_billing_features(true, false)` call enables the server-side wallet gate after the UI build flag is enabled. The database refuses to disable it while wallet-paid trips or withdrawal requests are still active. The bank gateway flag cannot be enabled until an actual provider adapter and its security/reconciliation tests exist.

Do not enable the bank gateway switch until a real provider adapter, server-side signature verification, idempotent callback handling, reconciliation, refund handling, and automated integration tests are implemented. Never put gateway secrets in VITE variables or client code.

To enable wallet in a later release, set `VITE_FEATURE_WALLET_ENABLED=true`, rebuild, and first verify the live database migration history and wallet settlement functions. Keep it off for the current cash-only release.

## SMS provider setup

In the Supabase Dashboard:

1. Enable the Phone provider under Authentication → Sign In / Providers.
2. Enable manual identity linking so an existing anonymous account can be upgraded to a verified phone identity without changing its user ID.
3. Configure an SMS provider with verified credentials and a delivery route that supports Iranian mobile numbers.
4. Keep OTP expiry and request limits enabled. Add CAPTCHA / abuse protection before public launch.
5. Test both a new phone sign-in and upgrading an existing anonymous account in a non-production test account before release.

The legacy application route `/api/public/auth/sms-hook` is retired and returns HTTP 410. Do not configure it as a Supabase Send SMS Hook. Use a supported Supabase SMS provider or deploy a separately reviewed provider webhook implementation.

## Design rule

Passenger trip creation, route verification, trip status, chat, support, and location tracking must not depend on wallet availability or bank-provider availability. Billing integrations are optional adapters around the trip lifecycle, not prerequisites for creating or managing a trip.

## Emergency contact protection

- Migration `0035_encrypt_emergency_contacts.sql` moves emergency contact values out of the plaintext profile column into a private table as AES-256 PGP ciphertext.
- The encryption key is generated by the migration and stored in Supabase Vault; it is not placed in client code or an environment variable.
- The plaintext profile column is cleared. Only the authenticated owner can retrieve the decrypted value through `get_my_emergency_phone()`; ordinary table reads cannot access the private ciphertext table.
- Profile writes are encrypted by a database trigger. Trip and shared-ride creation require a stored emergency contact, and driver approval checks the encrypted value.
- Changing or clearing an approved driver's emergency contact returns the driver verification to pending.
- The migration fails closed if Supabase Vault is not enabled; do not replace Vault with a plaintext key table.
