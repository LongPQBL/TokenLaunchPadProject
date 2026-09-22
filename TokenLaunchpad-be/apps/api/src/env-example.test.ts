import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const text = (file: string) => readFileSync(path.join(root, file), "utf8");
// The example file is now shared by every backend package (TokenLaunchpad-be/.env.example, two levels up from here);
// see packages/shared/src/env-example.test.ts for the check that nothing in it goes unread by any of them.
const shared = readFileSync(path.join(root, "..", "..", ".env.example"), "utf8");
const names = (source: string, pattern: RegExp) => new Set([...source.matchAll(pattern)].map((m) => m[1]!));
const documented = names(shared, /^#?\s*([A-Z][A-Z0-9_]+)=/gm);

// A variable the API reads but the shared file does not mention is one a person would only find by reading the source. Whether the
// shared file itself is safe to commit (secrets left blank, nothing that looks real) is checked once, in packages/shared, since
// three packages would otherwise repeat the same check of the same file.
describe("apps/api reads only what TokenLaunchpad-be/.env.example documents", () => {
  it("mentions every variable the API reads", () => {
    const read = names(text("src/config.ts"), /\benv\.([A-Z][A-Z0-9_]+)/g);
    read.delete("NODE_ENV"); // set by the runtime, not by a person
    read.add("DEPLOYMENT"); // read by @vezta/deployments for the launchpad's address
    for (const name of read) expect(documented, name).toContain(name);
  });
});
