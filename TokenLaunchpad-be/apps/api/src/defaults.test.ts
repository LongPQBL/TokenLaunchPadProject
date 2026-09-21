import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_IPFS_GATEWAY } from "./metadata/ipfs.js";
import { loadConfig } from "./config.js";

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return sources(file);
    return file.endsWith(".ts") && !file.endsWith(".test.ts") ? [file] : [];
  });

// A setting that has a default writes it down once. The gateway was written out in six files, one of them the config that reads
// IPFS_GATEWAY_URL: change the default in one and the others would go on using the old one.
describe("the default IPFS gateway", () => {
  it("is named once, in metadata/ipfs.ts, and no other source file writes it out", () => {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const writers = sources(here).filter((f) => readFileSync(f, "utf8").includes(`"${DEFAULT_IPFS_GATEWAY}"`));
    expect(writers.map((f) => path.relative(here, f))).toEqual([path.join("metadata", "ipfs.ts")]);
  });

  it("is what the config uses when IPFS_GATEWAY_URL is not set", () => {
    const base = { DATABASE_URL: "postgresql://localhost:5432/x" };
    expect(loadConfig(base).ipfsGatewayUrl).toBe(DEFAULT_IPFS_GATEWAY);
  });

  it("is an https gateway, since the API only ever fetches through the one it is given", () => {
    expect(DEFAULT_IPFS_GATEWAY).toMatch(/^https:\/\/[a-z.]+$/);
  });
});
