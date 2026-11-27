import { useCallback, useEffect, useRef, useState } from "react";
import { LocateFixed, MapPin, Minus, Plus, Search, X } from "lucide-react";
import type { Point } from "@/lib/geo";
import { mapirConfigurationReady, mapirReverseName, mapirSearchPlace } from "@/lib/mapir.functions";

type Place = Point & { name: string };
type MapEvent = { lngLat: { lat: number; lng: number } };
type MapMarker = {
  setLngLat: (coordinates: [number, number]) => MapMarker;
  addTo: (map: MapInstance) => MapMarker;
  remove: () => void;
};
type MapInstance = {
  on: (event: string, callback: (event: MapEvent | { error?: Error }) => void) => void;
  once: (event: string, callback: () => void) => void;
  remove: () => void;
  flyTo: (options: Record<string, unknown>) => void;
  easeTo: (options: Record<string, unknown>) => void;
  getCenter: () => { lat: number; lng: number };
  getZoom: () => number;
  getPitch: () => number;
  zoomIn: () => void;
  zoomOut: () => void;
  addSource: (id: string, source: Record<string, unknown>) => void;
  getSource: (id: string) => { setData: (data: unknown) => void } | undefined;
  addLayer: (layer: Record<string, unknown>) => void;
  getLayer: (id: string) => unknown;
  fitBounds: (bounds: [[number, number], [number, number]], options?: Record<string, unknown>) => void;
};
type MapLibreRuntime = {
  Map: new (options: Record<string, unknown>) => MapInstance;
  Marker: new (options?: Record<string, unknown>) => MapMarker;
  setRTLTextPlugin?: (pluginUrl: string, lazy: boolean) => Promise<void>;
};
declare global {
  interface Window {
    maplibregl?: MapLibreRuntime;
    __safarYarMapRtlReady?: Promise<boolean>;
  }
}

const RTL_TEXT_PLUGIN_URL = "https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js";
const RTL_TEXT_PLUGIN_FALLBACK_URL = "https://cdn.jsdelivr.net/npm/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js";

function enableMapLibreRtl(runtime: MapLibreRuntime): Promise<boolean> {
  if (!runtime.setRTLTextPlugin) return Promise.resolve(true);
  if (!window.__safarYarMapRtlReady) {
    window.__safarYarMapRtlReady = runtime.setRTLTextPlugin(RTL_TEXT_PLUGIN_URL, false)
      .then(() => true)
      .catch(async (firstError) => {
        console.warn("[PassengerMapirPicker] Primary RTL text plugin failed:", firstError);
        try {
          await runtime.setRTLTextPlugin!(RTL_TEXT_PLUGIN_FALLBACK_URL, false);
          return true;
        } catch (fallbackError) {
          console.warn("[PassengerMapirPicker] RTL text plugin fallback failed:", fallbackError);
          return false;
        }
      });
  }
  return window.__safarYarMapRtlReady;
}

