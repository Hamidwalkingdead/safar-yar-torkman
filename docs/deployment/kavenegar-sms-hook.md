# Kavenegar SMS for Supabase phone authentication

The app uses Supabase Phone OTP. The Send SMS Auth Hook lets Supabase replace its built-in SMS provider with a regional provider; Supabase lists this hook as available on Free and Pro plans. The hook receives the user's phone number and OTP, and only a successful HTTP 200 response is treated as a successful send. See the [Supabase Send SMS Hook documentation](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook).

The repository now includes `supabase/functions/kavenegar-send-sms`. It:

- Verifies the signed Supabase Auth webhook using Standard Webhooks before reading the OTP.
- Normalizes Supabase E.164 Iranian phone numbers to `09XXXXXXXXX`.
- Sends through Kavenegar's REST API.
- Supports Kavenegar's approved VerifyLookup pattern when `KAVENEGAR_VERIFY_TEMPLATE` is set, or the standard SMS endpoint when a sender line is configured.
- Keeps the Kavenegar API key and webhook signing secret on the server; neither is included in the APK.

Kavenegar's official examples use the REST path `/v1/{API-KEY}/sms/send.json` with `receptor`, `sender`, and `message` parameters: [Kavenegar REST examples](https://kavenegar.github.io/kavenegar_fa/).

## Secrets

Add these GitHub Actions secrets:

- `KAVENEGAR_API_KEY`: private API key from the Kavenegar panel.
- `KAVENEGAR_SENDER`: a sender line permitted to send the OTP text; required when not using VerifyLookup.
- `KAVENEGAR_VERIFY_TEMPLATE`: optional approved Kavenegar verification template name. Prefer this when the Kavenegar account uses pattern-only service lines.
- `SEND_SMS_HOOK_SECRET`: the signing secret generated when the Supabase Auth Send SMS HTTP Hook is configured. Keep its complete `v1,whsec_...` value.

The manual Supabase Edge Function deployment workflow deploys this function and copies these values into Supabase Function secrets when all required credentials are present. If credentials are absent, the function remains deployed but cannot send OTP messages.

## One-time Supabase Dashboard setup

After deploying the function:

1. Open Supabase Dashboard → Authentication → Hooks.
2. Add a **Send SMS** hook and select **HTTP**.
3. Set the URL to `https://sptzdfopwkxdprtqjocw.supabase.co/functions/v1/kavenegar-send-sms`.
4. Copy the generated signing secret into GitHub Actions as `SEND_SMS_HOOK_SECRET`.
5. Run the manual Edge Function deployment workflow again so the signing secret is installed in Supabase Functions.
6. Enable the hook and test a real OTP to an Iranian number.

Do not enable the hook before the Kavenegar and signing secrets are configured. Keep Supabase Auth's OTP frequency limits and CAPTCHA protections enabled. SMS delivery is not free: Kavenegar charges according to the account's tariff and message type.
