# Neshan online map architecture

## Decision

Use Neshan as the only map provider in the passenger, driver, and admin apps. Do not bundle offline map data or a second map renderer.

## Runtime architecture

- Map display: Neshan Leaflet Web SDK inside the Capacitor WebView.
- Browser map key: `VITE_NESHAN_MAP_KEY`, supplied at build time from the GitHub Actions secret `NESHAN_MAP_KEY`. This is a public web key and must be created as a Web map key in the Neshan platform.
- Search: `neshan-search` Supabase Edge Function.
- Reverse geocoding: `neshan-reverse` Supabase Edge Function.
- Driving route, distance, duration and route geometry: `neshan-route` Supabase Edge Function.
- The private `NESHAN_SERVICE_KEY` is used only inside Supabase Edge Functions. Never expose it in the app or GitHub build output.

## Map picker behavior

- Start at the device GPS location when permission is granted; otherwise use the last known/default center.
- The fixed center pin selects a point after the map is moved.
- First confirmation selects origin; second confirmation selects destination.
- Keep exact latitude/longitude and the verified Persian address together.
- Never invent an address or replace road distance with straight-line distance.
- Show clear loading, missing-key, network, and no-route errors.
- Markers and route geometry are drawn on the same Neshan map.

## Key setup

1. Create a Web map key in the Neshan platform and enable the Web map service.
2. Add that key to GitHub Actions secrets as `NESHAN_MAP_KEY`. The Android workflow injects it as `VITE_NESHAN_MAP_KEY`.
3. Add the Neshan Service key to Supabase Edge Function secrets as `NESHAN_SERVICE_KEY`.
4. Keep the two keys separate. Do not put the Service key in Vite variables, source code, or APK assets.
5. Verify the actual app origin / WebView behavior against the key's allowed-domain settings. If Neshan rejects requests, inspect the response status and key permissions rather than changing the key type.

## Security

- Search, reverse geocoding and routing require a signed-in Supabase user.
- Edge Functions validate input coordinates, apply database-backed rate limits, and read the private Service key from the function environment.
- Supabase publishable/anon keys are not substitutes for the Neshan Service key.
- Never commit real Neshan key values.

## Android build

The Android workflow builds the three app flavors from the web build. It does not download or bundle PMTiles, MapLibre, OpenStreetMap extracts, or offline map archives. The APK size therefore no longer includes the regional offline map package.

## Acceptance tests

- Map tiles load on a real Android device in Iran with mobile data / Wi-Fi.
- GPS centers the map and permission denial falls back cleanly.
- Origin and destination can be selected with the fixed center pin.
- Reverse geocoding returns a readable Persian address for both points.
- Search results move the map to the selected place.
- Route response includes road distance, duration, and decoded geometry.
- Passenger, driver, and admin APKs all load the same Neshan map implementation.
- Missing or invalid keys show actionable errors and never silently create a fake route.