// Lazy-load the renderer only when the passenger opens the location picker.
// The stylesheet is required for MapLibre's canvas sizing/positioning; do not
// report success when JS loaded but the CSS request silently failed.
let mapLibreLoading: Promise<boolean> | null = null;
function loadMapLibre(): Promise<boolean> {
  if (window.maplibregl) return enableMapLibreRtl(window.maplibregl);
  if (mapLibreLoading) return mapLibreLoading;
  mapLibreLoading = new Promise((resolve) => {
    const finish = (ok: boolean) => {
      if (!ok) mapLibreLoading = null;
      resolve(ok);
    };
    const loadCss = (index: number): void => {
      const candidates = [
        "https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.1/dist/maplibre-gl.css",
        "https://unpkg.com/maplibre-gl@5.24.1/dist/maplibre-gl.css",
      ];
      const href = candidates[index];
      if (!href) { finish(false); return; }
      const existing = document.getElementById("maplibre-gl-css") as HTMLLinkElement | null;
      if (existing?.href === href && existing.sheet) { loadScript(); return; }
      existing?.remove();
      const link = document.createElement("link");
      link.id = "maplibre-gl-css";
      link.rel = "stylesheet";
      link.href = href;
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        link.remove();
        loadCss(index + 1);
      }, 12000);
      link.onload = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        loadScript();
      };
      link.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        link.remove();
        loadCss(index + 1);
      };
      document.head.appendChild(link);
    };
    const loadScript = (): void => {
      if (window.maplibregl) { void enableMapLibreRtl(window.maplibregl).then(finish); return; }
      const candidates = [
        "https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.1/dist/maplibre-gl.js",
        "https://unpkg.com/maplibre-gl@5.24.1/dist/maplibre-gl.js",
      ];
      const existing = document.getElementById("maplibre-gl-js") as HTMLScriptElement | null;
      if (existing) {
        if (window.maplibregl) { finish(true); return; }
        existing.remove();
      }
      const loadCandidate = (index: number): void => {
        const source = candidates[index];
        if (!source) { finish(false); return; }
        const script = document.createElement("script");
        script.id = "maplibre-gl-js";
        script.src = source;
        let settled = false;
        const timeout = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          script.remove();
          loadCandidate(index + 1);
        }, 15000);
        script.onload = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          const runtime = window.maplibregl;
          if (!runtime) { finish(false); return; }
          void enableMapLibreRtl(runtime).then(finish);
        };
        script.onerror = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          script.remove();
          loadCandidate(index + 1);
        };
        document.head.appendChild(script);
      };
      loadCandidate(0);
    };
    loadCss(0);
  });
  return mapLibreLoading;
}

function markerElement(label: string, color: string): HTMLDivElement {
  const element = document.createElement("div");
  element.style.width = "24px";
  element.style.height = "24px";
  element.style.borderRadius = "50% 50% 50% 0";
  element.style.transform = "rotate(-45deg)";
  element.style.background = color;
  element.style.border = "3px solid white";
  element.style.boxShadow = "0 2px 10px rgba(0,0,0,.45)";
  element.title = label;
  return element;
}

function featureCollection(route: Point[]) {
  return {
    type: "FeatureCollection",
    features: route.length > 1 ? [{
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: route.map((point) => [point.lng, point.lat]),
      },
    }] : [],
  };
}

