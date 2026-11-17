import { useEffect, useRef, useState } from "react";
import type { Point } from "@/lib/geo";

export type Place = Point & { name: string };

type LiveLocation = {
  lat: number;
  lng: number;
  label: string;
  role: "driver" | "passenger";
};

type MapMarker = {
  setLngLat: (coordinates: [number, number]) => MapMarker;
  addTo: (map: MapInstance) => MapMarker;
  remove: () => void;
};

type MapInstance = {
  once: (event: string, callback: () => void) => void;
  on: (event: string, callback: (event: { error?: Error }) => void) => void;
  remove: () => void;
  addSource: (id: string, source: Record<string, unknown>) => void;
  addLayer: (layer: Record<string, unknown>) => void;
  getSource: (id: string) => { setData: (data: unknown) => void } | undefined;
  fitBounds: (bounds: [[number, number], [number, number]], options?: Record<string, unknown>) => void;
  flyTo: (options: Record<string, unknown>) => void;
};

type MapLibreRuntime = {
  Map: new (options: Record<string, unknown>) => MapInstance;
  Marker: new (options?: Record<string, unknown>) => MapMarker;
};

declare global {
  interface Window { maplibregl?: MapLibreRuntime }
}

let mapLibreLoading: Promise<boolean> | null = null;
function loadMapLibre(): Promise<boolean> {
  if (window.maplibregl) return Promise.resolve(true);
  if (mapLibreLoading) return mapLibreLoading;
  mapLibreLoading = new Promise((resolve) => {
    const loadScript = () => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.1/dist/maplibre-gl.js";
      script.onload = () => resolve(!!window.maplibregl);
      script.onerror = () => {
        const fallback = document.createElement("script");
        fallback.src = "https://unpkg.com/maplibre-gl@5.24.1/dist/maplibre-gl.js";
        fallback.onload = () => resolve(!!window.maplibregl);
        fallback.onerror = () => { mapLibreLoading = null; resolve(false); };
        document.head.appendChild(fallback);
      };
      document.head.appendChild(script);
    };
    if (!document.getElementById("maplibre-gl-css")) {
      const link = document.createElement("link");
      link.id = "maplibre-gl-css";
      link.rel = "stylesheet";
      link.href = "https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.1/dist/maplibre-gl.css";
      link.onerror = () => {
        link.href = "https://unpkg.com/maplibre-gl@5.24.1/dist/maplibre-gl.css";
      };
      document.head.appendChild(link);
      link.onload = loadScript;
      window.setTimeout(() => {
        if (!window.maplibregl) loadScript();
      }, 5000);
    } else {
      loadScript();
    }
  });
  return mapLibreLoading;
}

function markerElement(label: string, role: "driver" | "passenger" | "origin" | "destination") {
  const element = document.createElement("div");
  element.title = label;
  element.style.width = "18px";
  element.style.height = "18px";
  element.style.borderRadius = "50%";
  element.style.border = "3px solid #fff";
  element.style.boxShadow = "0 1px 8px rgba(0,0,0,.65)";
  element.style.background = role === "driver" ? "#16a34a"
    : role === "origin" ? "#2563eb"
    : role === "destination" ? "#dc2626" : "#f59e0b";
  return element;
}

function routeCollection(route: Point[] | null | undefined) {
  return {
    type: "FeatureCollection",
    features: route && route.length > 1 ? [{
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: route.map((p) => [p.lng, p.lat]) },
    }] : [],
  };
}

