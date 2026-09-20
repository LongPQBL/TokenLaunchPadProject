import { defineConfig } from "vitest/config";

// The end-to-end suite needs a live stack (an Anvil fork, a deployed launchpad, a running indexer
// and Postgres), so it is kept out of the default `vitest run` and started with `pnpm test:e2e`.
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.e2e.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