export function PassengerMapirPicker({
  origin,
  destination,
  route,
  onPick,
  onClear,
  initialCenter,
  initialZoom = 15,
  pickTarget,
  onClose,
}: {
  origin: Place | null;
  destination: Place | null;
  route?: Point[] | null;
  onPick: (which: "origin" | "destination", point: Point, reset: boolean, verifiedName?: string) => void;
  onClear?: () => void;
  initialCenter?: Point;
  initialZoom?: number;
  pickTarget: "origin" | "destination";
  onClose?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const selectedMarker = useRef<MapMarker | null>(null);
  const originMarker = useRef<MapMarker | null>(null);
  const destinationMarker = useRef<MapMarker | null>(null);
  const addressRequest = useRef(0);
  const mapReadyRef = useRef(false);
  const [selectedPoint, setSelectedPoint] = useState<Point | null>(null);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [is3D, setIs3D] = useState(true);

  const selectPoint = useCallback((point: Point, knownName = "") => {
    setSelectedPoint(point);
    setSelectedAddress(knownName);
    setError("");
    if (selectedMarker.current) selectedMarker.current.remove();
    const runtime = window.maplibregl;
    if (runtime && map.current) {
      selectedMarker.current = new runtime.Marker({ element: markerElement("محل انتخاب‌شده", "#f59e0b") })
        .setLngLat([point.lng, point.lat])
        .addTo(map.current);
    }
    const requestId = ++addressRequest.current;
    if (!knownName) {
      void mapirReverseName(point).then((name) => {
        if (requestId !== addressRequest.current) return;
        setSelectedAddress(name);
        if (!name) setError("نشانی این نقطه از سرویس مپ دریافت نشد؛ نقطه دیگری انتخاب کنید.");
      });
    }
  }, []);

  useEffect(() => {
    let alive = true;
    if (!mapirConfigurationReady()) {
      setLoading(false);
      setError("کلید رایگان مپ هنوز به برنامه اضافه نشده است (VITE_MAPIR_API_KEY).");
      return;
    }
    void loadMapLibre().then((loaded) => {
      if (!alive) return;
      if (!loaded || !container.current || !window.maplibregl) {
        setLoading(false);
        setError("بارگذاری موتور نقشه انجام نشد؛ دسترسی اینترنت به CDN نقشه را بررسی کنید.");
        return;
      }
      const runtime = window.maplibregl;
      const center = initialCenter ?? { lat: 37.25, lng: 55.17 };
      const apiKey = import.meta.env["VITE_MAPIR_API_KEY"]?.trim() ?? "";
      let instance: MapInstance;
      try {
        instance = new runtime.Map({
          container: container.current,
          style: "https://map.ir/vector/styles/main/mapir-style-dark.json",
          center: [center.lng, center.lat],
          zoom: initialZoom,
          pitch: 45,
          bearing: 0,
          attributionControl: true,
          dragRotate: true,
          pitchWithRotate: true,
          touchZoomRotate: true,
          // Map.ir may serve vector tiles, sprites and glyphs from subdomains.
          // Authenticate all Map.ir hosts, not only the apex map.ir domain.
          transformRequest: (url: string) => {
            try {
              const host = new URL(url).hostname.toLowerCase();
              if (host === "map.ir" || host.endsWith(".map.ir")) {
                return { url, headers: { "x-api-key": apiKey, "Mapir-SDK": "reactjs" } };
              }
            } catch {
              // Leave data/blob and non-HTTP URLs untouched.
            }
            return { url };
          },
        });
      } catch (cause) {
        console.error("[PassengerMapirPicker] MapLibre initialization failed:", cause);
        setLoading(false);
        setError("موتور نقشه روی این دستگاه راه‌اندازی نشد؛ نسخه WebView یا حافظه دستگاه را بررسی کنید.");
        return;
      }
      map.current = instance;
      const mapLoadTimeout = window.setTimeout(() => {
        if (!alive || mapReadyRef.current) return;
        setLoading(false);
        setError("نقشه در مهلت مقرر بارگذاری نشد؛ دریافت سبک یا کاشی‌های Map.ir ناموفق است.");
      }, 25000);
      instance.once("load", () => {
        if (!alive) return;
        window.clearTimeout(mapLoadTimeout);
        mapReadyRef.current = true;
        setReady(true);
        setLoading(false);
        setError("");
        instance.addSource("passenger-trip-route", {
          type: "geojson",
          data: featureCollection(route ?? []),
        });
        instance.addLayer({
          id: "passenger-trip-route-line",
          type: "line",
          source: "passenger-trip-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#f8fafc",
            "line-width": 5,
            "line-opacity": 0.95,
          },
        });
      });
      instance.on("click", (event) => {
        if (!("lngLat" in event)) return;
        selectPoint({ lat: event.lngLat.lat, lng: event.lngLat.lng });
      });
      instance.on("error", (event) => {
        if (!alive) return;
        const message = "error" in event ? event.error?.message : "";
        if (!message) return;
        // Keep tile failures visible even after the style's initial load event.
        // A loaded style with rejected vector tiles otherwise looks like a
        // successful, completely black map with no explanation.
        console.warn("[PassengerMapirPicker] MapLibre request failed:", message);
        if (!mapReadyRef.current) setLoading(false);
        setError(mapReadyRef.current
          ? "دریافت خیابان‌ها و کاشی‌های نقشه مپ ناموفق بود؛ دسترسی سرویس نقشه را بررسی می‌کنیم."
          : "سبک نقشه مپ بارگذاری نشد؛ کلید دسترسی یا اتصال سرویس را بررسی کنید.");
      });
    });
    return () => {
      alive = false;
      selectedMarker.current?.remove();
      originMarker.current?.remove();
      destinationMarker.current?.remove();
      map.current?.remove();
      map.current = null;
      mapReadyRef.current = false;
      setReady(false);
    };
    // Initial map instance is intentionally created once per picker opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    const source = instance.getSource("passenger-trip-route");
    source?.setData(featureCollection(route ?? []));
    if (originMarker.current) originMarker.current.remove();
    if (destinationMarker.current) destinationMarker.current.remove();
    const runtime = window.maplibregl;
    if (!runtime) return;
    if (origin) {
      originMarker.current = new runtime.Marker({ element: markerElement("مبدأ", "#16a34a") })
        .setLngLat([origin.lng, origin.lat]).addTo(instance);
    }
    if (destination) {
      destinationMarker.current = new runtime.Marker({ element: markerElement("مقصد", "#2563eb") })
        .setLngLat([destination.lng, destination.lat]).addTo(instance);
    }
  }, [origin, destination, route, ready]);

  useEffect(() => {
    if (!ready || !map.current || !initialCenter) return;
    map.current.flyTo({
      center: [initialCenter.lng, initialCenter.lat],
      zoom: initialZoom,
      duration: 650,
    });
    addressRequest.current += 1;
    setSelectedPoint(null);
    setSelectedAddress("");
    selectedMarker.current?.remove();
    selectedMarker.current = null;
  }, [initialCenter, initialZoom, pickTarget, ready]);

  async function handleSearch() {
    const query = searchText.trim();
    if (query.length < 2) {
      setError("نام مکان را کامل‌تر وارد کنید.");
      return;
    }
    setSearching(true);
    setError("");
    const center = map.current?.getCenter();
    const place = await mapirSearchPlace(query, center
      ? { lat: center.lat, lng: center.lng }
      : initialCenter ?? { lat: 37.25, lng: 55.17 });
    setSearching(false);
    if (!place) {
      setError("مکانی با این عبارت پیدا نشد؛ نام دیگری امتحان کنید.");
      return;
    }
    map.current?.flyTo({ center: [place.lng, place.lat], zoom: 17, duration: 700 });
    selectPoint(place, place.name);
  }

  function locatePhone() {
    if (!navigator.geolocation) {
      setError("موقعیت‌یابی در این دستگاه در دسترس نیست.");
      return;
    }
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        map.current?.flyTo({ center: [point.lng, point.lat], zoom: 17, duration: 700 });
        selectPoint(point);
        setLocating(false);
      },
      () => {
        setLocating(false);
        setError("مجوز مکان‌یابی را فعال کنید یا نقطه را دستی روی نقشه انتخاب کنید.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );
  }

  async function confirmSelection() {
    if (!selectedPoint) {
      setError("برای انتخاب، ابتدا یک نقطه از نقشه را لمس کنید.");
      return;
    }
    setConfirming(true);
    setError("");
    try {
      // Reverse geocoding is optional: a valid map coordinate must remain
      // selectable even when Map.ir's address endpoint is unavailable.
      const name = selectedAddress.trim() || await mapirReverseName(selectedPoint);
      onPick(
        pickTarget,
        selectedPoint,
        false,
        name.trim() || "محل نشانگر",
      );
    } catch (cause) {
      console.warn("[PassengerMapirPicker] Address lookup failed; saving coordinates:", cause);
      onPick(
        pickTarget,
        selectedPoint,
        false,
        "محل نشانگر",
      );
    } finally {
      setConfirming(false);
    }
  }

  function toggle3D() {
    const next = !is3D;
    setIs3D(next);
    map.current?.easeTo({ pitch: next ? 48 : 0, duration: 450 });
  }

  return (
    <div className="fixed inset-0 z-[1200] flex flex-col overflow-hidden bg-[#111820] text-white" dir="rtl">
      <div
        ref={container}
        className="absolute inset-0 h-full w-full"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: "100dvh" }}
        aria-label="نقشه مپ برای انتخاب مبدأ و مقصد"
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start gap-2 p-3">
        <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-[#17212c]/95 p-2 shadow-xl">
          <Search className="size-5 shrink-0 text-white/70" />
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void handleSearch(); }}
            placeholder="جستجوی شهر، خیابان یا مکان"
            className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-white outline-none placeholder:text-white/50"
          />
          <button type="button" onClick={() => void handleSearch()} disabled={searching} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold disabled:opacity-50">
            {searching ? "..." : "جستجو"}
          </button>
        </div>
        <button type="button" onClick={onClose} aria-label="بستن نقشه" className="pointer-events-auto flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#17212c]/95 shadow-xl">
          <X className="size-5" />
        </button>
      </div>

      <div className="pointer-events-none absolute left-3 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-2">
        <button type="button" onClick={() => map.current?.zoomIn()} disabled={!ready} aria-label="بزرگ‌نمایی" className="pointer-events-auto flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-[#17212c]/95 shadow-xl disabled:opacity-40">
          <Plus className="size-6" />
        </button>
        <button type="button" onClick={() => map.current?.zoomOut()} disabled={!ready} aria-label="کوچک‌نمایی" className="pointer-events-auto flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-[#17212c]/95 shadow-xl disabled:opacity-40">
          <Minus className="size-6" />
        </button>
        <button type="button" onClick={locatePhone} disabled={locating || !ready} aria-label="مکان‌یابی" className="pointer-events-auto flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-[#17212c]/95 shadow-xl disabled:opacity-40">
          <LocateFixed className="size-5" />
        </button>
        <button type="button" onClick={toggle3D} disabled={!ready} className="pointer-events-auto flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-[#17212c]/95 text-xs font-black shadow-xl disabled:opacity-40">
          {is3D ? "2D" : "3D"}
        </button>
      </div>

      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10">
        <div className="pointer-events-auto rounded-3xl border border-white/10 bg-[#17212c]/95 p-4 shadow-2xl backdrop-blur">
          <div className="mb-3 flex items-center gap-2">
            <MapPin className="size-5 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-white/60">{pickTarget === "origin" ? "در حال انتخاب مبدأ" : "در حال انتخاب مقصد"}</p>
              <p className="truncate text-sm font-bold">{selectedAddress || (selectedPoint ? "در حال دریافت نشانی…" : "نقشه را حرکت دهید و محل موردنظر را لمس کنید")}</p>
            </div>
            {onClear && (origin || destination) && <button type="button" onClick={onClear} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-red-200">پاک‌کردن</button>}
          </div>
          {error && <p role="alert" className="mb-3 rounded-xl bg-red-500/15 p-2 text-xs leading-6 text-red-200">{error}</p>}
          {!mapirConfigurationReady() && <p className="mb-3 rounded-xl bg-amber-500/15 p-2 text-xs leading-6 text-amber-100">کلید دسترسی رایگان مپ هنوز به نسخه برنامه اضافه نشده است.</p>}
          <button type="button" onClick={() => void confirmSelection()} disabled={!ready || !selectedPoint || confirming || loading} className="w-full rounded-2xl bg-emerald-600 py-4 text-sm font-black text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-40">
            {loading ? "در حال بارگذاری نقشه…" : confirming ? "در حال تأیید…" : "تأیید محل انتخاب‌شده"}
          </button>
        </div>
      </div>
      {loading && <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center bg-[#111820]/50"><div className="rounded-2xl bg-[#17212c] px-5 py-3 text-sm">در حال بارگذاری نقشه مپ…</div></div>}
      <div className="pointer-events-none absolute bottom-36 left-3 z-10 rounded-lg bg-[#17212c]/80 px-2 py-1 text-[10px] text-white/60">© Map.ir · © OpenStreetMap contributors</div>
    </div>
  );
}
