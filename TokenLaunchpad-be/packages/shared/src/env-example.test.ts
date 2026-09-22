import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// TokenLaunchpad-be/.env.example, shared by apps/api, apps/bot, apps/indexer and packages/app-db. Each of those has its own test
// (env-example.test.ts) checking that it documents everything THAT package reads; this one checks the reverse — that nothing in
// it goes unread by any of them (a setting that does nothing) — and that the file itself is safe to commit.
const beRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const text = (file: string) => readFileSync(path.join(beRoot, file), "utf8");
const names = (source: string, pattern: RegExp) => new Set([...source.matchAll(pattern)].map((m) => m[1]!));

const shared = text(".env.example");
const documented = names(shared, /^#?\s*([A-Z][A-Z0-9_]+)=/gm);

describe("TokenLaunchpad-be/.env.example", () => {
  it("documents nothing that no backend package reads", () => {
    const apiRead = names(text("apps/api/src/config.ts"), /\benv\.([A-Z][A-Z0-9_]+)/g);
    const botRead = names(text("apps/bot/src/config.ts"), /\benv\.([A-Z][A-Z0-9_]+)/g);
    // The indexer reads its settings in ponder.config.ts (one variable per chain, not scanned by name) and its own package.json
    // ($PONDER_SCHEMA); app-db's Prisma schema reads DATABASE_URL the same way every package here does.
    const indexerRead = new Set(["DEPLOYMENT", "DATABASE_URL", "PONDER_RPC_URL_11155111", "PONDER_RPC_URL_11155111_FALLBACK", "PONDER_SCHEMA"]);
    const read = new Set([...apiRead, ...botRead, ...indexerRead]);
    read.delete("NODE_ENV"); // set by the runtime, not by a person
    expect([...documented].sort()).toEqual([...read].sort());
  });

  it("leaves both secrets blank: an example is copied and committed by accident", () => {
    expect(shared).toMatch(/^#?\s*PINATA_JWT=$/m);
    expect(shared).toMatch(/^#?\s*BOT_PRIVATE_KEY=$/m);
    expect(shared).toMatch(/own wallet/i); // BOT_PRIVATE_KEY says why it must be a fresh one, not just that it is secret
  });

  it("has no real-looking key, token or address in it", () => {
    expect(shared).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|0x[0-9a-fA-F]{64}|alch_[A-Za-z0-9]{8,}/);
  });
});
