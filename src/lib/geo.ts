export type Point = { lat: number; lng: number };
/** Road distance is estimated from straight-line distance; no routing service is connected. */
export const ROAD_FACTOR = 1.3;
export function straightKm(a: Point, b: Point) {
  const r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat),
    dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
export function estimatedRoadKm(a: Point, b: Point) {
  return Math.max(1, Math.round(straightKm(a, b) * ROAD_FACTOR));
}
/** Night trip: departure between 22:00 and 05:59 Tehran time (same rule as the database). */
export function isNightDeparture(iso: string) {
  if (!iso) return false;
  const h = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tehran", hour: "2-digit", hourCycle: "h23" }).format(
      new Date(iso),
    ),
  );
  return h >= 22 || h < 6;
}
