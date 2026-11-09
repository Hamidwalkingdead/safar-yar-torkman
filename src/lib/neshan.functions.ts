import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { decodePolyline } from "./polyline";
import type { RouteResult } from "./geo";

const point = z.object({ lat: z.number().min(24).max(40.5), lng: z.number().min(43).max(64) });
const API = "https://api.neshan.org";

async function neshan(path: string): Promise<unknown> {
  const key = process.env["NESHAN_SERVICE_KEY"];
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(API + path, { headers: { "Api-Key": key }, signal: controller.signal });
    if (!res.ok) {
      console.error("Neshan request failed", path.split("?")[0], res.status);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error("Neshan request error", path.split("?")[0], e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const neshanRoute = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ origin: point, destination: point }).parse(d))
  .handler(async ({ data }): Promise<RouteResult> => {
    if (!process.env["NESHAN_SERVICE_KEY"]) return { ok: false, reason: "missing_key" };
    const o = data.origin, t = data.destination;
    const j = (await neshan(`/v4/direction?type=car&origin=${o.lat},${o.lng}&destination=${t.lat},${t.lng}`)) as {
      routes?: { overview_polyline?: { points?: string }; legs?: { distance?: { value?: number }; duration?: { value?: number } }[] }[];
    } | null;
    if (!j) return { ok: false, reason: "failed" };
    const r = j.routes?.[0];
    const legs = r?.legs ?? [];
    const meters = legs.reduce((s, l) => s + (l.distance?.value ?? 0), 0);
    const seconds = legs.reduce((s, l) => s + (l.duration?.value ?? 0), 0);
    if (!r || meters <= 0) return { ok: false, reason: "no_route" };
    return {
      ok: true,
      distanceKm: Math.max(1, Math.round(meters / 1000)),
      durationMinutes: Math.max(1, Math.round(seconds / 60)),
      geometry: r.overview_polyline?.points ? decodePolyline(r.overview_polyline.points) : [],
    };
  });

export const neshanReverse = createServerFn({ method: "POST" })
  .inputValidator((d) => point.parse(d))
  .handler(async ({ data }) => {
    const j = (await neshan(`/v5/reverse?lat=${data.lat}&lng=${data.lng}`)) as {
      city?: string; neighbourhood?: string; formatted_address?: string;
    } | null;
    return j?.city || j?.neighbourhood || j?.formatted_address || "";
  });

export const neshanSearch = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ q: z.string().trim().min(2).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const j = (await neshan(`/v1/search?term=${encodeURIComponent(data.q)}&lat=37.0&lng=54.8`)) as {
      items?: { location?: { x: number; y: number } }[];
    } | null;
    const loc = j?.items?.[0]?.location;
    return loc ? { lat: loc.y, lng: loc.x, name: data.q } : null;
  });

/** The web map key is browser-visible by design; it must be domain-restricted in the Neshan panel. */
export const neshanMapKey = createServerFn({ method: "GET" }).handler(
  async () => process.env["NESHAN_MAP_KEY"] ?? null,
);
