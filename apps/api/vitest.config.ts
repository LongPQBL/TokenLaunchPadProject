import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    // Query tests share one database, so test files must not run in parallel with each other.
    fileParallelism: false,
  },
});
