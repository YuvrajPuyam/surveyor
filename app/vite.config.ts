import { defineConfig } from "vite";

/**
 * publicDir maps the repo's assets/ directory into the dev server root, so a
 * bundle saved at  assets/marble/<id>/  is reachable at  /marble/<id>/ .
 * The viewer also accepts a legacy "/assets/..." prefix and strips it.
 */
export default defineConfig({
  publicDir: "../assets",
  worker: { format: "es" },
  server: {
    // On this Windows setup chokidar misses tool-driven file writes — the
    // dev server then serves modules one edit behind (hours lost to testing
    // stale code). Polling is cheap at this project size and never lies.
    watch: { usePolling: true, interval: 300 },
  },
  build: {
    target: "es2022",
    // Rapier's embedded wasm + Spark are heavy; silence the size warning.
    chunkSizeWarningLimit: 4096,
    // Do NOT copy the multi-MB world bundles into dist/ — dev-server only.
    copyPublicDir: false,
  },
});
