import rtlTextPluginUrl from "@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js?url";

type RuntimeWithRtl = {
  setRTLTextPlugin?: (pluginUrl: string, lazy: boolean) => Promise<void>;
};

let mapLibreRuntimePromise: Promise<unknown | null> | null = null;

/**
 * Load the bundled MapLibre renderer only when a map is opened.
 * The renderer, CSS and RTL plugin are served by this app bundle, not a public CDN.
 */
export function loadMapLibre(): Promise<unknown | null> {
  if (!mapLibreRuntimePromise) {
    mapLibreRuntimePromise = (async () => {
      await import("maplibre-gl/dist/maplibre-gl.css");
      const module = await import("maplibre-gl");
      const runtime = (module.default ?? module) as unknown as RuntimeWithRtl;
      if (runtime.setRTLTextPlugin) {
        try {
          await runtime.setRTLTextPlugin(rtlTextPluginUrl, false);
        } catch (error) {
          // Keep the map usable if the optional RTL plugin fails; MapLibre has
          // built-in text shaping for many RTL labels.
          console.warn("[MapLibre] Bundled RTL plugin could not be initialized:", error);
        }
      }
      return runtime;
    })().catch((error) => {
      console.error("[MapLibre] Bundled renderer failed to load:", error);
      mapLibreRuntimePromise = null;
      return null;
    });
  }
  return mapLibreRuntimePromise;
}
