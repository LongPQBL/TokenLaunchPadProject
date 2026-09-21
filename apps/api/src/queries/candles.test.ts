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
    await seedTrade({ token: T, blockNumber: 100, logIndex: 8, id: "1-0xcccc-8", vq: 26n, timestamp: T0 });
    await seedTrade({ token: T, blockNumber: 100, logIndex: 2, id: "1-0x5555-2", vq: 15n, timestamp: T0 });
    await seedTrade({ token: T, blockNumber: 100, logIndex: 5, id: "1-0x0ddd-5", vq: 17n, timestamp: T0 });
    const [c] = await getCandles(CHAIN, T, 3600);
    // By id the open would be the 0x0ddd trade (17); by log index it is the 0x5555 trade (15).
    expect(whole(c!.open)).toBe(priceOf(15n));
    expect(whole(c!.close)).toBe(priceOf(26n));
    expect(whole(c!.high)).toBe(priceOf(26n));
    expect(whole(c!.low)).toBe(priceOf(15n));
  });

  it("orders by block before log index: a later block wins over a higher log index in an earlier one", async () => {
    await seedTrade({ token: T, blockNumber: 100, logIndex: 99, vq: 30n, timestamp: T0 });
    await seedTrade({ token: T, blockNumber: 101, logIndex: 1, vq: 12n, timestamp: T0 + 1 });
    const [c] = await getCandles(CHAIN, T, 3600);
    expect(whole(c!.open)).toBe(priceOf(30n));
    expect(whole(c!.close)).toBe(priceOf(12n));
  });

  it("gives identical results for identical requests", async () => {
    for (let i = 0; i < 6; i++) await seedTrade({ token: T, blockNumber: 100, logIndex: i, vq: BigInt(10 + i), timestamp: T0 });
    expect(await getCandles(CHAIN, T, 60)).toEqual(await getCandles(CHAIN, T, 60));
  });
});

describe("getCandles: shape", () => {
  it("takes high and low from anywhere in the bucket and sums the volume", async () => {
    await seedTrade({ token: T, blockNumber: 1, logIndex: 0, vq: 20n, quoteAmount: 5n, timestamp: T0 });
    await seedTrade({ token: T, blockNumber: 2, logIndex: 0, vq: 30n, quoteAmount: 7n, timestamp: T0 + 10 }); // a buy
    await seedTrade({ token: T, blockNumber: 3, logIndex: 0, vq: 10n, quoteAmount: 11n, timestamp: T0 + 20, isBuy: false }); // a sell
    const [c] = await getCandles(CHAIN, T, 60);
    expect(whole(c!.open)).toBe(priceOf(20n));
    expect(whole(c!.high)).toBe(priceOf(30n));
    expect(whole(c!.low)).toBe(priceOf(10n));
    expect(whole(c!.close)).toBe(priceOf(10n));
    expect(c!.volume).toBe("23");
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
    await seedTrade({ token: T, blockNumber: 2, logIndex: 0, vq: 6n, vt: 1n, timestamp: T0 });
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
