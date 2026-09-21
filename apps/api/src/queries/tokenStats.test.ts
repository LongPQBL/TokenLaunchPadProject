import { prisma } from "@vezta/app-db";
import { marketCap } from "@vezta/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addr, seedToken, seedTrade } from "../../test/seed.js";
import { BadCursorError, listTokens, type Sort } from "./tokenList.js";

const CHAIN = 11155111;
const S = 10n ** 27n;
const VQ0 = 15_000_000_000_000_000n; // a curve that graduates at 0.045: G = 3 * vq0
const VT0 = (16n * S) / 15n;
const K = VQ0 * VT0;
const NOW = Math.floor(Date.now() / 1000);
const MIN = 60;
const HOUR = 3600;

/** The reserves at a point on the curve where the price is m*m times the launch price (m = num/den). */
const onCurve = (num: bigint, den = 1n) => {
  const vq = (VQ0 * num) / den;
  return { vq, vt: K / vq };
};

let block = 0;
const trade = (token: string, secondsAgo: number, at: { vq: bigint; vt: bigint }, trader = addr(0xa1), quoteAmount = 1_000n) =>
  seedTrade({ token, trader, quoteAmount, vq: at.vq, vt: at.vt, timestamp: NOW - secondsAgo, blockNumber: ++block, logIndex: 0 });
const token = (address: string, at: { vq: bigint; vt: bigint }, extra: Partial<Parameters<typeof seedToken>[0]> = {}) =>
  seedToken({ address, name: address.slice(-4), ticker: "T", virtualQuoteReserves: at.vq, virtualTokenReserves: at.vt, ...extra });
const list = (o: Partial<Parameters<typeof listTokens>[0]> = {}) => listTokens({ chainId: CHAIN, sort: "new", limit: 10, ...o });
const one = async (address: string) => (await list()).items.find((t) => t.address === address)!;

beforeEach(async () => {
  block = 0;
  await prisma.tokenMetadata.deleteMany();
  await seedToken.reset();
});
afterAll(() => prisma.$disconnect());

const A = addr(0xa1);
const B = addr(0xb2);
const C = addr(0xc3);
const D = addr(0xd4);

describe("the numbers on a token row", () => {
  it("gives the market cap from the token's reserves, the way the app works it out everywhere else", async () => {
    const now = onCurve(2n);
    await token(A, now);
    expect((await one(A)).stats.marketCap).toBe(marketCap(now.vq, now.vt));
  });

  it("says no change, no volume and no traders for a token nobody has traded, and an ATH that is not below its cap", async () => {
    await token(A, onCurve(1n));
    const { stats } = await one(A);
    expect(stats).toMatchObject({ volume24h: 0n, traders24h: 0, change1hBps: 0, change6hBps: 0, change24hBps: 0 });
    expect(stats.athMarketCap).toBeGreaterThanOrEqual(stats.marketCap);
  });

  it("does not break on a token whose reserves are not set yet", async () => {
    await seedToken({ address: A, name: "Raw", ticker: "RAW" });
    expect((await one(A)).stats).toMatchObject({ marketCap: 0n, athMarketCap: 0n, change24hBps: 0 });
  });

  it("counts volume and distinct traders in the last 24 hours only", async () => {
    await token(A, onCurve(2n));
    await trade(A, 30 * HOUR, onCurve(1n), addr(0xf0), 500n); // too old
    await trade(A, 3 * HOUR, onCurve(2n), addr(0xf1), 100n);
    await trade(A, 2 * HOUR, onCurve(2n), addr(0xf1), 200n); // the same person twice
    await trade(A, 1 * HOUR, onCurve(2n), addr(0xf2), 300n);
    expect((await one(A)).stats).toMatchObject({ volume24h: 600n, traders24h: 2 });
  });

  it("leaves another token's trades out of this token's numbers", async () => {
    await token(A, onCurve(2n));
    await token(B, onCurve(2n));
    await trade(B, 10 * MIN, onCurve(2n), addr(0xf1), 900n);
    expect((await one(A)).stats).toMatchObject({ volume24h: 0n, traders24h: 0 });
  });
});

