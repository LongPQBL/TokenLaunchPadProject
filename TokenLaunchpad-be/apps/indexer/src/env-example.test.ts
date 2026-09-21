import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const text = (file: string) => readFileSync(path.join(root, file), "utf8");
const documented = new Set([...text(".env.example").matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!));

// The indexer reads its settings in ponder.config.ts (a variable per chain, named by the chain's id), and start:views takes the schema.
describe("apps/indexer/.env.example", () => {
  it("mentions every variable the indexer reads", () => {
    for (const name of ["DEPLOYMENT", "DATABASE_URL", "PONDER_RPC_URL_11155111", "PONDER_RPC_URL_11155111_FALLBACK", "PONDER_SCHEMA"]) {
      expect(documented, name).toContain(name);
    }
  });

  it("mentions nothing the indexer does not read", () => {
    expect([...documented].sort()).toEqual(["DATABASE_URL", "DEPLOYMENT", "PONDER_RPC_URL_11155111", "PONDER_RPC_URL_11155111_FALLBACK", "PONDER_SCHEMA"]);
  });

  it("reads the per-chain RPC variable the example names", () => {
    expect(text("ponder.config.ts")).toContain("PONDER_RPC_URL_${d.chainId}");
    expect(text("package.json")).toContain("$PONDER_SCHEMA");
  });
});
