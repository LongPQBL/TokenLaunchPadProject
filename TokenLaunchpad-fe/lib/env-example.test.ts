import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const text = (file: string) => readFileSync(path.join(root, file), "utf8");
const documented = new Set([...text(".env.example").matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!));

const sources = (dir: string): string[] =>
  readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) return sources(rel);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [rel] : [];
  });
const appSources = [...sources("app"), ...sources("components"), ...sources("lib"), "proxy.ts", "next.config.ts"];
// (Comments are left out: they mention `process.env.NEXT_PUBLIC_X` as an example of what Next inlines.)
const code = (file: string) => text(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = new Set(appSources.flatMap((f) => [...code(f).matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+|DEPLOYMENT|NEXT_DIST_DIR|API_PROXY_TARGET)\b/g)].map((m) => m[1]!)));
// (NEXT_PUBLIC_DEPLOYMENT is written by next.config.ts from DEPLOYMENT, not set by a person)
read.delete("NEXT_PUBLIC_DEPLOYMENT");

describe("the frontend's .env.example", () => {
  it("mentions every variable the app reads, and nothing it does not", () => {
    expect([...documented].sort()).toEqual([...read].sort());
  });

  // Everything called NEXT_PUBLIC_ is written into the page every visitor downloads.
  it("never puts a secret in a NEXT_PUBLIC_ variable: its name is not a key, a secret, a token or a password", () => {
    for (const name of [...documented, ...read]) {
      if (name.startsWith("NEXT_PUBLIC_")) expect(name, name).not.toMatch(/SECRET|PRIVATE|JWT|PASSWORD|API_KEY|TOKEN/);
    }
  });

  it("says the NEXT_PUBLIC_ ones are public", () => {
    expect(text(".env.example")).toMatch(/public/i);
  });

  it("has no real-looking key or token in it", () => {
    expect(text(".env.example")).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|0x[0-9a-fA-F]{64}|alch_[A-Za-z0-9]{8,}/);
  });
});
