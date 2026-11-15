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

## Current implementation status (2026-11-15)

- Map rendering has been switched from the Neshan Leaflet SDK to MapLibre GL JS with a PMTiles protocol.
- The Android workflow downloads the MapLibre and PMTiles runtime files into the web assets and, after a successful map-pack workflow, downloads the northern Iran PMTiles artifact into `public/maps` before building the three APK flavors.
- The current map archive is approximately 113 MB; including it in each APK increases each app's download and installed size. A later improvement should move this to a one-time in-app download with version/progress/storage controls.
- Offline place/road name lookup reads nearby features from the vector tiles where available. Neshan reverse geocoding remains a connected fallback; full offline geocoding is not yet complete.
- Road distance and duration still use the existing Neshan route service. Offline routing is not implemented.
- A successful CI build is not proof of Android WebView range-request support; physical-device airplane-mode testing is still required.

## Remaining delivery sequence

- Phase A (implemented in source): MapLibre + PMTiles renderer and regional archive generation.
- Phase B: validate local PMTiles range reads in the Capacitor Android WebView, including airplane mode.
- Phase C: build a complete offline Persian geocoding index and offline road-routing graph from OSM data.
- Phase D: replace APK-bundled map data with a one-time downloadable, versioned map package if device storage and connectivity tests support it.

## Acceptance criteria

- Map opens centered on GPS or Gonbad-e-Kavus and supports the existing fixed-center pin interaction.
- A map archive can be downloaded once per installed app and displayed with no network connection.
- No Neshan SDK, key, or endpoint is required for the new map path.
- Address lookup and road routing report their own availability and never fabricate results.
- All three APK variants pass CI; physical-device offline testing is still required before calling the feature complete.
