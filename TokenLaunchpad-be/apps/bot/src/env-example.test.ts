import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const text = (file: string) => readFileSync(path.join(root, file), "utf8");
// The example file is now shared by every backend package (TokenLaunchpad-be/.env.example, two levels up from here);
// see packages/shared/src/env-example.test.ts for the check that nothing in it goes unread by any of them, and that it is safe to commit.
const shared = readFileSync(path.join(root, "..", "..", ".env.example"), "utf8");
const names = (source: string, pattern: RegExp) => new Set([...source.matchAll(pattern)].map((m) => m[1]!));
const documented = names(shared, /^#?\s*([A-Z][A-Z0-9_]+)=/gm);

describe("apps/bot reads only what TokenLaunchpad-be/.env.example documents", () => {
  it("mentions every variable the bot reads", () => {
    const read = names(text("src/config.ts"), /\benv\.([A-Z][A-Z0-9_]+)/g);
    read.add("DEPLOYMENT"); // read by @vezta/deployments for the launchpad's address
    for (const name of read) expect(documented, name).toContain(name);
  });
});
