export type Point = { lat: number; lng: number };
export type DrivingRoute = { distanceKm: number; durationMinutes: number; geometry: Point[] };
export type RouteResult =
  | ({ ok: true } & DrivingRoute)
  | { ok: false; reason: "missing_key" | "no_route" | "failed" };

/** Which point a map tap sets: 1st tap origin, 2nd destination, 3rd restarts from origin. */
export function nextPick(hasOrigin: boolean, hasDestination: boolean) {
  if (!hasOrigin) return { which: "origin" as const, reset: false };
  if (!hasDestination) return { which: "destination" as const, reset: false };
  return { which: "origin" as const, reset: true };
}

export function formatCoords(p: Point) {
  return `${p.lat.toFixed(5)}، ${p.lng.toFixed(5)}`.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!);
}

export function routeErrorMessage(reason: "missing_key" | "no_route" | "failed" | "offline") {
  switch (reason) {
    case "missing_key":
      return "کلید مسیریابی نشان (NESHAN_SERVICE_KEY) تنظیم نشده است؛ مسافت جاده‌ای قابل محاسبه نیست.";
    case "no_route":
      return "نشان مسیر جاده‌ای بین این دو نقطه پیدا نکرد؛ نقاط را جابه‌جا کنید.";
    case "offline":
      return "اتصال اینترنت برقرار نیست؛ مسیر جاده‌ای محاسبه نشد.";
    default:
      return "سرویس مسیریابی نشان پاسخ نداد؛ دوباره تلاش کنید.";
  }
}

export function isNightDeparture(iso: string) {
  if (!iso) return false;
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tehran", hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
  return h >= 22 || h < 6;
}
