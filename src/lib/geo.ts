export type Point = { lat: number; lng: number };
export const ROAD_FACTOR = 1.3;
export function straightKm(a: Point, b: Point) {
  const r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
export function estimatedRoadKm(a: Point, b: Point) {
  return Math.max(1, Math.round(straightKm(a, b) * ROAD_FACTOR));
}
export type DrivingRoute = { distanceKm: number; durationMinutes: number; geometry: Point[] };
export async function getDrivingRoute(a: Point, b: Point): Promise<DrivingRoute | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const coords = `${a.lng},${a.lat};${b.lng},${b.lat}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const data = await response.json() as { code?: string; routes?: { distance: number; duration: number; geometry?: { coordinates: [number, number][] } }[] };
    const route = data.code === "Ok" ? data.routes?.[0] : undefined;
    if (!route || !Number.isFinite(route.distance) || route.distance <= 0) return null;
    return { distanceKm: Math.max(1, Math.round(route.distance / 1000)), durationMinutes: Math.max(1, Math.round(route.duration / 60)), geometry: (route.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng })) };
  } catch { return null; } finally { clearTimeout(timeout); }
}
export function isNightDeparture(iso: string) {
  if (!iso) return false;
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tehran", hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
  return h >= 22 || h < 6;
}
