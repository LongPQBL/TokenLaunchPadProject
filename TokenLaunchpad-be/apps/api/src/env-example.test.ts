import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const text = (file: string) => readFileSync(path.join(root, file), "utf8");
const names = (source: string, pattern: RegExp) => new Set([...source.matchAll(pattern)].map((m) => m[1]!));
/** Every variable the example file mentions, set or commented out. */
const documented = names(text(".env.example"), /^#?\s*([A-Z][A-Z0-9_]+)=/gm);

// The example file is what someone copies to start. A variable the API reads but the file does not mention is one they find by reading
// the source, and one the file mentions but nothing reads is a setting that does nothing.
describe("apps/api/.env.example", () => {
  it("mentions every variable the API reads, and nothing it does not", () => {
    const read = names(text("src/config.ts"), /\benv\.([A-Z][A-Z0-9_]+)/g);
    read.delete("NODE_ENV"); // set by the runtime, not by a person
    read.add("DEPLOYMENT"); // read by @vezta/deployments for the launchpad's address
    expect([...documented].sort()).toEqual([...read].sort());
  });

  it("leaves the secret blank: an example is copied and committed by accident", () => {
    expect(text(".env.example")).toMatch(/^#?\s*PINATA_JWT=$/m);
  });

  it("has no real-looking key or token in it", () => {
    expect(text(".env.example")).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|0x[0-9a-fA-F]{64}|alch_[A-Za-z0-9]{8,}/);
  });
});
