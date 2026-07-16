import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 120_000, // certify runs a real physics sim; each test may take several seconds
    hookTimeout: 120_000, // beforeAll hooks run full certifications too
    // worktrees carry their own copy of this suite — running them from the
    // root doubles every test and times out under load
    exclude: ["**/node_modules/**", "**/.worktrees/**"],
  },
});