/** Read-only live trip map rendered with Map.ir; no Neshan SDK or key is used. */
export function RouteMap({
  origin, destination, route, liveLocations = [], readOnly = true, initialCenter, initialZoom = 14,
}: {
  origin: Place | null;
  destination: Place | null;
  route?: Point[] | null;
  liveLocations?: LiveLocation[];
  readOnly?: boolean;
  initialCenter?: Point;
  initialZoom?: number;
  onPick?: (which: "origin" | "destination", p: Point, reset: boolean, verifiedName?: string) => void;
  onClear?: () => void;
  startFullScreen?: boolean;
  pickTarget?: "origin" | "destination";
  onClose?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const markers = useRef<MapMarker[]>([]);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    let instance: MapInstance | null = null;
    const apiKey = import.meta.env["VITE_MAPIR_API_KEY"]?.trim() ?? "";
    if (!apiKey) {
      setError("کلید نقشه مپ تنظیم نشده است.");
      return;
    }
    void loadMapLibre().then((loaded) => {
      if (!alive) return;
      if (!loaded || !container.current || !window.maplibregl) {
        setError("موتور نقشه بارگذاری نشد؛ اتصال اینترنت را بررسی کنید.");
        return;
      }
      const points = [origin, destination, ...liveLocations].filter(Boolean) as Array<Point>;
      const center = initialCenter ?? points[0] ?? { lat: 37.25, lng: 55.17 };
      try {
        instance = new window.maplibregl!.Map({
          container: container.current,
          style: "https://map.ir/vector/styles/main/mapir-style-dark.json",
          center: [center.lng, center.lat],
          zoom: initialZoom,
          attributionControl: true,
          transformRequest: (url: string) => {
            try {
              const host = new URL(url).hostname.toLowerCase();
              if (host === "map.ir" || host.endsWith(".map.ir")) {
                return { url, headers: { "x-api-key": apiKey, "Mapir-SDK": "reactjs" } };
              }
            } catch { /* non-http resources need no auth header */ }
            return { url };
          },
        });
        map.current = instance;
        instance.once("load", () => {
          if (!alive || !instance) return;
          instance.addSource("trip-route", { type: "geojson", data: routeCollection(route) });
          instance.addLayer({
            id: "trip-route-line",
            type: "line",
            source: "trip-route",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#60a5fa", "line-width": 5, "line-opacity": 0.95 },
          });
          setReady(true);
          setError("");
        });
        instance.on("error", (event) => {
          if (alive && event.error?.message) setError("دریافت نقشه مپ ناموفق بود؛ کلید یا اتصال سرویس را بررسی کنید.");
        });
      } catch {
        setError("راه‌اندازی نقشه مپ روی این دستگاه ناموفق بود.");
      }
    });
    return () => {
      alive = false;
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];
      instance?.remove();
      map.current = null;
    };
  // Map instance is created once per tracking view.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready || !window.maplibregl) return;
    instance.getSource("trip-route")?.setData(routeCollection(route));
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    const runtime = window.maplibregl;
    if (origin) markers.current.push(new runtime.Marker({ element: markerElement("مبدأ", "origin") }).setLngLat([origin.lng, origin.lat]).addTo(instance));
    if (destination) markers.current.push(new runtime.Marker({ element: markerElement("مقصد", "destination") }).setLngLat([destination.lng, destination.lat]).addTo(instance));
    for (const point of liveLocations) {
      markers.current.push(new runtime.Marker({ element: markerElement(point.label, point.role) }).setLngLat([point.lng, point.lat]).addTo(instance));
    }
    const points = [origin, destination, ...liveLocations].filter(Boolean) as Array<Point>;
    if (points.length > 1) {
      const lngs = points.map((p) => p.lng);
      const lats = points.map((p) => p.lat);
      instance.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 55, maxZoom: 15, duration: 500 });
    } else if (points[0]) {
      instance.flyTo({ center: [points[0].lng, points[0].lat], zoom: 15, duration: 500 });
    }
  }, [origin, destination, route, liveLocations, ready]);

  return <div className="relative h-72 w-full overflow-hidden rounded-2xl bg-[#111820]" aria-label="نقشه زنده سفر با مپ">
    <div ref={container} className="absolute inset-0 h-full w-full" />
    {error && <div role="alert" className="absolute inset-x-3 bottom-3 rounded-xl bg-destructive p-3 text-xs text-destructive-foreground">{error}</div>}
    {!ready && !error && <div className="absolute inset-x-3 bottom-3 rounded-xl bg-card/90 p-3 text-center text-xs">در حال بارگذاری نقشه…</div>}
  </div>;
}
