import { useEffect, useRef, useState } from "react";
import type { Map as LMap, Marker } from "leaflet";
import type { Point } from "@/lib/geo";
import { LocateFixed } from "lucide-react";
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
  initialCenter,
  initialZoom = 14,
  startFullScreen = false,
  pickTarget,
  onClose,
}: {
  onClear?: () => void;
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
  onPick: (which: "origin" | "destination", p: Point, reset: boolean, verifiedName?: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const marks = useRef<{ o?: Marker; d?: Marker }>({});
  const line = useRef<import("leaflet").Polyline | null>(null);
  const liveMarkers = useRef<Marker[]>([]);
  const phoneMarker = useRef<Marker | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const [full, setFull] = useState(startFullScreen);
  const target = useRef(pickTarget);
  target.current = pickTarget;
  const [offline, setOffline] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState("");
  const pick = useRef(onPick);
  pick.current = onPick;
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [centerAddress, setCenterAddress] = useState("");
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressError, setAddressError] = useState("");
  const addressRequest = useRef(0);
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
    let reverseTimer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      let key: string | null = null;
      try { key = await neshanMapKey(); } catch { key = null; }
      if (!alive || !el.current || map.current) return;
      if (!key) {
        setMapError("کلید نقشه نشان تنظیم نشده است؛ نقشه در دسترس نیست. تنظیمات اتصال نقشه باید بررسی شود.");
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
      m.on("moveend", () => {
        if (readOnly) return;
        const center = m.getCenter();
        const point = { lat: center.lat, lng: center.lng };
        if (reverseTimer) clearTimeout(reverseTimer);
        const requestId = ++addressRequest.current;
        setAddressLoading(true);
        setAddressError("");
        reverseTimer = setTimeout(() => {
          void reverseName(point).then((name) => {
            if (requestId !== addressRequest.current) return;
            setCenterAddress(name);
            if (!name) setAddressError("نشانی این نقطه از نشان دریافت نشد. نقشه را کمی جابه‌جا کنید یا دوباره تلاش کنید.");
          }).finally(() => { if (requestId === addressRequest.current) setAddressLoading(false); });
        }, 350);
      });
      map.current = m;
      setReady(true);
    })();
    return () => {
      alive = false;
      if (reverseTimer) clearTimeout(reverseTimer);
      phoneMarker.current?.remove();
      phoneMarker.current = null;
      map.current?.remove();
      map.current = null;
    };
  }, [readOnly]);

  useEffect(() => {
    const m = map.current;
    if (m && initialCenter) {
      m.setView([initialCenter.lat, initialCenter.lng], initialZoom, { animate: true });
      const requestId = ++addressRequest.current;
      setAddressLoading(true);
      setAddressError("");
      void reverseName(initialCenter).then((name) => {
        if (requestId !== addressRequest.current) return;
        setCenterAddress(name);
        if (!name) setAddressError("نشانی این نقطه از نشان دریافت نشد. دوباره تلاش کنید.");
      }).finally(() => { if (requestId === addressRequest.current) setAddressLoading(false); });
    }
  }, [initialCenter, initialZoom, ready]);

  function locatePhone() {
    setLocateError("");
    if (!navigator.geolocation) { setLocateError("موقعیت‌یابی در این دستگاه در دسترس نیست."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point: [number, number] = [position.coords.latitude, position.coords.longitude];
        const lf = L.current;
        const m = map.current;
        if (m && lf) {
          m.setView(point, 18, { animate: true });
          phoneMarker.current?.remove();
          const icon = lf.divIcon({ className: "", html: "<span style='display:block;width:18px;height:18px;border-radius:50%;background:#2563eb;border:4px solid white;box-shadow:0 0 0 3px #2563eb,0 1px 8px #0006'></span>", iconSize: [18,18], iconAnchor: [9,9] });
          phoneMarker.current = lf.marker(point, { icon, zIndexOffset: 1200 }).addTo(m);
        }
        setLocating(false);
      },
      () => { setLocating(false); setLocateError("دسترسی مکان گوشی داده نشد؛ مجوز مکان‌یابی را فعال کنید."); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );
  }

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
    if (route && route.length > 1 && !initialCenter) {
      line.current = lf.polyline(route.map((p) => [p.lat, p.lng] as [number, number]), { color: "#2563eb", weight: 5, opacity: 0.85 }).addTo(m);
      m.fitBounds(line.current.getBounds(), { padding: [30, 30] });
    } else if (origin && destination && !initialCenter)
      m.fitBounds([[origin.lat, origin.lng], [destination.lat, destination.lng]], { padding: [30, 30] });
    else if (liveLocations.length > 1)
      m.fitBounds(liveLocations.map((p) => [p.lat, p.lng] as [number, number]), { padding: [35, 35], maxZoom: 15 });
    else if (liveLocations.length === 1)
      m.setView([liveLocations[0]!.lat, liveLocations[0]!.lng], Math.max(m.getZoom(), 14));
    else if ((origin ?? destination) && !initialCenter) {
      const p = (origin ?? destination)!;
      m.setView([p.lat, p.lng], Math.max(m.getZoom(), 9));
    }
  }, [origin, destination, route, liveLocations, ready]);

  const hint = readOnly ? null : !origin ? "لمس اول: مبدأ" : !destination ? "لمس دوم: مقصد" : "لمس دوباره: شروع مجدد";
  return (
    <div className={full ? "fixed inset-0 z-[1000] flex flex-col bg-background" : "relative overflow-hidden rounded-3xl"}>
      <div className="relative min-h-0 flex-1">
        <div ref={el} className={(full ? "h-full" : "h-72 sm:h-80") + " w-full bg-muted touch-none"} aria-label="نقشه انتخاب مبدأ و مقصد" />
        {!readOnly && <div className="pointer-events-none absolute left-1/2 top-1/2 z-[550] -translate-x-1/2 -translate-y-full">
          <div className="relative flex flex-col items-center">
            <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground shadow-lg">{target.current === "destination" ? "مقصد" : "مبدأ"}</span>
            <span className="block h-7 w-7 -translate-y-1 rounded-full border-[5px] border-white bg-primary shadow-[0_2px_8px_#0008]" />
          </div>
        </div>}
        {(mapError || offline || locateError) && <div role="alert" className="absolute inset-x-3 bottom-12 z-[600] rounded-xl bg-destructive p-3 text-sm text-destructive-foreground">{offline ? "اتصال اینترنت قطع است؛ نقشه و مسیریابی تا اتصال دوباره کار نمی‌کنند." : mapError || locateError}</div>}
        {hint && <span className="pointer-events-none absolute right-2 top-2 z-[500] rounded-full bg-card px-3 py-1 text-xs font-bold shadow">نقشه را حرکت دهید تا {target.current === "destination" ? "مقصد" : "مبدأ"} زیر نشانگر قرار بگیرد</span> }
        <div className="absolute left-2 top-2 z-[500] flex flex-col gap-2">
          <button type="button" onClick={locatePhone} disabled={locating} aria-label="موقعیت زنده گوشی" className="flex items-center gap-2 rounded-full bg-card px-3 py-2 text-xs font-bold shadow disabled:opacity-60"><LocateFixed className="size-4" />{locating ? "یافتن موقعیت…" : "موقعیت من"}</button>
          {!readOnly && <div className="flex flex-col gap-2">
            <button type="button" onClick={() => { if (onClose) onClose(); else setFull(false); }} className="rounded-full bg-card px-3 py-2 text-xs font-bold shadow">بستن نقشه</button>
            {onClear && (origin || destination) && <button type="button" onClick={onClear} className="rounded-full bg-card px-3 py-2 text-xs font-bold text-destructive shadow">پاک‌کردن</button>}
          </div>}
        </div>
        <span className="pointer-events-none absolute bottom-2 left-2 z-[500] rounded-full bg-card px-2 py-0.5 text-[10px] text-muted-foreground">نقشه نشان</span>
      </div>
      {!readOnly && (
        <div className="z-[1100] grid gap-2 border-t bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-4px_20px_#0002]">
          <div className="text-xs text-muted-foreground">{target.current === "destination" ? "نقطه مقصد را دقیقاً زیر نشانگر قرار دهید" : "نقطه مبدأ را دقیقاً زیر نشانگر قرار دهید"}</div>
          <div className="min-h-11 rounded-xl bg-muted px-3 py-2 text-sm font-semibold">{addressLoading ? "در حال دریافت نشانی از نشان…" : centerAddress || "نشانی این نقطه هنوز دریافت نشده است"}</div>
          {addressError && <p role="alert" className="text-xs text-destructive">{addressError}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => { const m = map.current; if (m) { const c = m.getCenter(); setAddressError(""); setAddressLoading(true); m.setView([c.lat, c.lng], Math.max(m.getZoom(), 17), { animate: true }); const p = { lat: c.lat, lng: c.lng }; void reverseName(p).then((name) => { setCenterAddress(name); if (!name) setAddressError("نشانی از نشان دریافت نشد؛ دوباره تلاش کنید."); }).finally(() => setAddressLoading(false)); } }} className="rounded-xl border px-4 py-3 text-sm font-bold">دقیق‌تر</button>
            <button type="button" disabled={addressLoading} onClick={async () => {
              const m = map.current;
              if (!m || addressLoading) return;
              const c = m.getCenter();
              const p = { lat: c.lat, lng: c.lng };
              setAddressLoading(true);
              setAddressError("");
              const name = (await reverseName(p)).trim();
              setAddressLoading(false);
              if (!name) {
                setAddressError("بدون دریافت نشانی معتبر، این نقطه ثبت نمی‌شود. اتصال سرویس نشان را بررسی و دوباره تلاش کنید.");
                return;
              }
              setCenterAddress(name);
              pick.current(target.current ?? "origin", p, false, name);
            }} className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-black text-primary-foreground shadow disabled:opacity-50">{addressLoading ? "در حال دریافت نشانی…" : `تأیید ${target.current === "destination" ? "مقصد" : "مبدأ"}`}</button>
          </div>
          <p className="text-[11px] text-muted-foreground">مبدأ ثبت‌شده: {origin?.name ?? "—"} · مقصد ثبت‌شده: {destination?.name ?? "—"}</p>
        </div>
      )}
    </div>
  );
}
