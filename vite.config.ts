// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  vite: {
    resolve: {
      alias: [
        {
          find: "@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js",
          replacement: resolve(projectRoot, "node_modules/@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js"),
        },
      ],
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // Generate a real client-side HTML shell for Capacitor; the SSR build alone
    // only emits assets and cannot be loaded as a native WebView entry point.
    spa: { enabled: true },
  },
});
