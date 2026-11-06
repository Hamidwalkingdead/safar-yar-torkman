import { useEffect, useRef, useState } from "react";
import type { Map as LMap, Marker } from "leaflet";
import type { Point } from "@/lib/geo";
import { neshanMapKey, neshanReverse, neshanSearch } from "@/lib/neshan.functions";

const NESHAN_SDK = "https://static.neshan.org/sdk/leaflet/v1.9.4/neshan-sdk/v1.0.8/index";
function loadNeshanSdk(): Promise<typeof import("leaflet") | null> {
  return new Promise((resolve) => {
    const w = window as unknown as { L?: typeof import("leaflet") };
    if (document.getElementById("neshan-sdk") && w.L) return resolve(w.L);
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = NESHAN_SDK + ".css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.id = "neshan-sdk";
    js.src = NESHAN_SDK + ".js";
    js.onload = () => resolve(w.L ?? null);
    js.onerror = () => resolve(null);
    document.head.appendChild(js);
  });
}

export type Place = Point & { name: string };
export async function reverseName(p: Point) {
  try {
    return (await neshanReverse({ data: p })) || "";
  } catch {
    return "";
  }
}
export async function searchPlace(q: string): Promise<Place | null> {
  try {
    return await neshanSearch({ data: { q } });
  } catch {
    return null;
  }
}

/** Select origin and destination using the Neshan map only. */
export function RouteMap({
  origin,
  destination,
  onPick,
  route,
  liveLocations = [],
  readOnly = false,
}: {
  origin: Place | null;
  destination: Place | null;
  route?: Point[] | null;
  liveLocations?: { lat: number; lng: number; label: string; role: "driver" | "passenger" }[];
  readOnly?: boolean;
  onPick: (which: "origin" | "destination", p: Point) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const marks = useRef<{ o?: Marker; d?: Marker }>({});
  const line = useRef<import("leaflet").Polyline | null>(null);
  const liveMarkers = useRef<Marker[]>([]);
  const L = useRef<typeof import("leaflet") | null>(null);
  const next = useRef<"origin" | "destination">("origin");
  const pick = useRef(onPick);
  pick.current = onPick;
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  next.current = !origin ? "origin" : !destination ? "destination" : next.current;

  useEffect(() => {
    let alive = true;
    void (async () => {
      let key: string | null = null;
      try { key = await neshanMapKey(); } catch { key = null; }
      if (!alive || !el.current || map.current) return;
      if (!key) {
        setMapError("کلید نقشه نشان تنظیم نشده است.");
        return;
      }
      const neshanL = await loadNeshanSdk();
      if (!alive || !el.current) return;
      if (!neshanL) {
        setMapError("بارگذاری نقشه نشان ناموفق بود؛ اتصال اینترنت را بررسی کنید.");
        return;
      }
      const lf = neshanL;
      let m: LMap;
      try {
        m = new (lf.Map as unknown as new (e: HTMLElement, o: Record<string, unknown>) => LMap)(el.current, {
          key, maptype: "neshan", poi: false, traffic: false, center: [37.0, 54.8], zoom: 7,
        });
      } catch {
        setMapError("راه‌اندازی نقشه نشان ناموفق بود؛ کلید نقشه و دامنه مجاز را بررسی کنید.");
        return;
      }
      L.current = lf;
      m.on("click", (e) => {
        if (readOnly) return;
        const which = next.current;
        pick.current(which, { lat: e.latlng.lat, lng: e.latlng.lng });
        next.current = which === "origin" ? "destination" : "origin";
      });
      map.current = m;
      setReady(true);
    })();
    return () => {
      alive = false;
      map.current?.remove();
      map.current = null;
    };
  }, [readOnly]);

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
    liveMarkers.current.forEach((marker) => marker.remove());
    liveMarkers.current = liveLocations.map((position) => {
      const color = position.role === "driver" ? "#2563eb" : "#16a34a";
      const icon = lf.divIcon({
        className: "",
        html: `<span style="display:flex;align-items:center;gap:5px;padding:4px 8px;border-radius:999px;background:white;border:2px solid ${color};box-shadow:0 1px 5px #0004;font-size:12px;font-weight:700;white-space:nowrap;color:#111"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${color}"></i>${position.label}</span>`,
        iconSize: [82, 28],
        iconAnchor: [41, 14],
      });
      return lf.marker([position.lat, position.lng], { icon }).addTo(m);
    });
    if (route && route.length > 1) {
      line.current = lf.polyline(route.map((p) => [p.lat, p.lng] as [number, number]), { color: "#2563eb", weight: 5, opacity: 0.85 }).addTo(m);
      m.fitBounds(line.current.getBounds(), { padding: [30, 30] });
    } else if (origin && destination)
      m.fitBounds([[origin.lat, origin.lng], [destination.lat, destination.lng]], { padding: [30, 30] });
    else if (liveLocations.length > 1)
      m.fitBounds(liveLocations.map((p) => [p.lat, p.lng] as [number, number]), { padding: [35, 35], maxZoom: 15 });
    else if (liveLocations.length === 1)
      m.setView([liveLocations[0].lat, liveLocations[0].lng], Math.max(m.getZoom(), 14));
    else if (origin ?? destination) {
      const p = (origin ?? destination)!;
      m.setView([p.lat, p.lng], Math.max(m.getZoom(), 9));
    }
  }, [origin, destination, route, liveLocations, ready]);

  return (
    <div className="relative overflow-hidden rounded-3xl">
      <div ref={el} className="h-64 w-full bg-muted" aria-label="نقشه انتخاب مبدأ و مقصد" />
      {mapError && <div role="alert" className="absolute inset-x-3 bottom-10 z-[600] rounded-xl bg-destructive p-3 text-sm text-destructive-foreground">{mapError}</div>}
      <span className="pointer-events-none absolute right-2 top-2 z-[500] rounded-full bg-card px-3 py-1 text-xs font-bold shadow">
        {!origin
          ? "روی نقشه، مبدأ را بزنید"
          : !destination
            ? "حالا مقصد را بزنید"
            : "برای تغییر، دوباره کلیک کنید"}
      </span>
      <span className="pointer-events-none absolute bottom-2 left-2 z-[500] rounded-full bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
        نقشه نشان
      </span>
    </div>
  );
}
