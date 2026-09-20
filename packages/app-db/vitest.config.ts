import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    // These tests share one database, so they must not run in parallel with each other.
    fileParallelism: false,
  },
});
