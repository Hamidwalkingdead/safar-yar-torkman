# Neshan map architecture

## Platform-specific rendering

- Android passenger, driver, and admin APKs use the official Neshan Android SDK based on MapLibre Native (`org.neshan.maplibre:android-sdk-opengl:13.4.1`).
- The Capacitor plugin `NeshanNativeMap` opens the native MapView picker. It returns the selected map-center latitude/longitude to the shared React map component.
- The browser/PWA fallback continues to use the Neshan Leaflet Web SDK. Native Android picker flows do not load the Leaflet renderer.
- The same shared React component handles address resolution, search, route requests, and trip state for all three app flavors.

## Android SDK configuration

- Android uses a dedicated Neshan Android SDK key, not the Web map key and never a private Service key.
- Store the Android SDK key in GitHub Actions as `NESHAN_ANDROID_MAP_KEY` (or the legacy secret name `NESHAN_MOBILE_KEY`).
- Gradle injects this value through the Android manifest placeholder `neshanAndroidMapKey` as `org.maplibre.android.API_KEY`.
- The SDK dependency is published on Maven Central; `mavenCentral()` is already configured in the Android project.
- Internet permission is declared in the Android manifest.
- The native picker uses the official Neshan light style URL and forwards selected coordinates to the React app.
- Do not put an Android SDK key or any Service key in source code.

## Web map key

- Browser map key: `VITE_NESHAN_MAP_KEY`, supplied at build time from GitHub Actions secret `NESHAN_MAP_KEY`.
- This is a Web map key and remains only for browser/PWA rendering. It is not substituted for the Android SDK key.

## Search, reverse geocoding, and road routing

- Search: `neshan-search` Supabase Edge Function.
- Reverse geocoding: `neshan-reverse` Supabase Edge Function.
- Driving route, road distance, duration, and route geometry: `neshan-route` Supabase Edge Function.
- Private Service keys are stored only in Supabase Edge Function secrets: `NESHAN_ROUTE_KEY`, `NESHAN_REVERSE_KEY`, and `NESHAN_SEARCH_KEY`. Each function may use `NESHAN_SERVICE_KEY` as a server-side fallback where configured.
- The reverse-geocoding function permits guest map selection with an IP rate limit so anonymous passengers can resolve a selected point.
- The routing function requires a valid Supabase session and applies rate limiting.

## Map picker behavior

- The native Android picker starts at the supplied GPS/default center.
- A fixed center pin remains in place while the map moves beneath it.
- The first confirmation selects origin; the next selection selects destination; a third selection restarts at origin through the existing trip state.
- The plugin returns exact coordinates; the shared app resolves and stores the verified Persian address. It never invents an address.
- Search results and GPS positioning update the next native picker starting center.
- Road distance and duration come only from Neshan Directions, never straight-line calculations.

## Acceptance tests

- All three Android flavors package the Neshan MapLibre SDK and the registered Capacitor plugin.
- Android manifest contains `org.maplibre.android.API_KEY` populated from the dedicated Android key.
- On a real Android device in Iran, map tiles load and the native picker returns the selected center coordinates.
- GPS/search-selected centers are passed into the native picker.
- Reverse geocoding returns a readable Persian address for both trip points.
- Route response includes road distance, duration, and decoded geometry.
- Browser/PWA fallback continues to load the Neshan Web map.
- Missing/invalid keys show actionable build/runtime errors and never create a fake route.
