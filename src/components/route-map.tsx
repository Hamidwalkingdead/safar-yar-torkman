import { useEffect, useRef, useState } from "react";
import type { Point } from "@/lib/geo";
import { loadMapLibre } from "@/lib/maplibre-runtime";
import { MapirAttribution } from "./mapir-attribution";

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
  setRTLTextPlugin?: (pluginUrl: string, lazy: boolean) => Promise<void>;
};

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
  origin, destination, route, liveLocations = [], initialCenter, initialZoom = 14, className = "h-72",
}: {
  origin: Place | null;
  destination: Place | null;
  route?: Point[] | null;
  liveLocations?: LiveLocation[];
  readOnly?: boolean;
  initialCenter?: Point;
  initialZoom?: number;
  className?: string;
  onPick?: (which: "origin" | "destination", p: Point, reset: boolean, verifiedName?: string) => void;
  onClear?: () => void;
  startFullScreen?: boolean;
  pickTarget?: "origin" | "destination";
  onClose?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const runtimeRef = useRef<MapLibreRuntime | null>(null);
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
      const runtime = loaded as MapLibreRuntime | null;
      if (!runtime || !container.current) {
        setError("موتور نقشه همراه برنامه بارگذاری نشد؛ برنامه را دوباره اجرا کنید.");
        return;
      }
      runtimeRef.current = runtime;
      const points = [origin, destination, ...liveLocations].filter(Boolean) as Array<Point>;
      const center = initialCenter ?? points[0] ?? { lat: 37.25, lng: 55.17 };
      try {
        instance = new runtime.Map({
          container: container.current,
          style: "https://map.ir/vector/styles/main/mapir-style-dark.json",
          center: [center.lng, center.lat],
          zoom: initialZoom,
          pitch: 48,
          bearing: -12,
          maxPitch: 60,
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
      runtimeRef.current = null;
    };
  // Map instance is created once per tracking view.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = map.current;
    const runtime = runtimeRef.current;
    if (!instance || !ready || !runtime) return;
    instance.getSource("trip-route")?.setData(routeCollection(route));
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
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

  return <div className={`relative ${className} w-full overflow-hidden rounded-2xl bg-[#111820]`} aria-label="نقشه زنده سفر با مپ">
    <div ref={container} className="absolute inset-0 h-full w-full" />
    <MapirAttribution className="top-2 left-2 bottom-auto" />
    {error && <div role="alert" className="absolute inset-x-3 bottom-3 rounded-xl bg-destructive p-3 text-xs text-destructive-foreground">{error}</div>}
    {!ready && !error && <div className="absolute inset-x-3 bottom-3 rounded-xl bg-card/90 p-3 text-center text-xs">در حال بارگذاری نقشه…</div>}
  </div>;
}
