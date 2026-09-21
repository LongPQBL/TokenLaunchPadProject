import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const text = (file: string) => readFileSync(path.join(root, file), "utf8");
const names = (source: string, pattern: RegExp) => new Set([...source.matchAll(pattern)].map((m) => m[1]!));
const documented = names(text(".env.example"), /^#?\s*([A-Z][A-Z0-9_]+)=/gm);

describe("apps/bot/.env.example", () => {
  it("mentions every variable the bot reads, and nothing it does not", () => {
    const read = names(text("src/config.ts"), /\benv\.([A-Z][A-Z0-9_]+)/g);
    read.add("DEPLOYMENT"); // read by @vezta/deployments for the launchpad's address
    expect([...documented].sort()).toEqual([...read].sort());
  });

  it("leaves the wallet's key blank, and says it must be the bot's own", () => {
    expect(text(".env.example")).toMatch(/^BOT_PRIVATE_KEY=$/m);
    expect(text(".env.example")).toMatch(/own wallet/i);
  });

  it("has no real-looking key in it", () => {
    expect(text(".env.example")).not.toMatch(/0x[0-9a-fA-F]{64}/);
  });
});
