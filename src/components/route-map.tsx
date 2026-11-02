import { useEffect, useRef, useState } from "react";
import type { Map as LMap, Marker } from "leaflet";
import type { Point } from "@/lib/geo";

export type Place = Point & { name: string };
const NOMINATIM = "https://nominatim.openstreetmap.org";

export async function reverseName(p: Point) {
  try {
    const r = await fetch(
      `${NOMINATIM}/reverse?format=json&accept-language=fa&zoom=12&lat=${p.lat}&lon=${p.lng}`,
    );
    const j = (await r.json()) as { address?: Record<string, string>; display_name?: string };
    const a = j.address ?? {};
    return (
      a["city"] ?? a["town"] ?? a["village"] ?? a["county"] ?? j.display_name?.split("،")[0] ?? ""
    );
  } catch {
    return "";
  }
}
export async function searchPlace(q: string): Promise<Place | null> {
  try {
    const r = await fetch(
      `${NOMINATIM}/search?format=json&accept-language=fa&countrycodes=ir&limit=1&q=${encodeURIComponent(q)}`,
    );
    const j = (await r.json()) as { lat: string; lon: string }[];
    const hit = j[0];
    return hit ? { lat: +hit.lat, lng: +hit.lon, name: q } : null;
  } catch {
    return null;
  }
}

/** Click once for origin, again for destination. Map tiles: OpenStreetMap. */
export function RouteMap({
  origin,
  destination,
  onPick,
  route,
}: {
  origin: Place | null;
  destination: Place | null;
  route?: Point[] | null;
  onPick: (which: "origin" | "destination", p: Point) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const marks = useRef<{ o?: Marker; d?: Marker }>({});
  const line = useRef<import("leaflet").Polyline | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const next = useRef<"origin" | "destination">("origin");
  const pick = useRef(onPick);
  pick.current = onPick;
  const [ready, setReady] = useState(false);
  next.current = !origin ? "origin" : !destination ? "destination" : next.current;

  useEffect(() => {
    let alive = true;
    void import("leaflet").then((mod) => {
      if (!alive || !el.current || map.current) return;
      const lf = (mod as unknown as { default?: typeof import("leaflet") }).default ?? mod;
      L.current = lf;
      const m = lf.map(el.current).setView([37.0, 54.8], 7);
      lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "© OpenStreetMap",
      }).addTo(m);
      m.on("click", (e) => {
        const which = next.current;
        pick.current(which, { lat: e.latlng.lat, lng: e.latlng.lng });
        next.current = which === "origin" ? "destination" : "origin";
      });
      map.current = m;
      setReady(true);
    });
    return () => {
      alive = false;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const lf = L.current,
      m = map.current;
    if (!lf || !m) return;
    const dot = (color: string) =>
      lf.divIcon({
        className: "",
        html: `<span style="display:block;width:18px;height:18px;border-radius:9999px;background:${color};border:3px solid white;box-shadow:0 0 0 2px ${color}"></span>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
    for (const [k, p, c] of [
      ["o", origin, "var(--primary)"],
      ["d", destination, "var(--accent)"],
    ] as const) {
      marks.current[k]?.remove();
      delete marks.current[k];
      if (p) marks.current[k] = lf.marker([p.lat, p.lng], { icon: dot(c) }).addTo(m);
    }
    line.current?.remove();
    line.current = null;
    if (route && route.length > 1) {
      line.current = lf.polyline(route.map((p) => [p.lat, p.lng] as [number, number]), { color: "#2563eb", weight: 5, opacity: 0.85 }).addTo(m);
      m.fitBounds(line.current.getBounds(), { padding: [30, 30] });
    } else if (origin && destination)
      m.fitBounds([[origin.lat, origin.lng], [destination.lat, destination.lng]], { padding: [30, 30] });
    else if (origin ?? destination) {
      const p = (origin ?? destination)!;
      m.setView([p.lat, p.lng], Math.max(m.getZoom(), 9));
    }
  }, [origin, destination, route, ready]);

  return (
    <div className="relative overflow-hidden rounded-3xl">
      <div ref={el} className="h-64 w-full bg-muted" aria-label="نقشه انتخاب مبدأ و مقصد" />
      <span className="pointer-events-none absolute right-2 top-2 z-[500] rounded-full bg-card px-3 py-1 text-xs font-bold shadow">
        {!origin
          ? "روی نقشه، مبدأ را بزنید"
          : !destination
            ? "حالا مقصد را بزنید"
            : "برای تغییر، دوباره کلیک کنید"}
      </span>
    </div>
  );
}
