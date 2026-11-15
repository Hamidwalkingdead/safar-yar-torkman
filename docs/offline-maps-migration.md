# Offline map migration plan

## Decision

Replace the Neshan-only map stack with an OpenStreetMap-derived, MapLibre-based map for the three northern provinces (Golestan, Mazandaran, and Gilan). Keep the map archive separate from the APK so the initial app download remains small.

## Confirmed repository state

- The passenger picker currently loads the Neshan Leaflet SDK at runtime.
- Reverse geocoding and search call Supabase Edge Functions named `neshan-reverse` and `neshan-search`.
- Road distance and duration call `neshan-route`; the passenger flow currently blocks a trip request if route calculation fails.
- The Android project is a Capacitor 7 WebView app with three product flavors. There is no native MapLibre view/plugin yet.
- The current map component stores exact latitude/longitude alongside the resolved place name.

## Implementation constraints

1. Do not use the public OpenStreetMap tile server for bulk downloads, offline caching, or production tile hosting.
2. Build the regional archive from downloadable OSM source data (Geofabrik Iran extract) and retain OpenStreetMap attribution and ODbL notices.
3. A PMTiles archive is read-only map data; it does not provide address lookup or road routing.
4. For a downloaded archive, the app needs a reliable local range-request source. Capacitor's file URL conversion alone must not be assumed to support PMTiles range reads; validate this on Android before shipping.
5. Search/reverse geocoding and road routing must be implemented separately from map rendering. Never silently substitute straight-line distance for road distance.
6. Keep exact coordinates even when a Persian address cannot be resolved. Show an explicit address-unavailable state rather than inventing an address.
7. Each Android flavor has a separate private app sandbox. A shared map download across passenger/driver/admin apps must not be assumed.

## Delivery sequence

- Phase A: introduce and validate the MapLibre + PMTiles renderer and a small test archive in the Capacitor Android WebView.
- Phase B: generate a regional three-province archive from OSM source data and add download/version/progress/storage controls.
- Phase C: add offline place lookup and road routing using independently built OSM indexes/graphs.
- Phase D: test all three APK flavors and verify airplane-mode map display, address behavior, and route behavior on a physical Android device.

## Acceptance criteria

- Map opens centered on GPS or Gonbad-e-Kavus and supports the existing fixed-center pin interaction.
- A map archive can be downloaded once per installed app and displayed with no network connection.
- No Neshan SDK, key, or endpoint is required for the new map path.
- Address lookup and road routing report their own availability and never fabricate results.
- All three APK variants pass CI; physical-device offline testing is still required before calling the feature complete.
