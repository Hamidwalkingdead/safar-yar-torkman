# Driver dispatch and map architecture

## Decision

Use Neshan as the sole primary Iran map and road-routing provider. Keep the map SDK in the three clients, but keep all trusted route and fare decisions on the server. Do not use straight-line distance as the final pickup ETA or fare distance.

## Existing capabilities verified

- The passenger picker uses the Neshan Leaflet SDK and Neshan reverse geocoding.
- `neshan-route` calls Neshan Direction v4 and returns route geometry, distance, and duration.
- `create-trip` independently requests a Neshan road route before it calls the database RPC.
- `trips.km` is PostgreSQL `numeric`; the current `create_trip` RPC accepts `p_km numeric`.
- `trip_locations` stores the latest location only for participants in a pending or accepted trip. Its RLS does not provide idle-driver presence.
- Drivers currently see pending trips through the `permitted_trip_read` policy. There is no verified idle-driver online/presence table or automatic dispatch queue yet.
- Trip acceptance is already serialized by locking the trip row in `change_trip_status`, preventing two drivers from accepting the same trip.

## Map responsibilities

1. Neshan SDK: render the Iran map and allow map movement under a fixed center pin.
2. Device GPS: center the map on the passenger's current position at zoom 18 when permission is granted; keep manual map selection available if GPS fails.
3. Neshan Reverse: resolve the confirmed map center to a human-readable address. Keep the picker open if reverse geocoding fails.
4. Neshan Direction: compute road distance, duration, and geometry. Keep the exact meter value through server-side fare calculation; show a readable decimal-kilometer value in the UI.
5. Server trust boundary: never trust client-provided distance, duration, fare, driver ETA, or commission.

## Driver availability and dispatch — required next phase

The existing `trip_locations` table is intentionally scoped to active trips. It must not be repurposed for idle-driver discovery. Add a separate private `driver_presence` model in a migration, with at least:

- `driver_id` (primary key, references profiles)
- `latitude`, `longitude`, `accuracy_m`, `heading_deg`
- `is_online`, `last_seen_at`, `updated_at`

Only the driver may update their own presence; admins may inspect it. Other drivers and passengers must not be able to query raw presence rows. A server-side candidate RPC should return only the minimum offer data and must re-check that the driver is approved, has all required documents, is online with a fresh GPS point, is not already on an active trip, and is below the commission acceptance limit.

### Candidate ranking

- First, use a cheap geographic bounding-box/Haversine filter only to reduce the candidate set. It is not a route or ETA claim.
- For a small candidate batch, obtain road travel time from the driver's current point to the passenger pickup using a verified Neshan routing capability. Do not assume a Neshan matrix endpoint exists until its current official documentation or provider confirmation is obtained.
- Rank primarily by road ETA, then by time since last completed trip / fair rotation. Use driver rating and cancellation history as guardrails, not as a way to permanently starve new drivers.
- If road ETA is unavailable, show the offer as approximate and do not label straight-line distance as driving time.

### Offer strategy

Use a hybrid of automatic offers and a driver-visible request list:

1. Offer to the best small group of eligible drivers first.
2. Give each offer a short, configurable response window.
3. Expand to the next candidate group if no one accepts.
4. Expand the eligible ETA range gradually, especially for rural and intercity trips.
5. Keep the manual request list available as a fallback, sorted by road ETA when verified.
6. Use the existing atomic `change_trip_status` acceptance transaction as the final race-condition guard.

The first production values for group size, response window, and ETA expansion must be configurable and tuned from real Gonbad pilot data; do not hard-code assumptions from another city's density.

## Live tracking

- Keep `trip_locations` for the passenger and assigned driver only.
- Keep the existing foreground/background location service and 8-second write throttle as the starting point; tune battery use after device testing.
- Treat stale active-trip GPS as unavailable and display the last update time. Do not present an old location as live.
- Stop tracking after completion or cancellation.

## Rollout and validation

1. Keep passenger, driver, and admin apps as separate Android flavors over the shared backend.
2. Complete the fixed-pin map picker and precise route-distance change first.
3. Add private driver presence and RLS, then test with multiple driver accounts.
4. Add server-side ranked candidate retrieval and staged offers.
5. Test acceptance races, stale GPS, denied GPS permission, offline behavior, low driver density, and multiple simultaneous requests in Gonbad before enabling automatic dispatch by default.
