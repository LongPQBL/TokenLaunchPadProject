import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addr, seedToken, seedTrade } from "../../test/seed.js";
import { getCandles, MAX_CANDLES } from "./candles.js";

const CHAIN = 11155111;
const T = addr(0xf1);
const E18 = 10n ** 18n;
const T0 = 1_700_000_040; // a multiple of 60, so bucket edges are easy to read
/** With vt = 1 the price is vq * 1e18, an exact integer. */
const priceOf = (vq: bigint) => vq * E18;
const whole = (s: string) => BigInt(s.split(".")[0]!);
/** The spot price at these reserves, in raw quote units per whole token (whole units: the queries' fractions are cut off by `whole`). */
const spot = (vq: bigint, vt: bigint) => (vq * E18) / vt;

/**
 * A trade on a curve with reserves `vq` / `vt` BEFORE it, written the way the contract writes it: the reserves it leaves, and the quote
 * and tokens that moved. A buy puts `quote` into the curve and takes `tokens` out of it; a sell does the reverse.
 */
const step = (o: { vq: bigint; vt: bigint; side: "buy" | "sell"; quote: bigint; tokens: bigint; blockNumber: number; logIndex?: number; timestamp: number; id?: string }) =>
  seedTrade({
    token: T,
    blockNumber: o.blockNumber,
    logIndex: o.logIndex ?? 0,
    timestamp: o.timestamp,
    id: o.id,
    isBuy: o.side === "buy",
    quoteAmount: o.quote,
    tokenAmount: o.tokens,
    vq: o.side === "buy" ? o.vq + o.quote : o.vq - o.quote,
    vt: o.side === "buy" ? o.vt - o.tokens : o.vt + o.tokens,
  });

beforeEach(async () => {
  await prisma.tokenMetadata.deleteMany();
  await seedToken.reset();
  await seedToken({ address: T, name: "T", ticker: "T" });
});
afterAll(() => prisma.$disconnect());

describe("getCandles: open and close", () => {
  // Review Focus 3: three trades in ONE block, inserted out of order, with ids chosen so that ordering by
  // id would give a different answer from ordering by log index.
  it("picks open and close by (blockNumber, logIndex), not by timestamp or id", async () => {
    // A chain of three buys in one block: 100/1000 -> 110/950 -> 120/910 -> 130/880, inserted out of order.
    await step({ vq: 120n, vt: 910n, side: "buy", quote: 10n, tokens: 30n, blockNumber: 100, logIndex: 8, id: "1-0xcccc-8", timestamp: T0 });
    await step({ vq: 100n, vt: 1_000n, side: "buy", quote: 10n, tokens: 50n, blockNumber: 100, logIndex: 2, id: "1-0x5555-2", timestamp: T0 });
    await step({ vq: 110n, vt: 950n, side: "buy", quote: 10n, tokens: 40n, blockNumber: 100, logIndex: 5, id: "1-0x0ddd-5", timestamp: T0 });
    const [c] = await getCandles(CHAIN, T, 3600);
    // Ordered by id, the first trade would be the 0x0ddd one; by log index it is the 0x5555 one, from 100/1000.
    expect(whole(c!.open)).toBe(spot(100n, 1_000n));
    expect(whole(c!.close)).toBe(spot(130n, 880n));
    expect(whole(c!.high)).toBe(spot(130n, 880n));
    expect(whole(c!.low)).toBe(spot(100n, 1_000n));
  });

  it("orders by block before log index: a later block wins over a higher log index in an earlier one", async () => {
    await step({ vq: 100n, vt: 1_000n, side: "buy", quote: 30n, tokens: 100n, blockNumber: 100, logIndex: 99, timestamp: T0 }); // 100/1000 -> 130/900
    await step({ vq: 130n, vt: 900n, side: "sell", quote: 20n, tokens: 100n, blockNumber: 101, logIndex: 1, timestamp: T0 + 1 }); // -> 110/1000
    const [c] = await getCandles(CHAIN, T, 3600);
    expect(whole(c!.open)).toBe(spot(100n, 1_000n));
    expect(whole(c!.close)).toBe(spot(110n, 1_000n));
  });

  it("gives identical results for identical requests", async () => {
    for (let i = 0; i < 6; i++) await seedTrade({ token: T, blockNumber: 100, logIndex: i, vq: BigInt(10 + i), timestamp: T0 });
    expect(await getCandles(CHAIN, T, 60)).toEqual(await getCandles(CHAIN, T, 60));
  });
});