describe("the change in price", () => {
  // Price is m*m times the launch price, so m = 3/2 is 2.25x and m = 2 is 4x.
  it("compares the price now with the last price at or before each window's start", async () => {
    await token(A, onCurve(2n)); // 4x now
    await trade(A, 30 * HOUR, onCurve(1n)); // 1x, before every window
    await trade(A, 2 * HOUR, onCurve(3n, 2n)); // 2.25x, before the 1 h window only
    await trade(A, 10 * MIN, onCurve(2n)); // 4x
    const { stats } = await one(A);
    expect(stats.change1hBps).toBeCloseTo(7778, -1); // 4 / 2.25 - 1
    expect(stats.change6hBps).toBeCloseTo(30000, -1); // 4 / 1 - 1
    expect(stats.change24hBps).toBeCloseTo(30000, -1);
  });

  it("compares a token younger than the window with its launch price", async () => {
    await token(A, onCurve(2n));
    await trade(A, 5 * MIN, onCurve(2n));
    const { stats } = await one(A);
    for (const bps of [stats.change1hBps, stats.change6hBps, stats.change24hBps]) expect(bps).toBeCloseTo(30000, -1);
  });

  it("is negative when the price has fallen, and never below -100%", async () => {
    await token(A, onCurve(1n)); // 1x now
    await trade(A, 2 * HOUR, onCurve(2n)); // 4x before
    const { stats } = await one(A);
    expect(stats.change1hBps).toBeCloseTo(-7500, -1);
    expect(stats.change1hBps).toBeGreaterThan(-10_000);
  });

  it("tracks the highest price ever reached as the ATH, even after it has fallen back", async () => {
    await token(A, onCurve(2n)); // 4x now
    await trade(A, 5 * HOUR, onCurve(3n)); // 9x at the peak
    await trade(A, 1 * HOUR, onCurve(2n));
    const { stats } = await one(A);
    const peak = marketCap(onCurve(3n).vq, onCurve(3n).vt);
    expect(stats.athMarketCap).toBe(peak);
    expect(stats.marketCap).toBeLessThan(stats.athMarketCap);
  });
});

describe("sorting by the numbers", () => {
  // A: 2 traders, 300 volume, fell from 4x to 1x an hour ago.  B: 1 trader, 900 volume, rose from 1x to 4x.
  // C: 3 traders, 99 volume, flat at 2.25x.  D: never traded.  Ties go to the higher address, as for every sort.
  async function seed() {
    await token(A, onCurve(1n), { tradeCount: 30 });
    await token(B, onCurve(2n), { tradeCount: 10 });
    await token(C, onCurve(3n, 2n), { tradeCount: 20 });
    await token(D, onCurve(1n), { tradeCount: 5 });
    await trade(A, 3 * HOUR, onCurve(2n), addr(0xf1), 100n);
    await trade(A, 30 * MIN, onCurve(1n), addr(0xf2), 200n);
    await trade(B, 26 * HOUR, onCurve(1n), addr(0xf1), 50n);
    await trade(B, 30 * MIN, onCurve(2n), addr(0xf1), 900n);
    await trade(C, 26 * HOUR, onCurve(3n, 2n), addr(0xf1), 7n);
    for (const who of [0xf1, 0xf2, 0xf3]) await trade(C, 20 * MIN, onCurve(3n, 2n), addr(who), 33n);
  }
  const order = async (sort: Sort) => (await list({ sort })).items.map((t) => t.address);

  it("puts the biggest first for each key", async () => {
    await seed();
    expect(await order("mcap")).toEqual([B, C, D, A]);
    expect(await order("txns")).toEqual([A, C, B, D]);
    expect(await order("volume24h")).toEqual([B, A, C, D]);
    expect(await order("traders")).toEqual([C, A, B, D]);
    expect(await order("change1h")).toEqual([B, D, C, A]);
    expect(await order("change24h")).toEqual([B, D, C, A]);
  });

  it("orders by the signed change, so a fall is below a flat token and a rise above it", async () => {
    await seed();
    const change = (await list({ sort: "change1h" })).items.map((t) => t.stats.change1hBps);
    expect(change).toEqual([...change].sort((x, y) => y - x));
    expect(change.some((c) => c < 0)).toBe(true);
    expect(change.some((c) => c > 0)).toBe(true);
  });

  it("pages through every key without repeating or skipping a token, negative changes included", async () => {
    await seed();
    for (const sort of ["mcap", "txns", "volume24h", "traders", "change1h", "change6h", "change24h"] as Sort[]) {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 6; i++) {
        const page = await list({ sort, limit: 1, cursor });
        seen.push(...page.items.map((t) => t.address));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      expect([...seen].sort(), sort).toEqual([A, B, C, D].sort());
    }
  });

  it("refuses a cursor that does not fit the key, including a negative number where none can be", async () => {
    await seed();
    const forged = (v: string) => Buffer.from(JSON.stringify([v, A])).toString("base64url");
    await expect(list({ sort: "mcap", cursor: forged("-5") })).rejects.toBeInstanceOf(BadCursorError);
    await expect(list({ sort: "change24h", cursor: forged("-99999999999") })).rejects.toBeInstanceOf(BadCursorError);
    await expect(list({ sort: "traders", cursor: forged("9999999999999") })).rejects.toBeInstanceOf(BadCursorError);
  });
});
