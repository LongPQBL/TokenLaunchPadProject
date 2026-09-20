import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app's JSX uses the automatic runtime, so a test file needs no `import React`.
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    css: false,
  },
});
