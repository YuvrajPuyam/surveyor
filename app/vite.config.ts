import { defineConfig } from "vite";

/**
 * publicDir maps the repo's assets/ directory into the dev server root, so a
 * bundle saved at  assets/marble/<id>/  is reachable at  /marble/<id>/ .
 * The viewer also accepts a legacy "/assets/..." prefix and strips it.
 */
export default defineConfig({
  publicDir: "../assets",
  worker: { format: "es" },
  build: {
    target: "es2022",
    // Rapier's embedded wasm + Spark are heavy; silence the size warning.
    chunkSizeWarningLimit: 4096,
    // Do NOT copy the multi-MB world bundles into dist/ — dev-server only.
    copyPublicDir: false,
  },
});