describe("getCandles: shape", () => {
  it("takes high and low from anywhere in the bucket, and the price before the first trade counts, and sums the volume", async () => {
    await step({ vq: 100n, vt: 1_000n, side: "sell", quote: 10n, tokens: 100n, blockNumber: 1, timestamp: T0 }); // -> 90/1100: the low
    await step({ vq: 90n, vt: 1_100n, side: "buy", quote: 30n, tokens: 200n, blockNumber: 2, timestamp: T0 + 10 }); // -> 120/900: the high
    await step({ vq: 120n, vt: 900n, side: "sell", quote: 15n, tokens: 105n, blockNumber: 3, timestamp: T0 + 20 }); // -> 105/1005
    const [c] = await getCandles(CHAIN, T, 60);
    expect(whole(c!.open)).toBe(spot(100n, 1_000n));
    expect(whole(c!.high)).toBe(spot(120n, 900n));
    expect(whole(c!.low)).toBe(spot(90n, 1_100n));
    expect(whole(c!.close)).toBe(spot(105n, 1_005n));
    expect(c!.volume).toBe("55");
  });

  it("buckets by the interval in seconds", async () => {
    await seedTrade({ token: T, blockNumber: 1, logIndex: 0, timestamp: T0 });
    await seedTrade({ token: T, blockNumber: 2, logIndex: 0, timestamp: T0 + 90 });
    const candles = await getCandles(CHAIN, T, 60);
    expect(candles.map((c) => c.time)).toEqual([T0, T0 + 60]);
    expect(typeof candles[0]!.time).toBe("number");
    expect((await getCandles(CHAIN, T, 3600)).map((c) => c.time)).toEqual([Math.floor(T0 / 3600) * 3600]);
  });

  it("returns candles oldest first", async () => {
    for (let i = 0; i < 4; i++) await seedTrade({ token: T, blockNumber: i, logIndex: 0, timestamp: T0 + i * 120 });
    const times = (await getCandles(CHAIN, T, 60)).map((c) => c.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("returns an empty array for a token with no trades", async () => {
    expect(await getCandles(CHAIN, T, 60)).toEqual([]);
  });

  it("ignores trades before `from`", async () => {
    await seedTrade({ token: T, blockNumber: 1, logIndex: 0, timestamp: T0 });
    await seedTrade({ token: T, blockNumber: 2, logIndex: 0, timestamp: T0 + 600 });
    expect((await getCandles(CHAIN, T, 60, T0 + 300)).map((c) => c.time)).toEqual([T0 + 600]);
  });

  it("clamps an interval below one second to one second", async () => {
    await seedTrade({ token: T, blockNumber: 1, logIndex: 0, timestamp: T0 });
    await seedTrade({ token: T, blockNumber: 2, logIndex: 0, timestamp: T0 + 1 });
    for (const bad of [0, -5, 0.4, Number.NaN]) expect((await getCandles(CHAIN, T, bad)).map((c) => c.time), String(bad)).toEqual([T0, T0 + 1]);
  });

  it("keeps full precision as decimal strings, never as numbers or exponents", async () => {
    // 1e18 / 3e10 = 33333333.333...: a realistic launch-sized price (raw quote units per whole token) with a
    // fraction. Postgres numeric division keeps at least 16 significant digits, so the fraction survives.
    await seedTrade({ token: T, blockNumber: 1, logIndex: 0, vq: 1n, vt: 30_000_000_000n, timestamp: T0 });
    const [c] = await getCandles(CHAIN, T, 60);
    for (const field of [c!.open, c!.high, c!.low, c!.close, c!.volume]) {
      expect(typeof field).toBe("string");
      expect(field).toMatch(/^\d+(\.\d+)?$/); // plain decimal: no exponent, no sign, no NaN
    }
    expect(c!.open.startsWith("33333333.3333333")).toBe(true);
  });

  it("is scoped to the token and the chain", async () => {
    await seedTrade({ token: addr(0xf2), blockNumber: 1, logIndex: 0, timestamp: T0 });
    await seedTrade({ token: T, blockNumber: 1, logIndex: 1, timestamp: T0, chainId: 84532 });
    expect(await getCandles(CHAIN, T, 60)).toEqual([]);
  });
});

describe("getCandles: bad data and abuse", () => {
  it("skips a trade with zero token reserves instead of failing the whole chart", async () => {
    await seedTrade({ token: T, blockNumber: 1, logIndex: 0, vq: 5n, vt: 0n, timestamp: T0 });
    await seedTrade({ token: T, blockNumber: 2, logIndex: 0, vq: 6n, vt: 1n, quoteAmount: 0n, tokenAmount: 0n, timestamp: T0 }); // moved nothing: its price is 6 either side
    const [c] = await getCandles(CHAIN, T, 60);
    expect(whole(c!.open)).toBe(priceOf(6n));
  });

  it("returns only the newest MAX_CANDLES buckets, so one request cannot build an unbounded chart", async () => {
    const rows = MAX_CANDLES + 25;
    await Promise.all(Array.from({ length: rows }, (_, i) => seedTrade({ token: T, blockNumber: i, logIndex: 0, timestamp: T0 + i })));
    const candles = await getCandles(CHAIN, T, 1);
    expect(candles).toHaveLength(MAX_CANDLES);
    expect(candles.at(-1)!.time).toBe(T0 + rows - 1); // the newest is kept
    expect(candles[0]!.time).toBe(T0 + rows - MAX_CANDLES);
  });
});

// A trade's Trade event says the reserves AFTER it; the price BEFORE it follows from what moved (a buy put `quoteAmount` into the curve
// and took `tokenAmount` out). Opening each candle at the price before its first trade is what makes a lone sell a candle that goes down
// and a lone buy one that goes up, and what makes each candle open where the one before it closed.
describe("getCandles: a candle opens at the price before its first trade", () => {
  it("makes a lone sell a candle that goes down: open is the price before, close the price after", async () => {
    await step({ vq: 100n, vt: 1_000n, side: "sell", quote: 10n, tokens: 100n, blockNumber: 1, timestamp: T0 }); // 100/1000 -> 90/1100
    const [c] = await getCandles(CHAIN, T, 60);
    expect(whole(c!.open)).toBe(spot(100n, 1_000n));
    expect(whole(c!.close)).toBe(spot(90n, 1_100n));
    expect(BigInt(whole(c!.open))).toBeGreaterThan(BigInt(whole(c!.close)));
    expect(whole(c!.high)).toBe(whole(c!.open));
    expect(whole(c!.low)).toBe(whole(c!.close));
  });

  it("makes a lone buy a candle that goes up", async () => {
    await step({ vq: 100n, vt: 1_000n, side: "buy", quote: 10n, tokens: 90n, blockNumber: 1, timestamp: T0 }); // 100/1000 -> 110/910
    const [c] = await getCandles(CHAIN, T, 60);
    expect(whole(c!.open)).toBe(spot(100n, 1_000n));
    expect(whole(c!.close)).toBe(spot(110n, 910n));
    expect(BigInt(whole(c!.close))).toBeGreaterThan(BigInt(whole(c!.open)));
    expect(whole(c!.high)).toBe(whole(c!.close));
    expect(whole(c!.low)).toBe(whole(c!.open));
  });

  it("opens a token's first candle at its launch price, from the real numbers of a first buy", async () => {
    // The first trade of a token made on Sepolia: the curve started at 133333333333333333 / 1066666666666666666666666666, a price of 125000000.
    await seedTrade({
      token: T, blockNumber: 1, logIndex: 0, timestamp: T0, isBuy: true,
      quoteAmount: 716_675_428_454_534n, tokenAmount: 5_702_750_767_513_692_279_052_044n,
      vq: 134_050_008_761_787_867n, vt: 1_060_963_915_899_152_974_387_614_622n,
    });
    const [c] = await getCandles(CHAIN, T, 60);
    expect(whole(c!.open)).toBe(125_000_000n);
    expect(whole(c!.close)).toBe(126_347_377n); // 126347377.6...: cut, not rounded
  });

  it("joins candles up: each opens exactly where the one before it closed", async () => {
    await step({ vq: 100n, vt: 1_000n, side: "buy", quote: 10n, tokens: 90n, blockNumber: 1, timestamp: T0 });
    await step({ vq: 110n, vt: 910n, side: "sell", quote: 6n, tokens: 60n, blockNumber: 2, timestamp: T0 + 120 }); // two minutes later
    const [first, second] = await getCandles(CHAIN, T, 60);
    expect(second!.open).toBe(first!.close);
  });

  it("does not depend on trades outside the request: a candle opens at the price before its trade even when the trade before it is cut off", async () => {
    await step({ vq: 100n, vt: 1_000n, side: "buy", quote: 10n, tokens: 90n, blockNumber: 1, timestamp: T0 });
    await step({ vq: 110n, vt: 910n, side: "sell", quote: 6n, tokens: 60n, blockNumber: 2, timestamp: T0 + 600 });
    const [c] = await getCandles(CHAIN, T, 60, T0 + 300); // only the second trade is asked for
    expect(whole(c!.open)).toBe(spot(110n, 910n)); // where the first left the price
    // (Postgres rounds a division of numbers this long where the bigint cuts it: one part in 1e17 either way is the same price.)
    const off = whole(c!.close) - spot(104n, 970n);
    expect(off === 0n || off === 1n).toBe(true);
  });

  it("falls back to the trade's own price when its amounts do not agree with its reserves, rather than inventing a price before it", async () => {
    // A buy of 9 quote into reserves of 5 would mean the curve had -4 before it: not a price.
    await seedTrade({ token: T, blockNumber: 1, logIndex: 0, timestamp: T0, isBuy: true, quoteAmount: 9n, tokenAmount: 1n, vq: 5n, vt: 10n });
    const [c] = await getCandles(CHAIN, T, 60);
    expect(whole(c!.open)).toBe(spot(5n, 10n));
    expect(c!.open).toBe(c!.close);
  });
});
