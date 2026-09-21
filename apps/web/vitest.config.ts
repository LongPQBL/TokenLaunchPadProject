import path from "node:path";
import { defineConfig } from "vitest/config";

// Two environments, chosen by file extension: `.test.ts` runs in Node and `.test.tsx` runs in jsdom.
//
// The split exists because jsdom replaces AbortController with its own, while fetch stays Node's (undici), which
// refuses a signal from another realm. Anything that talks to the API through fetch, with MSW standing in for the
// server, must therefore run in Node; only rendering needs a DOM.
export default defineConfig({
  // The app's JSX uses the automatic runtime, so a test file needs no `import React`.
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["**/*.test.ts"],
          exclude: ["node_modules/**", ".next/**", ".next-demo/**"],
          setupFiles: ["./test/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["**/*.test.tsx"],
          exclude: ["node_modules/**", ".next/**", ".next-demo/**"],
          setupFiles: ["./test/setup.ts"],
          css: false,
        },
      },
    ],
  },
});
