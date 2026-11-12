# Supabase Edge Function deployment

The Android application is a static Capacitor shell. It must call remote APIs directly; it must not depend on a TanStack Start server runtime at `capacitor://localhost/_serverFn`.

The following operations now use authenticated Supabase Edge Functions:

- `create-trip`: verifies the Supabase user, recalculates road distance with Neshan, then calls the existing transactional `create_trip` database RPC.
- `neshan-route`: returns verified road-route geometry for the map.
- `neshan-reverse`: resolves coordinates to a place name.
- `neshan-search`: resolves a search phrase to a coordinate.

Each function validates the caller's Supabase JWT. The database RPC continues to enforce authorization, fare, wallet, driver and profile rules. No service-role key is shipped to the app.

## Required secrets

Set these secrets in the Supabase project before using map and trip creation:

- `NESHAN_SERVICE_KEY`: server-only Neshan Directions / Search / Reverse key. Set it as a Supabase Edge Function secret; never expose it as a `VITE_*` variable.

Set these repository Actions secrets to enable the manual deployment and APK map build:

- `SUPABASE_ACCESS_TOKEN`: Supabase personal access token used only by the manual deployment workflow.
- `NESHAN_SERVICE_KEY`: copied by the deployment workflow into the Supabase Function secret store.
- `NESHAN_MAP_KEY`: browser map key. It is injected as `VITE_NESHAN_MAP_KEY` into the APK, so restrict it to the app's allowed origins in the Neshan console.

The Supabase project reference is already recorded in `supabase/config.toml`.

## Deploy

1. Add the secrets above in GitHub repository Settings → Secrets and variables → Actions.
2. Run the **Deploy Safar Yar Supabase Edge Functions** workflow manually from the branch you intend to deploy.
3. Confirm all four functions show as deployed in Supabase.
4. Verify the Neshan server key exists in Supabase Edge Function secrets.
5. Build a new Android APK and test sign-in, map search, route preview, and trip creation.

The deployment workflow is manual only. Database migrations are also manual-only and are not applied by this workflow.

## Important limits

- GitHub runner reachability does not prove the services work on Iranian mobile networks. Test with a SIM and Wi-Fi connection inside Iran.
- The browser map key is public by design; only the Neshan map key may be included in the APK. Never place `NESHAN_SERVICE_KEY`, Supabase service-role keys, or other private credentials in Vite variables.
- A successful APK build is not proof of a successful production backend deployment.
