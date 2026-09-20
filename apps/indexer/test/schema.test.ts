import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { balance, token, trade } from "../ponder.schema";

// These pin the decisions that are expensive to change later: changing a primary key means a full
// re-index, and the raw SQL in the API (chain_id, log_index, ...) depends on these exact names.
const cols = (columns: { name: string }[]) => columns.map((c) => c.name);
const pk = (t: Parameters<typeof getTableConfig>[0]) => getTableConfig(t).primaryKeys.map((p) => cols(p.columns));
const indexes = (t: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(t).indexes.map((i) => cols(i.config.columns as { name: string }[]));

describe("token", () => {
  it("is keyed by (chain, address): the same address can exist on two chains", () => {
    expect(pk(token)).toEqual([["chain_id", "address"]]);
  });

  it("has one index per list sort, each led by chain_id because every query filters on it", () => {
    expect(indexes(token)).toEqual(
      expect.arrayContaining([
        ["chain_id", "created_at"],
        ["chain_id", "volume_quote"],
        ["chain_id", "progress_bps"],
      ]),
    );
  });
});

describe("trade", () => {
  it("has its own log_index column: id sorts by transaction hash, which is effectively random", () => {
    expect(cols(getTableConfig(trade).columns)).toEqual(
      expect.arrayContaining(["chain_id", "block_number", "log_index", "virtual_quote_reserves", "virtual_token_reserves"]),
    );
  });

  it("indexes the feed by (chain, token, block, log) so newest-first is an index scan", () => {
    expect(indexes(trade)).toContainEqual(["chain_id", "token", "block_number", "log_index"]);
  });
});

describe("balance", () => {
  it("is keyed by (chain, token, holder)", () => {
    expect(pk(balance)).toEqual([["chain_id", "token", "holder"]]);
  });

  it("indexes holders by amount so the top-holders query does not sort the table", () => {
    expect(indexes(balance)).toContainEqual(["chain_id", "token", "amount"]);
  });
});
