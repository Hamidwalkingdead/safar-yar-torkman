import { useEffect, useRef, useState } from "react";
import type { Map as LMap, Marker } from "leaflet";
import { formatCoords, nextPick, type Point } from "@/lib/geo";
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
export async function searchPlace(q: string, center?: Point): Promise<Place | null> {
  try {
    return await neshanSearch({ data: { q, ...(center ? { center } : {}) } });
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
  onClear,
  onLocate,
  locating = false,
  initialCenter,
  initialZoom = 14,
  startFullScreen = false,
  pickTarget,
  onClose,
}: {
  onClear?: () => void;
  onLocate?: () => void;
  locating?: boolean;
  initialCenter?: Point;
  initialZoom?: number;
  startFullScreen?: boolean;
  pickTarget?: "origin" | "destination";
  onClose?: () => void;
  origin: Place | null;
  destination: Place | null;
  route?: Point[] | null;
  liveLocations?: { lat: number; lng: number; label: string; role: "driver" | "passenger" }[];
  readOnly?: boolean;
  onPick: (which: "origin" | "destination", p: Point, reset: boolean) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const marks = useRef<{ o?: Marker; d?: Marker }>({});
  const line = useRef<import("leaflet").Polyline | null>(null);
  const liveMarkers = useRef<Marker[]>([]);
  const L = useRef<typeof import("leaflet") | null>(null);
  const picked = useRef({ o: !!origin, d: !!destination });
  picked.current = { o: !!origin, d: !!destination };
  const [full, setFull] = useState(startFullScreen);
  const fullRef = useRef(false);
  fullRef.current = full;
  const locate = useRef(onLocate);
  locate.current = onLocate;
  const [offline, setOffline] = useState(false);
  const pick = useRef(onPick);
  pick.current = onPick;
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);
  useEffect(() => {
    const t = setTimeout(() => map.current?.invalidateSize(), 250);
    return () => clearTimeout(t);
  }, [full]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      let key: string | null = null;
      try { key = await neshanMapKey(); } catch { key = null; }
      if (!alive || !el.current || map.current) return;
      if (!key) {
        setMapError("کلید نقشه نشان (NESHAN_MAP_KEY) تنظیم نشده است؛ مبدأ و مقصد را تایپ کنید.");
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
          key, maptype: "neshan", poi: false, traffic: false, center: [initialCenter?.lat ?? 37.25, initialCenter?.lng ?? 55.17], zoom: initialZoom,
        });
      } catch {
        setMapError("راه‌اندازی نقشه نشان ناموفق بود؛ کلید نقشه و دامنه مجاز را بررسی کنید.");
        return;
      }
      L.current = lf;
      m.on("click", (e) => {
        if (readOnly) return;
        if (!fullRef.current) {
          setFull(true);
          locate.current?.();
          return;
        }
        m.setView([e.latlng.lat, e.latlng.lng], Math.max(m.getZoom(), 16), { animate: true });
        const next = pickTarget
          ? { which: pickTarget, reset: pickTarget === "origin" && !!picked.current.o }
          : nextPick(picked.current.o, picked.current.d);
        pick.current(next.which, { lat: e.latlng.lat, lng: e.latlng.lng }, next.reset);
        onClose?.();
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
    const m = map.current;
    if (m && initialCenter) m.setView([initialCenter.lat, initialCenter.lng], initialZoom, { animate: true });
  }, [initialCenter, initialZoom, ready]);

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
      m.setView([liveLocations[0]!.lat, liveLocations[0]!.lng], Math.max(m.getZoom(), 14));
    else if (origin ?? destination) {
      const p = (origin ?? destination)!;
      m.setView([p.lat, p.lng], Math.max(m.getZoom(), 9));
    }
  }, [origin, destination, route, liveLocations, ready]);

  const hint = readOnly ? null : !origin ? "لمس اول: مبدأ" : !destination ? "لمس دوم: مقصد" : "لمس دوباره: شروع مجدد";
  return (
    <div className={full ? "fixed inset-0 z-[1000] flex flex-col bg-background" : "relative overflow-hidden rounded-3xl"}>
      <div className="relative min-h-0 flex-1">
        <div ref={el} className={(full ? "h-full" : "h-72 sm:h-80") + " w-full bg-muted touch-none"} aria-label="نقشه انتخاب مبدأ و مقصد" />
        {(mapError || offline) && <div role="alert" className="absolute inset-x-3 bottom-12 z-[600] rounded-xl bg-destructive p-3 text-sm text-destructive-foreground">{offline ? "اتصال اینترنت قطع است؛ نقشه و مسیریابی تا اتصال دوباره کار نمی‌کنند." : mapError}</div>}
        {hint && <span className="pointer-events-none absolute right-2 top-2 z-[500] rounded-full bg-card px-3 py-1 text-xs font-bold shadow">{hint}</span>}
        {!readOnly && (
          <div className="absolute left-2 top-2 z-[500] flex flex-col gap-2">
            <button type="button" onClick={() => { if (onClose) onClose(); else setFull(false); }} className="rounded-full bg-card px-3 py-2 text-xs font-bold shadow">بستن نقشه</button>
            
            {onClear && (origin || destination) && <button type="button" onClick={onClear} className="rounded-full bg-card px-3 py-2 text-xs font-bold text-destructive shadow">پاک‌کردن</button>}
          </div>
        )}
        <span className="pointer-events-none absolute bottom-2 left-2 z-[500] rounded-full bg-card px-2 py-0.5 text-[10px] text-muted-foreground">نقشه نشان</span>
      </div>
      {!readOnly && (
        <div className="grid gap-1 bg-card p-3 text-xs">
          <p><b className="text-primary">● مبدأ:</b> {origin ? `${origin.name} (${formatCoords(origin)})` : "انتخاب نشده"}</p>
          <p><b className="text-accent-foreground">● مقصد:</b> {destination ? `${destination.name} (${formatCoords(destination)})` : "انتخاب نشده"}</p>
        </div>
      )}
    </div>
  );
}
