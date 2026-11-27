import type { Point, DrivingRoute, RouteResult } from "./geo";

const BASE_URL = "https://map.ir";

function apiKey(): string {
  return import.meta.env["VITE_MAPIR_API_KEY"]?.trim() ?? "";
}

function headers(): HeadersInit {
  return {
    "x-api-key": apiKey(),
    "content-type": "application/json",
  };
}

function decodePolyline6(encoded: string): Point[] {
  const points: Point[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length && points.length < 20000) {
    const deltas: number[] = [];
    for (let axis = 0; axis < 2; axis++) {
      let result = 0;
      let shift = 0;
      let byte = 0;
      do {
        if (index >= encoded.length) return [];
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
        if (shift > 30) return [];
      } while (byte >= 0x20);
      deltas.push((result & 1) ? ~(result >> 1) : (result >> 1));
    }
    lat += deltas[0]!;
    lng += deltas[1]!;
    points.push({ lat: lat / 1e6, lng: lng / 1e6 });
  }
  return points;
}

export function mapirConfigurationReady(): boolean {
  return apiKey().length > 0;
}

export async function mapirReverseName(point: Point): Promise<string> {
  if (!apiKey()) return "";
  try {
    const params = new URLSearchParams({
      lat: String(point.lat),
      lon: String(point.lng),
    });
    const response = await fetch(`${BASE_URL}/reverse?${params}`, {
      method: "GET",
      headers: headers(),
    });
    if (!response.ok) return "";
    const payload = await response.json() as {
      address?: string;
      address_compact?: string;
      name?: string;
      poi?: string;
    };
    return (payload.poi || payload.address_compact || payload.address || payload.name || "").trim();
  } catch {
    return "";
  }
}

function findFarthestBoundaryPoint(value: unknown, center: Point): Point | null {
  const points: Point[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
        const lng = node[0];
        const lat = node[1];
        if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
          points.push({ lat, lng });
        }
        return;
      }
      node.forEach(visit);
      return;
    }
    const record = node as Record<string, unknown>;
    if (record.type === "Feature") visit(record.geometry);
    else if (record.type === "FeatureCollection") visit(record.features);
    else {
      visit(record.coordinates);
      visit(record.geometries);
      visit(record.geometry);
      visit(record.boundary);
      visit(record.Boundary);
    }
  };
  visit(value);
  if (!points.length) return null;
  const distanceSquared = (point: Point) => {
    const x = (point.lng - center.lng) * Math.cos(center.lat * Math.PI / 180);
    const y = point.lat - center.lat;
    return x * x + y * y;
  };
  return points.reduce((farthest, point) =>
    distanceSquared(point) > distanceSquared(farthest) ? point : farthest,
  );
}

export async function mapirSearchPlace(
  query: string,
  center: Point,
): Promise<(Point & { name: string; farthestBoundaryPoint?: Point | null }) | null> {
  if (!apiKey()) return null;
  try {
    const response = await fetch(`${BASE_URL}/search`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        text: query.trim(),
        returnid: true,
        location: {
          type: "Point",
          coordinates: [center.lng, center.lat],
        },
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as {
      value?: Array<{
        Title?: string;
        Text?: string;
        Address?: string;
        Coordinate?: { lat?: number; lon?: number };
        Geometry?: unknown;
        geometry?: unknown;
        Boundary?: unknown;
        boundary?: unknown;
      }>;
    };
    const item = payload.value?.find((entry) =>
      Number.isFinite(entry.Coordinate?.lat) && Number.isFinite(entry.Coordinate?.lon),
    );
    if (!item?.Coordinate) return null;
    return {
      lat: item.Coordinate.lat!,
      lng: item.Coordinate.lon!,
      name: (item.Title || item.Text || item.Address || query).trim(),
      farthestBoundaryPoint: findFarthestBoundaryPoint(
        item.Geometry ?? item.geometry ?? item.Boundary ?? item.boundary,
        { lat: item.Coordinate.lat!, lng: item.Coordinate.lon! },
      ),
    };
  } catch {
    return null;
  }
}

export async function mapirRoute({
  data,
}: {
  data: { origin: Point; destination: Point };
}): Promise<RouteResult> {
  if (!apiKey()) return { ok: false, reason: "missing_key" };
  try {
    const coordinates = [
      `${data.origin.lng},${data.origin.lat}`,
      `${data.destination.lng},${data.destination.lat}`,
    ].join(";");
    const params = new URLSearchParams({
      alternatives: "false",
      steps: "false",
      overview: "full",
      geometries: "polyline6",
    });
    const response = await fetch(
      `${BASE_URL}/routes/route/v1/driving/${coordinates}?${params}`,
      { method: "GET", headers: headers() },
    );
    if (!response.ok) return { ok: false, reason: "failed" };
    const payload = await response.json() as {
      code?: string;
      routes?: Array<{
        distance?: number;
        duration?: number;
        geometry?: string;
      }>;
    };
    const route = payload.routes?.[0];
    const meters = Number(route?.distance);
    const seconds = Number(route?.duration);
    const encodedGeometry = route?.geometry;
    if (
      !["ok", "Ok"].includes(payload.code || "") ||
      !Number.isFinite(meters) || meters <= 0 ||
      !Number.isFinite(seconds) || seconds <= 0 ||
      typeof encodedGeometry !== "string" || encodedGeometry.length < 2
    ) {
      return { ok: false, reason: "no_route" };
    }
    const geometry = decodePolyline6(encodedGeometry);
    if (geometry.length < 2) return { ok: false, reason: "no_route" };
    const result: DrivingRoute = {
      distanceKm: Math.max(1, Math.round(meters / 1000)),
      durationMinutes: Math.max(1, Math.round(seconds / 60)),
      geometry,
    };
    return { ok: true, ...result };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export function mapirRouteErrorMessage(reason: "missing_key" | "no_route" | "failed" | "offline"): string {
  switch (reason) {
    case "missing_key":
      return "کلید رایگان نقشه مپ تنظیم نشده است؛ تنظیمات VITE_MAPIR_API_KEY لازم است.";
    case "no_route":
      return "مپ برای این دو نقطه مسیر جاده‌ای پیدا نکرد؛ مبدأ یا مقصد را جابه‌جا کنید.";
    case "offline":
      return "اتصال اینترنت برقرار نیست؛ مسیر جاده‌ای محاسبه نشد.";
    default:
      return "سرویس مسیریابی مپ پاسخ نداد؛ اتصال و سهمیه روزانه را بررسی کنید.";
  }
}
