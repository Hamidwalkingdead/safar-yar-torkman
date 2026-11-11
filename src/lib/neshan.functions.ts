import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { RouteResult } from "./geo";
import {
  isIranPoint,
  parseNeshanAddress,
  parseNeshanPlace,
  parseNeshanRoute,
  type LatLng,
} from "./map-provider";

const pointSchema = z.object({
  lat: z.number().finite().min(24).max(40.5),
  lng: z.number().finite().min(43).max(64),
});
const API = "https://api.neshan.org";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_CACHE_ENTRIES = 200;
const memoryCache = new Map<string, { expiresAt: number; value: unknown }>();
const inFlight = new Map<string, Promise<unknown | null>>();

function remember(key: string, value: unknown, ttlMs: number) {
  if (memoryCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = memoryCache.keys().next().value as string | undefined;
    if (oldest) memoryCache.delete(oldest);
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function requestJson(path: string, cacheTtlMs = 0): Promise<unknown | null> {
  const key = process.env["NESHAN_SERVICE_KEY"];
  if (!key) return null;
  const cacheKey = `${path}`;
  const cached = memoryCache.get(cacheKey);
  if (cacheTtlMs > 0 && cached) {
    if (cached.expiresAt > Date.now()) return cached.value;
    memoryCache.delete(cacheKey);
  }
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const operation = (async () => {
    // One bounded retry for transient failures only. Do not retry client errors.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(`${API}${path}`, {
          headers: { "Api-Key": key, Accept: "application/json" },
          signal: controller.signal,
        });
        if ((response.status === 429 || response.status >= 500) && attempt === 0) {
          await response.body?.cancel().catch(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
        if (!response.ok) {
          console.warn("Neshan request failed", path.split("?")[0], response.status);
          return null;
        }
        let value: unknown;
        try {
          value = await response.json();
        } catch {
          console.warn("Neshan returned invalid JSON", path.split("?")[0]);
          return null;
        }
        if (cacheTtlMs > 0) remember(cacheKey, value, cacheTtlMs);
        return value;
      } catch {
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
        console.warn("Neshan request timed out or failed", path.split("?")[0]);
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  })();
  inFlight.set(cacheKey, operation);
  try {
    return await operation;
  } finally {
    inFlight.delete(cacheKey);
  }
}

const routePath = (origin: LatLng, destination: LatLng) =>
  `/v4/direction?type=car&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}`;

/** Server-side Neshan routing adapter; service credentials never enter the browser bundle. */
export const neshanRoute = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ origin: pointSchema, destination: pointSchema }).parse(data))
  .handler(async ({ data }): Promise<RouteResult> => {
    if (!process.env["NESHAN_SERVICE_KEY"]) return { ok: false, reason: "missing_key" };
    const payload = await requestJson(routePath(data.origin, data.destination));
    if (!payload) return { ok: false, reason: "failed" };
    const route = parseNeshanRoute(payload);
    if (!route) return { ok: false, reason: "no_route" };
    if (route.points.some((point) => !isIranPoint(point))) return { ok: false, reason: "no_route" };
    return {
      ok: true,
      distanceKm: Math.max(1, Math.round(route.distanceMeters / 1000)),
      durationMinutes: Math.max(1, Math.round(route.durationSeconds / 60)),
      geometry: route.points,
    };
  });

export const neshanReverse = createServerFn({ method: "POST" })
  .inputValidator((data) => pointSchema.parse(data))
  .handler(async ({ data }) => {
    const payload = await requestJson(`/v5/reverse?lat=${data.lat}&lng=${data.lng}`, 60_000);
    return parseNeshanAddress(payload);
  });

export const neshanSearch = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ q: z.string().trim().min(2).max(100) }).parse(data))
  .handler(async ({ data }) => {
    const center = { lat: 37.0, lng: 54.8 };
    const path = `/v1/search?term=${encodeURIComponent(data.q)}&lat=${center.lat}&lng=${center.lng}`;
    const payload = await requestJson(path, 30_000);
    const place = parseNeshanPlace(payload, data.q);
    return place ? { ...place.coordinate, name: place.name } : null;
  });

/** Browser-visible map key: restrict allowed origins in the Neshan dashboard. */
export const neshanMapKey = createServerFn({ method: "GET" }).handler(async () => {
  const key = process.env["NESHAN_MAP_KEY"]?.trim();
  return key && key.length <= 512 ? key : null;
});
