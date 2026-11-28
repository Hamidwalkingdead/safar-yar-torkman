import { useCallback, useEffect, useRef, useState } from "react";
import { LocateFixed, MapPin, Minus, Plus, Search, X } from "lucide-react";
import type { Point } from "@/lib/geo";
import { mapirConfigurationReady, mapirReverseName, mapirSearchPlace } from "@/lib/mapir.functions";
import { loadMapLibre } from "@/lib/maplibre-runtime";
import { MapirAttribution } from "./mapir-attribution";

type Place = Point & { name: string; farthestBoundaryPoint?: Point | null };
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
  const runtimeRef = useRef<MapLibreRuntime | null>(null);
  const selectedMarker = useRef<MapMarker | null>(null);
  const originMarker = useRef<MapMarker | null>(null);
  const destinationMarker = useRef<MapMarker | null>(null);
  const addressRequest = useRef(0);
  const searchRequest = useRef(0);
  const mapReadyRef = useRef(false);
  const [selectedPoint, setSelectedPoint] = useState<Point | null>(null);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<Place | null>(null);
  const [locating, setLocating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [is3D, setIs3D] = useState(true);

  const selectPoint = useCallback((point: Point, knownName = "") => {
    setSelectedPoint(point);
    setSelectedAddress(knownName);
    setSearchResult(null);
    setError("");
    if (selectedMarker.current) selectedMarker.current.remove();
    const runtime = runtimeRef.current;
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
      const runtime = loaded as MapLibreRuntime | null;
      if (!runtime || !container.current) {
        setLoading(false);
        setError("موتور نقشه همراه برنامه بارگذاری نشد؛ برنامه را دوباره اجرا کنید.");
        return;
      }
      runtimeRef.current = runtime;
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
      runtimeRef.current = null;
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
    const runtime = runtimeRef.current;
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
    if (query.length < 2) return;
    const requestId = ++searchRequest.current;
    setSearching(true);
    setError("");
    const center = map.current?.getCenter();
    const place = await mapirSearchPlace(query, center
      ? { lat: center.lat, lng: center.lng }
      : initialCenter ?? { lat: 37.25, lng: 55.17 });
    if (requestId !== searchRequest.current) return;
    setSearching(false);
    if (!place) {
      setError("مکانی با این عبارت پیدا نشد؛ نام شهر، محله یا روستا را دقیق‌تر بنویسید.");
      return;
    }
    // Search result can be confirmed directly, including a village name.
    // Manual map tapping remains available as an alternative.
    addressRequest.current += 1;
    setSelectedPoint(null);
    setSelectedAddress("");
    setSearchResult(place);
    selectedMarker.current?.remove();
    selectedMarker.current = null;
    const normalized = query.replace(/[يى]/g, "ی");
    const isSubLocality = /محله|روستا|خیابان|کوچه|میدان|شهرک/.test(normalized) || normalized.split(/\s+/).length > 1;
    map.current?.flyTo({
      center: [place.lng, place.lat],
      zoom: isSubLocality ? 16.5 : 12.5,
      duration: 900,
    });
  }

  useEffect(() => {
    // Invalidate any older in-flight lookup as soon as the text changes.
    searchRequest.current += 1;
    setSearchResult(null);
    if (searchText.trim().length < 2) {
      setSearching(false);
      return;
    }
    const timer = window.setTimeout(() => { void handleSearch(); }, 650);
    return () => window.clearTimeout(timer);
    // Search is intentionally debounced as the passenger types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

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
    const searchPoint = searchResult
      ? (pickTarget === "destination" && searchResult.farthestBoundaryPoint ? searchResult.farthestBoundaryPoint : searchResult)
      : null;
    const pointToConfirm = selectedPoint ?? searchPoint;
    if (!pointToConfirm) {
      setError("برای انتخاب، ابتدا یک نتیجه جست‌وجو را تأیید کنید یا نقطه‌ای از نقشه را لمس کنید.");
      return;
    }
    setConfirming(true);
    setError("");
    try {
      // Activate the marker at the confirmed search result before saving it.
      if (searchResult && searchPoint) selectPoint(searchPoint, searchResult.name || "روستا");
      // Reverse geocoding is optional: a valid map coordinate must remain
      // selectable even when Map.ir's address endpoint is unavailable.
      const name = (searchResult?.name || selectedAddress.trim()) || await mapirReverseName(pointToConfirm);
      onPick(
        pickTarget,
        pointToConfirm,
        false,
        name.trim() || "محل نشانگر",
      );
    } catch (cause) {
      console.warn("[PassengerMapirPicker] Address lookup failed; saving coordinates:", cause);
      onPick(
        pickTarget,
        pointToConfirm,
        false,
        searchResult?.name || "محل نشانگر",
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
      <button type="button" onClick={onClose} aria-label="بستن نقشه" className="pointer-events-auto absolute right-3 top-3 z-10 flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-[#17212c]/90 shadow-xl backdrop-blur">
        <X className="size-5" />
      </button>

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

      <div className="pointer-events-none absolute inset-x-3 bottom-0 z-10 flex justify-center pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-[#17212c]/95 p-3 shadow-2xl backdrop-blur" style={{ maxHeight: "min(48dvh, 420px)" }}>
          <div className="mb-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2">
            <Search className="size-4 shrink-0 text-white/45" />
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void handleSearch(); }}
              placeholder="انتخاب دستی"
              aria-label="جست‌وجوی شهر، محله یا روستا"
              className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-white outline-none placeholder:text-white/40"
            />
            {searching && <span className="text-[11px] text-white/45">...</span>}
            <button type="button" onClick={() => void handleSearch()} disabled={searching || searchText.trim().length < 2} aria-label="جست‌وجوی مکان" className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white/80 disabled:opacity-40">برو</button>
          </div>
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
          <button type="button" onClick={() => void confirmSelection()} disabled={!ready || (!selectedPoint && !searchResult) || confirming || loading} className="sticky bottom-0 w-full rounded-2xl bg-emerald-600 py-4 text-sm font-black text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-40">
            {loading ? "در حال بارگذاری نقشه…" : confirming ? "در حال تأیید…" : searchResult ? "تأیید مقصد جست‌وجوشده" : "تأیید محل انتخاب‌شده"}
          </button>
        </div>
      </div>
      {loading && <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center bg-[#111820]/50"><div className="rounded-2xl bg-[#17212c] px-5 py-3 text-sm">در حال بارگذاری نقشه مپ…</div></div>}
      <MapirAttribution className="top-3 left-3 bottom-auto" />
    </div>
  );
}
