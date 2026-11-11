# Production readiness and external setup

## Changes already in the repository

- Android declares Internet, fine/coarse location, camera, media-image, legacy image-storage, and microphone permissions in `android/app/src/main/AndroidManifest.xml`.
- `drizzle/migrations/0021_driver_documents_storage_bucket.sql` creates or repairs the private `driver-documents` Supabase Storage bucket. It allows only the image MIME types used for driver verification and limits uploads to 8 MiB.
- Driver document object access remains governed by the owner/admin storage policies in the earlier migrations; do not make this bucket public.

## Required deployment steps

1. Configure the GitHub Actions secret `LOVABLE_DB_MIGRATION_URL` with the database migration connection string. The `Apply Safar Yar database migrations` workflow needs it to apply pending SQL migrations. Check that workflow's run before relying on the new bucket or database schema.
2. In Supabase Auth, configure and test an SMS provider for Iranian phone numbers and OTP delivery. A configured app key alone does not make SMS delivery available.
3. Set `NESHAN_MAP_KEY` and `NESHAN_SERVICE_KEY` in the deployment environment. Restrict the browser map key to the production app origins; keep the service key server-only. Test Neshan map tiles, search, reverse geocoding, and road directions from networks in Iran.
4. Configure the production Supabase URL and publishable key for both server and client builds. Never expose a service-role key in the browser or APK.
5. Create and test the required initial admin account/role through a trusted operator process. Do not grant admin roles from client-side code.
6. Configure a real payment gateway and its verified server-side callback before advertising online top-ups or bank settlement. The in-app wallet is not itself a payment gateway.
7. Build and install the APK on supported Android versions. Test the system location-permission prompt, current-position selection, active-trip tracking, camera/file picker uploads, microphone permission, and background/resume behavior on physical devices.
8. Create a separately signed release build and protect the signing key in CI secrets before distributing a production APK. The current debug APK workflow is for build verification, not a Play Store-ready signed release.

## Verification boundaries

A green CI/build proves the repository compiles and its automated checks pass; it does not prove external SMS, Neshan, payment, live Supabase migration, or physical-device behavior. Confirm each external integration in its provider dashboard and in an end-to-end staging test. Live user accounts and real payments should not be used for synthetic tests.
