import { useEffect, useRef, useState } from "react";
import type { Point } from "@/lib/geo";
import { LocateFixed } from "lucide-react";
import { neshanReverse, neshanSearch } from "@/lib/neshan.functions";

type Place = Point & { name: string };
type MapLibreMap = {
  on: (event: string, cb: () => void) => void;
  getCenter: () => { lat: number; lng: number };
  getZoom: () => number;
  setCenter: (p: [number, number]) => void;
  setZoom: (z: number) => void;
  addSource: (id: string, source: unknown) => void;
  getSource: (id: string) => { setData: (data: unknown) => void } | undefined;
  addLayer: (layer: unknown) => void;
  getLayer: (id: string) => unknown;
  fitBounds: (bounds: [[number, number], [number, number]], options?: unknown) => void;
  resize: () => void;
  remove: () => void;
};
type MapLibreGlobal = {
  Map: new (options: Record<string, unknown>) => MapLibreMap;
  addProtocol: (scheme: string, handler: unknown) => void;
};
type PmtilesGlobal = { Protocol: new () => { tile: unknown } };
declare global { interface Window { maplibregl?: MapLibreGlobal; pmtiles?: PmtilesGlobal } }

let mapLibraries: Promise<boolean> | null = null;
function loadOfflineMapLibraries(): Promise<boolean> {
  if (mapLibraries) return mapLibraries;
  mapLibraries = new Promise((resolve) => {
    const addCss = () => {
      if (!document.querySelector('link[data-offline-map-css]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "/vendor/maplibre-gl.css";
        link.dataset.offlineMapCss = "true";
        document.head.appendChild(link);
      }
    };
    const load = (id: string, src: string) => new Promise<void>((done) => {
      const existing = document.getElementById(id) as HTMLScriptElement | null;
      if (existing) { if (id === "maplibre-gl-js" && window.maplibregl || id === "pmtiles-js" && window.pmtiles) return done(); existing.addEventListener("load", () => done(), { once: true }); existing.addEventListener("error", () => done(), { once: true }); return; }
      const script = document.createElement("script");
      script.id = id; script.src = src; script.onload = () => done(); script.onerror = () => done();
      document.head.appendChild(script);
    });
    addCss();
    void (async () => {
      await load("maplibre-gl-js", "/vendor/maplibre-gl.js");
      await load("pmtiles-js", "/vendor/pmtiles.js");
      if (window.maplibregl && window.pmtiles) {
        const protocol = new window.pmtiles.Protocol();
        window.maplibregl.addProtocol("pmtiles", protocol.tile);
        resolve(true);
      } else resolve(false);
    })();
  });
  return mapLibraries;
}

export type { Place };
export async function reverseName(p: Point) {
  try { return (await neshanReverse({ data: p })) || ""; } catch { return ""; }
}
export async function searchPlace(q: string, center?: Point): Promise<Place | null> {
  try { return await neshanSearch({ data: { q, ...(center ? { center } : {}) } }); } catch { return null; }
}

/** Offline vector map of northern Iran. Address lookup remains a separate service. */
export function RouteMap({
  origin, destination, onPick, route, liveLocations = [], readOnly = false, onClear,
  initialCenter, initialZoom = 14, startFullScreen = false, pickTarget, onClose,
}: {
  onClear?: () => void; initialCenter?: Point; initialZoom?: number; startFullScreen?: boolean;
  pickTarget?: "origin" | "destination"; onClose?: () => void;
  origin: Place | null; destination: Place | null; route?: Point[] | null;
  liveLocations?: { lat: number; lng: number; label: string; role: "driver" | "passenger" }[];
  readOnly?: boolean;
  onPick: (which: "origin" | "destination", p: Point, reset: boolean, verifiedName?: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const pick = useRef(onPick); pick.current = onPick;
  const target = useRef(pickTarget); target.current = pickTarget;
  const [full, setFull] = useState(startFullScreen);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [offline, setOffline] = useState(!navigator.onLine);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState("");
  const [centerAddress, setCenterAddress] = useState("");
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressError, setAddressError] = useState("");
  const addressRequest = useRef(0);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    window.addEventListener("online", sync); window.addEventListener("offline", sync); sync();
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const ok = await loadOfflineMapLibraries();
      if (!alive || !el.current) return;
      if (!ok || !window.maplibregl) { setMapError("کتابخانهٔ نقشه در بستهٔ برنامه موجود نیست."); return; }
      const m = new window.maplibregl.Map({
        container: el.current,
        center: [initialCenter?.lng ?? 55.17, initialCenter?.lat ?? 37.25],
        zoom: initialZoom,
        minZoom: 4, maxZoom: 17,
        attributionControl: true,
        style: {
          version: 8,
          sources: { osm: { type: "vector", url: "pmtiles:///maps/northern-iran.pmtiles", attribution: "© OpenStreetMap contributors" } },
          layers: [
            { id: "background", type: "background", paint: { "background-color": "#e9eee8" } },
            { id: "water", type: "fill", source: "osm", "source-layer": "water", paint: { "fill-color": "#a9d5e8" } },
            { id: "landcover", type: "fill", source: "osm", "source-layer": "landcover", paint: { "fill-color": "#dce8d1", "fill-opacity": 0.55 } },
            { id: "landuse", type: "fill", source: "osm", "source-layer": "landuse", paint: { "fill-color": "#e5e8d5", "fill-opacity": 0.45 } },
            { id: "buildings", type: "fill", source: "osm", "source-layer": "building", minzoom: 13, paint: { "fill-color": "#d5cfc3", "fill-outline-color": "#b9b1a3" } },
            { id: "roads", type: "line", source: "osm", "source-layer": "transportation", paint: { "line-color": "#fffdf6", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 14, 4] } },
            { id: "major-roads", type: "line", source: "osm", "source-layer": "transportation", filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary"]]], paint: { "line-color": "#e7b66e", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.8, 14, 5] } },
          ],
        },
      });
      map.current = m;
      m.on("load", () => { if (alive) setReady(true); });
      m.on("moveend", () => {
        if (readOnly) return;
        const c = m.getCenter(); const p = { lat: c.lat, lng: c.lng };
        const id = ++addressRequest.current;
        setAddressLoading(true); setAddressError("");
        void reverseName(p).then(name => {
          if (id !== addressRequest.current) return;
          setCenterAddress(name);
          if (!name) setAddressError("برای تبدیل نقطه به نشانی، اینترنت و سرویس نشانی لازم است.");
        }).finally(() => { if (id === addressRequest.current) setAddressLoading(false); });
      });
    })();
    return () => { alive = false; map.current?.remove(); map.current = null; };
  }, [readOnly]);

  useEffect(() => { if (map.current && ready) { const t = window.setTimeout(() => map.current?.resize(), 250); return () => window.clearTimeout(t); } }, [full, ready]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const features: unknown[] = [];
    if (route?.length) features.push({ type: "Feature", properties: { kind: "route" }, geometry: { type: "LineString", coordinates: route.map(p => [p.lng, p.lat]) } });
    if (origin) features.push({ type: "Feature", properties: { kind: "origin" }, geometry: { type: "Point", coordinates: [origin.lng, origin.lat] } });
    if (destination) features.push({ type: "Feature", properties: { kind: "destination" }, geometry: { type: "Point", coordinates: [destination.lng, destination.lat] } });
    for (const p of liveLocations) features.push({ type: "Feature", properties: { kind: p.role, label: p.label }, geometry: { type: "Point", coordinates: [p.lng, p.lat] } });
    const data = { type: "FeatureCollection", features };
    if (!m.getSource("trip-data")) {
      m.addSource("trip-data", { type: "geojson", data });
      m.addLayer({ id: "trip-route", type: "line", source: "trip-data", filter: ["==", ["get", "kind"], "route"], paint: { "line-color": "#2563eb", "line-width": 5 } });
      m.addLayer({ id: "trip-points", type: "circle", source: "trip-data", filter: ["in", ["get", "kind"], ["literal", ["origin", "destination", "driver", "passenger"]]], paint: { "circle-radius": 8, "circle-color": ["match", ["get", "kind"], "origin", "#16a34a", "destination", "#dc2626", "driver", "#2563eb", "#9333ea"], "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
    } else m.getSource("trip-data")?.setData(data);
    if (initialCenter) m.setCenter([initialCenter.lng, initialCenter.lat]);
    else if (origin && destination) m.fitBounds([[Math.min(origin.lng, destination.lng), Math.min(origin.lat, destination.lat)], [Math.max(origin.lng, destination.lng), Math.max(origin.lat, destination.lat)]], { padding: 45, maxZoom: 14 });
    else if (origin || destination) { const p = origin ?? destination!; m.setCenter([p.lng, p.lat]); }
  }, [origin, destination, route, liveLocations, ready, initialCenter]);

  function locatePhone() {
    setLocateError("");
    if (!navigator.geolocation) { setLocateError("موقعیت‌یابی در این دستگاه در دسترس نیست."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(pos => {
      map.current?.setCenter([pos.coords.longitude, pos.coords.latitude]); map.current?.setZoom(17); setLocating(false);
    }, () => { setLocating(false); setLocateError("مجوز مکان‌یابی گوشی را فعال کنید."); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
  }

  const hint = readOnly ? null : !origin ? "لمس اول: مبدأ" : !destination ? "لمس دوم: مقصد" : "انتخاب دوباره: شروع از مبدأ";
  return <div className={full ? "fixed inset-0 z-[1000] flex flex-col bg-background" : "relative overflow-hidden rounded-3xl"}>
    <div className="relative min-h-0 flex-1">
      <div ref={el} className={(full ? "h-full" : "h-72 sm:h-80") + " w-full bg-muted"} aria-label="نقشه آفلاین انتخاب مبدأ و مقصد" />
      {!readOnly && <div className="pointer-events-none absolute left-1/2 top-1/2 z-[550] -translate-x-1/2 -translate-y-full flex flex-col items-center"><span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">{target.current === "destination" ? "مقصد" : "مبدأ"}</span><span className="h-7 w-7 -translate-y-1 rounded-full border-[5px] border-white bg-primary shadow-lg" /></div>}
      {(mapError || locateError) && <div role="alert" className="absolute inset-x-3 bottom-12 z-[600] rounded-xl bg-destructive p-3 text-sm text-destructive-foreground">{mapError || locateError}</div>}
      {hint && <span className="pointer-events-none absolute right-2 top-2 z-[500] rounded-full bg-card px-3 py-1 text-xs font-bold shadow">نقشه را حرکت دهید تا {target.current === "destination" ? "مقصد" : "مبدأ"} زیر نشانگر قرار بگیرد</span>}
      <div className="absolute left-2 top-2 z-[500] flex flex-col gap-2">
        <button type="button" onClick={locatePhone} disabled={locating} className="flex items-center gap-2 rounded-full bg-card px-3 py-2 text-xs font-bold shadow"><LocateFixed className="size-4" />{locating ? "یافتن موقعیت…" : "موقعیت من"}</button>
        {!readOnly && <><button type="button" onClick={() => { if (onClose) onClose(); else setFull(false); }} className="rounded-full bg-card px-3 py-2 text-xs font-bold shadow">بستن نقشه</button>{onClear && (origin || destination) && <button type="button" onClick={onClear} className="rounded-full bg-card px-3 py-2 text-xs font-bold text-destructive shadow">پاک‌کردن</button>}</>}
      </div>
      <span className="pointer-events-none absolute bottom-2 left-2 z-[500] rounded-full bg-card px-2 py-0.5 text-[10px] text-muted-foreground">نقشه آفلاین © OpenStreetMap</span>
    </div>
    {!readOnly && <div className="z-[1100] grid gap-2 border-t bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-4px_20px_#0002]">
      <div className="text-xs text-muted-foreground">{target.current === "destination" ? "نقطه مقصد را زیر نشانگر قرار دهید" : "نقطه مبدأ را زیر نشانگر قرار دهید"}</div>
      <div className="min-h-11 rounded-xl bg-muted px-3 py-2 text-sm font-semibold">{addressLoading ? "در حال دریافت نشانی…" : centerAddress || "نشانی آنلاین هنوز دریافت نشده است"}</div>
      {addressError && <p role="alert" className="text-xs text-destructive">{addressError}</p>}
      {offline && <p className="text-xs text-amber-700">نقشه از فایل آفلاین نمایش داده می‌شود؛ دریافت نشانی متنی به اینترنت نیاز دارد.</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => map.current?.setZoom(Math.max(map.current.getZoom() + 1, 17))} className="rounded-xl border px-4 py-3 text-sm font-bold">بزرگ‌نمایی</button>
        <button type="button" disabled={!ready || addressLoading} onClick={async () => {
          const m = map.current; if (!m || !ready || addressLoading) return;
          const c = m.getCenter(); const p = { lat: c.lat, lng: c.lng };
          setAddressLoading(true); setAddressError("");
          const name = (await reverseName(p)).trim();
          setAddressLoading(false);
          if (!name) { setAddressError("نشانی متنی این نقطه دریافت نشد. با اتصال اینترنت دوباره تلاش کنید."); return; }
          setCenterAddress(name); pick.current(target.current ?? "origin", p, false, name);
        }} className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-black text-primary-foreground shadow disabled:opacity-50">{addressLoading ? "در حال دریافت نشانی…" : `تأیید ${target.current === "destination" ? "مقصد" : "مبدأ"}`}</button>
      </div>
      <p className="text-[11px] text-muted-foreground">مبدأ: {origin?.name ?? "—"} · مقصد: {destination?.name ?? "—"}</p>
    </div>}
  </div>;
}
