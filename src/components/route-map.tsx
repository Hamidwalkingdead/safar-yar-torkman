import { useEffect, useRef, useState } from "react";
import type { Point } from "@/lib/geo";
import { LocateFixed, Search } from "lucide-react";
import { neshanReverse, neshanSearch } from "@/lib/neshan.functions";

type Place = Point & { name: string };
type LatLng = { lat: number; lng: number };
type Layer = { addTo: (map: NeshanMap) => Layer; remove: () => void };
type NeshanMap = {
  on: (event: string, cb: () => void) => void;
  getCenter: () => LatLng;
  getZoom: () => number;
  setView: (center: [number, number], zoom?: number) => void;
  setZoom: (zoom: number) => void;
  fitBounds: (bounds: [[number, number], [number, number]], options?: unknown) => void;
  invalidateSize: () => void;
  remove: () => void;
  setMapType?: (type: string) => void;
};
type NeshanLeaflet = {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => NeshanMap;
  marker: (position: [number, number], options?: Record<string, unknown>) => Layer;
  polyline: (positions: [number, number][], options?: Record<string, unknown>) => Layer;
};
declare global { interface Window { L?: NeshanLeaflet } }

let neshanSdk: Promise<boolean> | null = null;
function loadNeshanSdk(): Promise<boolean> {
  if (neshanSdk) return neshanSdk;
  neshanSdk = new Promise((resolve) => {
    const cssId = "neshan-leaflet-css";
    if (!document.getElementById(cssId)) {
      const link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = "https://static.neshan.org/sdk/leaflet/1.9.4/leaflet.css";
      document.head.appendChild(link);
    }
    const existing = document.getElementById("neshan-leaflet-js") as HTMLScriptElement | null;
    if (window.L) { resolve(true); return; }
    if (existing) {
      existing.addEventListener("load", () => resolve(!!window.L), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = "neshan-leaflet-js";
    script.src = "https://static.neshan.org/sdk/leaflet/1.9.4/leaflet.js";
    script.onload = () => resolve(!!window.L);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return neshanSdk;
}

export type { Place };
export async function reverseName(p: Point) {
  try { return (await neshanReverse({ data: p })) || ""; } catch { return ""; }
}
export async function searchPlace(q: string, center?: Point): Promise<Place | null> {
  try { return await neshanSearch({ data: { q, ...(center ? { center } : {}) } }); } catch { return null; }
}

/** Online Neshan map with address lookup and route overlays. */
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
  const map = useRef<NeshanMap | null>(null);
  const layers = useRef<Layer[]>([]);
  const pick = useRef(onPick); pick.current = onPick;
  const target = useRef(pickTarget); target.current = pickTarget;
  const [full, setFull] = useState(startFullScreen);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [offline, setOffline] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState("");
  const [centerAddress, setCenterAddress] = useState("");
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressError, setAddressError] = useState("");
  const [searchText, setSearchText] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const addressRequest = useRef(0);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    window.addEventListener("online", sync); window.addEventListener("offline", sync); sync();
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const apiKey = import.meta.env.VITE_NESHAN_MAP_KEY;
      if (!apiKey) { setMapError("کلید نقشه وب نشان (VITE_NESHAN_MAP_KEY) تنظیم نشده است."); return; }
      const ok = await loadNeshanSdk();
      if (!alive || !el.current) return;
      if (!ok || !window.L) { setMapError("بارگذاری نقشه نشان ناموفق بود؛ اتصال اینترنت را بررسی کنید."); return; }
      const m = new window.L.Map(el.current, {
        key: apiKey,
        center: [initialCenter?.lat ?? 37.25, initialCenter?.lng ?? 55.17],
        zoom: initialZoom,
        zoomControl: true,
        maptype: "dreamy",
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
          if (!name) setAddressError("نشانی این نقطه از نشان دریافت نشد؛ اتصال اینترنت یا کلید سرویس را بررسی کنید.");
        }).finally(() => { if (id === addressRequest.current) setAddressLoading(false); });
      });
      setReady(true);
    })();
    return () => { alive = false; layers.current.forEach(layer => layer.remove()); layers.current = []; map.current?.remove(); map.current = null; };
  }, [readOnly, initialCenter?.lat, initialCenter?.lng, initialZoom]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !window.L) return;
    layers.current.forEach(layer => layer.remove());
    layers.current = [];
    if (route?.length) layers.current.push(window.L.polyline(route.map(p => [p.lat, p.lng]), { color: "#2563eb", weight: 5 }).addTo(m));
    if (origin) layers.current.push(window.L.marker([origin.lat, origin.lng]).addTo(m));
    if (destination) layers.current.push(window.L.marker([destination.lat, destination.lng]).addTo(m));
    for (const p of liveLocations) layers.current.push(window.L.marker([p.lat, p.lng]).addTo(m));
    if (initialCenter) m.setView([initialCenter.lat, initialCenter.lng], initialZoom);
    else if (origin && destination) m.fitBounds([[Math.min(origin.lat, destination.lat), Math.min(origin.lng, destination.lng)], [Math.max(origin.lat, destination.lat), Math.max(origin.lng, destination.lng)]], { padding: [45, 45], maxZoom: 14 });
    else if (origin || destination) { const p = origin ?? destination!; m.setView([p.lat, p.lng], Math.max(m.getZoom(), 14)); }
  }, [origin, destination, route, liveLocations, ready, initialCenter, initialZoom]);

  useEffect(() => {
    if (map.current && ready) {
      const t = window.setTimeout(() => map.current?.invalidateSize(), 250);
      return () => window.clearTimeout(t);
    }
  }, [full, ready]);

  async function handleSearch() {
    const query = searchText.trim();
    if (query.length < 2) { setSearchError("نام مکان را کامل‌تر وارد کنید."); return; }
    setSearching(true); setSearchError("");
    const center = map.current?.getCenter();
    const result = await searchPlace(query, center ? { lat: center.lat, lng: center.lng } : initialCenter);
    setSearching(false);
    if (!result) { setSearchError("مکانی با این عبارت پیدا نشد؛ نام دیگری امتحان کنید."); return; }
    map.current?.setView([result.lat, result.lng], 17);
    setCenterAddress(result.name);
    setAddressError("");
  }

  function locatePhone() {
    setLocateError("");
    if (!navigator.geolocation) { setLocateError("موقعیت‌یابی در این دستگاه در دسترس نیست."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(pos => {
      map.current?.setView([pos.coords.latitude, pos.coords.longitude], 17); setLocating(false);
    }, () => { setLocating(false); setLocateError("مجوز مکان‌یابی گوشی را فعال کنید."); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
  }

  const hint = readOnly ? null : !origin ? "لمس اول: مبدأ" : !destination ? "لمس دوم: مقصد" : "انتخاب دوباره: شروع از مبدأ";
  return <div className={full ? "fixed inset-0 z-[1000] flex flex-col bg-background" : "relative overflow-hidden rounded-3xl"}>
    <div className="relative min-h-0 flex-1">
      <div ref={el} className={(full ? "h-full" : "h-72 sm:h-80") + " w-full bg-muted"} aria-label="نقشه آنلاین نشان برای انتخاب مبدأ و مقصد" />
      {!readOnly && <div className="pointer-events-none absolute left-1/2 top-1/2 z-[550] -translate-x-1/2 -translate-y-full flex flex-col items-center"><span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">{target.current === "destination" ? "مقصد" : "مبدأ"}</span><span className="h-7 w-7 -translate-y-1 rounded-full border-[5px] border-white bg-primary shadow-lg" /></div>}
      {(mapError || locateError) && <div role="alert" className="absolute inset-x-3 bottom-12 z-[600] rounded-xl bg-destructive p-3 text-sm text-destructive-foreground">{mapError || locateError}</div>}
      {hint && <span className="pointer-events-none absolute right-2 top-2 z-[500] rounded-full bg-card px-3 py-1 text-xs font-bold shadow">نقشه را حرکت دهید تا {target.current === "destination" ? "مقصد" : "مبدأ"} زیر نشانگر قرار بگیرد</span>}
      <div className="absolute left-2 top-2 z-[500] flex flex-col gap-2">
        <button type="button" onClick={locatePhone} disabled={locating} className="flex items-center gap-2 rounded-full bg-card px-3 py-2 text-xs font-bold shadow"><LocateFixed className="size-4" />{locating ? "یافتن موقعیت…" : "موقعیت من"}</button>
        {!readOnly && <><button type="button" onClick={() => { if (onClose) onClose(); else setFull(false); }} className="rounded-full bg-card px-3 py-2 text-xs font-bold shadow">بستن نقشه</button>{onClear && (origin || destination) && <button type="button" onClick={onClear} className="rounded-full bg-card px-3 py-2 text-xs font-bold text-destructive shadow">پاک‌کردن</button>}</>}
      </div>
      <span className="pointer-events-none absolute bottom-2 left-2 z-[500] rounded-full bg-card px-2 py-0.5 text-[10px] text-muted-foreground">نقشه نشان</span>
    </div>
    {!readOnly && <div className="z-[1100] grid gap-2 border-t bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-4px_20px_#0002]">
      <div className="text-xs text-muted-foreground">{target.current === "destination" ? "نقطه مقصد را زیر نشانگر قرار دهید" : "نقطه مبدأ را زیر نشانگر قرار دهید"}</div>
      <div className="flex gap-2">
        <input aria-label="جست‌وجوی مکان در نشان" value={searchText} onChange={(event) => setSearchText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void handleSearch(); } }} placeholder="نام شهر، خیابان یا مکان را جست‌وجو کنید" className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-3 text-sm" />
        <button type="button" onClick={() => void handleSearch()} disabled={searching || !ready} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold disabled:opacity-50"><Search className="size-4" />{searching ? "جست‌وجو…" : "جست‌وجو"}</button>
      </div>
      {searchError && <p role="alert" className="text-xs text-destructive">{searchError}</p>}
      <div className="min-h-11 rounded-xl bg-muted px-3 py-2 text-sm font-semibold">{addressLoading ? "در حال دریافت نشانی…" : centerAddress || "نشانی نقطه انتخاب‌شده"}</div>
      {addressError && <p role="alert" className="text-xs text-destructive">{addressError}</p>}
      {offline && <p className="text-xs text-amber-700">برای نمایش نقشه نشان و دریافت نشانی، اتصال اینترنت لازم است.</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => map.current?.setZoom(map.current.getZoom() + 1)} className="rounded-xl border px-4 py-3 text-sm font-bold">بزرگ‌نمایی</button>
        <button type="button" disabled={!ready || addressLoading} onClick={async () => {
          const m = map.current; if (!m || !ready || addressLoading) return;
          const c = m.getCenter(); const p = { lat: c.lat, lng: c.lng };
          setAddressLoading(true); setAddressError("");
          const name = (await reverseName(p)).trim();
          setAddressLoading(false);
          if (!name) { setAddressError("نشانی این نقطه از نشان دریافت نشد؛ اتصال اینترنت یا کلید سرویس را بررسی کنید."); return; }
          setCenterAddress(name); pick.current(target.current ?? "origin", p, false, name);
        }} className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-black text-primary-foreground shadow disabled:opacity-50">{addressLoading ? "در حال دریافت نشانی…" : `تأیید ${target.current === "destination" ? "مقصد" : "مبدأ"}`}</button>
      </div>
      <p className="text-[11px] text-muted-foreground">مبدأ: {origin?.name ?? "—"} · مقصد: {destination?.name ?? "—"}</p>
    </div>}
  </div>;
}
