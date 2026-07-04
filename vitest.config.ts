import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 120_000, // certify runs a real physics sim; each test may take several seconds
  },
});
