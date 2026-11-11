import { decodePolyline } from "./polyline";

/** Provider-independent geographic coordinate used by map and routing adapters. */
export type LatLng = { lat: number; lng: number };

export type InternalRoute = {
  points: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  provider: "neshan";
  fetchedAt: string;
};

export type PlaceResult = {
  name: string;
  coordinate: LatLng;
};

export interface RoutingProvider {
  getRoute(origin: LatLng, destination: LatLng): Promise<InternalRoute>;
}

export interface PlaceSearchProvider {
  search(query: string, near?: LatLng): Promise<PlaceResult | null>;
  reverseGeocode(point: LatLng): Promise<string>;
}

export function isIranPoint(value: unknown): value is LatLng {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return (
    typeof point.lat === "number" && Number.isFinite(point.lat) &&
    point.lat >= 24 && point.lat <= 40.5 &&
    typeof point.lng === "number" && Number.isFinite(point.lng) &&
    point.lng >= 43 && point.lng <= 64
  );
}

type DirectionResponse = {
  routes?: Array<{
    overview_polyline?: { points?: string };
    legs?: Array<{
      distance?: { value?: number };
      duration?: { value?: number };
    }>;
  }>;
};

/** Converts and validates Neshan's direction response into the app's stable model. */
export function parseNeshanRoute(payload: unknown, fetchedAt = new Date().toISOString()): InternalRoute | null {
  if (!payload || typeof payload !== "object") return null;
  const response = payload as DirectionResponse;
  const route = response.routes?.[0];
  const legs = route?.legs;
  if (!route || !Array.isArray(legs) || legs.length === 0) return null;

  let distanceMeters = 0;
  let durationSeconds = 0;
  for (const leg of legs) {
    const distance = leg.distance?.value;
    const duration = leg.duration?.value;
    if (!Number.isFinite(distance) || !Number.isFinite(duration) || distance! <= 0 || duration! < 0) {
      return null;
    }
    distanceMeters += distance!;
    durationSeconds += duration!;
  }
  if (
    !Number.isFinite(distanceMeters) || distanceMeters <= 0 || distanceMeters > 3_000_000 ||
    !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 172_800
  ) return null;

  let points: LatLng[] = [];
  const encoded = route.overview_polyline?.points;
  if (encoded !== undefined) {
    if (typeof encoded !== "string" || encoded.length > 200_000) return null;
    try {
      points = decodePolyline(encoded);
    } catch {
      return null;
    }
    if (points.length < 2 || points.some((point) => !isIranPoint(point))) return null;
  }

  return { points, distanceMeters, durationSeconds, provider: "neshan", fetchedAt };
}

/** Safely converts the first Neshan search result. */
export function parseNeshanPlace(payload: unknown, fallbackName: string): PlaceResult | null {
  if (!payload || typeof payload !== "object") return null;
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const item = items[0] as { location?: { x?: unknown; y?: unknown }; title?: unknown; address?: unknown };
  const coordinate = { lat: item.location?.y, lng: item.location?.x };
  if (!isIranPoint(coordinate)) return null;
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const address = typeof item.address === "string" ? item.address.trim() : "";
  return { coordinate, name: (title || address || fallbackName).slice(0, 160) };
}

/** Avoid exposing provider-specific reverse-geocoding fields to UI code. */
export function parseNeshanAddress(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const result = payload as { city?: unknown; neighbourhood?: unknown; formatted_address?: unknown };
  for (const value of [result.city, result.neighbourhood, result.formatted_address]) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 300);
  }
  return "";
}
