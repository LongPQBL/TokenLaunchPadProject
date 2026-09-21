import { launchpadAbi } from "@vezta/abi";
import { collectedQuote, graduationAmountFromReserves } from "@vezta/shared";
import { loadDeployment } from "@vezta/deployments";
import postgres from "postgres";
import { createPublicClient, http } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Asserts through SQL on the stable `launchpad` views schema — exactly how the API reads the data —
// rather than through an indexer HTTP API, which the app deliberately does not have (spec §3).
const sql = postgres(process.env.E2E_DATABASE_URL ?? "postgresql://localhost:5432/vezta_dev", { onnotice: () => {} });
const CHAIN = 11155111;
const d = loadDeployment();

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set: run the flow and the same-block fixture first`);
  return v.toLowerCase();
};
const FILLED = need("E2E_TOKEN"); // created, filled to completion and migrated by `pnpm flow`
const SAME_BLOCK = need("E2E_SAME_BLOCK_TOKEN"); // several buys forced into one block
const FRESH = need("E2E_FRESH_TOKEN"); // created, and never traded

async function waitFor<T>(what: string, probe: () => Promise<T | undefined>, ms = 30_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const v = await probe();
      if (v !== undefined) return v;
    } catch {
      /* the views schema does not exist until the indexer reaches realtime */
    }
    if (Date.now() > until) throw new Error(`timed out after ${ms}ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const tokenRow = async (address: string) => {
  const [row] = await sql`select * from launchpad.token where chain_id = ${CHAIN} and address = ${address}`;
  return row;
};

describe("indexer end to end", () => {
  beforeAll(async () => {
    await waitFor("the filled token to be indexed", async () => (await tokenRow(FILLED)) ?? undefined);
    await waitFor("the same-block token to be indexed", async () => (await tokenRow(SAME_BLOCK)) ?? undefined);
    await waitFor("the fresh token to be indexed", async () => (await tokenRow(FRESH)) ?? undefined);
  });
  afterAll(() => sql.end());

  it("indexes the token with its name, creator and curve state", async () => {
    const t = (await tokenRow(FILLED))!;
    expect(t.chain_id).toBe(CHAIN);
    expect(t.ticker).toBeTruthy();
    expect(t.metadata_uri).toBeTruthy();
    expect(BigInt(t.virtual_quote_reserves)).toBeGreaterThan(0n);
    expect(t.trade_count).toBeGreaterThan(0);
  });

  // The launch price is set by the curve's reserves the moment it is created; no trade has to happen for it to exist.
  it("indexes a token nobody has bought with the reserves its curve was created with, so it has a price", async () => {
    const t = (await tokenRow(FRESH))!;
    const curve = await createPublicClient({ transport: http(process.env.E2E_RPC_URL ?? "http://127.0.0.1:8545") }).readContract({
      address: d.launchpad,
      abi: launchpadAbi,
      functionName: "getCurve",
      args: [FRESH as `0x${string}`],
    });
    expect(t.trade_count).toBe(0);
    expect(BigInt(t.virtual_quote_reserves)).toBeGreaterThan(0n);
    expect(BigInt(t.virtual_token_reserves)).toBeGreaterThan(0n);
    expect(BigInt(t.virtual_quote_reserves)).toBe(curve.virtualQuoteReserves);
    expect(BigInt(t.virtual_token_reserves)).toBe(curve.virtualTokenReserves);
  });

  // Progress is the share of the ETH needed to graduate that is collected, which is what the token's page says as "collected / target": not
  // the share of the tokens sold, which runs far ahead of it (half the tokens sold is a fifth of the ETH).
  it("stores progress as the share of the graduation ETH collected, which agrees with the collected / target the page shows", async () => {
    const t = (await tokenRow(SAME_BLOCK))!;
    const vq = BigInt(t.virtual_quote_reserves);
    const vt = BigInt(t.virtual_token_reserves);
    const byEth = Number((collectedQuote(vq, vt) * 10_000n) / graduationAmountFromReserves(vq, vt));
    expect(t.progress_bps).toBeGreaterThan(0);
    expect(Math.abs(t.progress_bps - byEth)).toBeLessThanOrEqual(1);
    const bySoldTokens = Number(((10n ** 27n * 16n) / 15n - vt) * 10_000n / ((10n ** 27n * 4n) / 5n));
    expect(t.progress_bps).toBeLessThan(bySoldTokens); // the tokens sold are ahead of the ETH collected all along the curve
  });

  it("marks a filled curve complete and migrated, with a pair address and 100% progress", async () => {
    const t = (await tokenRow(FILLED))!;
    expect(t.complete).toBe(true);
    expect(t.migrated).toBe(true);
    expect(t.pair).toMatch(/^0x[0-9a-f]{40}$/);
    expect(t.progress_bps).toBe(10000);
  });

  it("stores addresses lower-case, so lookups by a lower-cased URL segment match", async () => {
    const t = (await tokenRow(FILLED))!;
    expect(t.address).toBe(t.address.toLowerCase());
    expect(t.creator).toBe(t.creator.toLowerCase());
  });

  it("counts every trade exactly once: trade_count equals the number of trade rows", async () => {
    for (const address of [FILLED, SAME_BLOCK]) {
      const t = (await tokenRow(address))!;
      const [counted] = await sql`select count(*)::int as n from launchpad.trade where chain_id = ${CHAIN} and token = ${address}`;
      expect(counted!.n, address).toBe(t.trade_count);
    }
  });

  it("never records the launchpad or the burn address as a holder", async () => {
    const launchpad = d.launchpad.toLowerCase();
    const burn = "0x000000000000000000000000000000000000dead";
    const rows = await sql`select holder from launchpad.balance where chain_id = ${CHAIN} and token = ${FILLED} and holder in (${launchpad}, ${burn})`;
    expect(rows).toHaveLength(0);
  });

  // The case the old (timestamp, id) ordering got wrong: several trades in a single block.
  it("gives trades sharing a block distinct log indexes that replay the curve in order", async () => {
    const trades = await sql`
      select block_number, log_index, virtual_quote_reserves, is_buy
      from launchpad.trade where chain_id = ${CHAIN} and token = ${SAME_BLOCK}
      order by block_number, log_index`;

    const byBlock = new Map<string, (typeof trades)[number][]>();
    for (const t of trades) byBlock.set(String(t.block_number), [...(byBlock.get(String(t.block_number)) ?? []), t]);
    const shared = [...byBlock.values()].find((g) => g.length > 1);
    expect(shared, "the fixture must put at least two trades in one block").toBeDefined();

    expect(new Set(shared!.map((t) => t.log_index)).size).toBe(shared!.length);
    // Each buy raises the virtual quote reserve, so replaying in (block, log_index) order must never
    // see it fall. Ordering by hash or by insertion would break this.
    expect(shared!.every((t) => t.is_buy)).toBe(true);
    const reserves = shared!.map((t) => BigInt(t.virtual_quote_reserves));
    for (let i = 1; i < reserves.length; i++) expect(reserves[i]! > reserves[i - 1]!, `trade ${i}`).toBe(true);
  });

  it("keeps every indexed row on the expected chain", async () => {
    const [stray] = await sql`select count(*)::int as n from launchpad.trade where chain_id <> ${CHAIN}`;
    expect(stray!.n).toBe(0);
  });
});
