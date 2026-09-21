import { describe, expect, it } from "vitest";
import { createCandleAccumulator, liveTradeSchema, mergeTrades, tradeKey } from "./live";

const TOKEN = "0x00000000000000000000000000000000000000b2";
const OTHER = "0x00000000000000000000000000000000000000b3";
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

/** A trade as the watcher publishes it: amounts are strings. `price` sets the reserves so the spot price is that many wei per token. */
function wire(o: { n?: number; logIndex?: number; token?: string; timestamp?: number; priceWei?: bigint; isBuy?: boolean } = {}) {
  const n = o.n ?? 1;
  const logIndex = o.logIndex ?? 0;
  const priceWei = o.priceWei ?? 20_000_000n; // 2e-11 ETH per token
  return {
    type: "trade",
    id: `${tx(n)}-${logIndex}`,
    chain: "sepolia",
    token: o.token ?? TOKEN,
    trader: "0x00000000000000000000000000000000000000a1",
    isBuy: o.isBuy ?? true,
    quoteAmount: "1000",
    tokenAmount: "5000",
    fee: "10",
    launchTax: "0",
    // spot price = vQ * 1e18 / vT: with vT = 1e27 this is priceWei
    virtualQuoteReserves: (priceWei * 10n ** 27n / 10n ** 18n).toString(),
    virtualTokenReserves: (10n ** 27n).toString(),
    timestamp: String(o.timestamp ?? 1_000),
    blockNumber: "50",
    txHash: tx(n),
    logIndex,
  };
}
const trade = (o: Parameters<typeof wire>[0] = {}) => liveTradeSchema.parse(wire(o));
const candle = (time: number, o: number, h: number, l: number, c: number) => ({ time, open: o, high: h, low: l, close: c });

describe("liveTradeSchema", () => {
  it("turns every amount into an exact bigint", () => {
    const t = trade();
    expect(t.quoteAmount).toBe(1000n);
    expect(t.virtualTokenReserves).toBe(10n ** 27n);
    expect(t.timestamp).toBe(1000n);
  });

  it("lower-cases the addresses", () => {
    const t = liveTradeSchema.parse({ ...wire(), token: TOKEN.toUpperCase().replace("0X", "0x") });
    expect(t.token).toBe(TOKEN);
  });

  it("refuses what is not a trade: a wrong type, a non-integer amount, a missing field", () => {
    for (const bad of [{ ...wire(), type: "complete" }, { ...wire(), quoteAmount: "1e18" }, { ...wire(), quoteAmount: "-5" }, { ...wire(), txHash: undefined }, null, "x", { ...wire(), token: "0x12" }]) {
      expect(liveTradeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("tradeKey", () => {
  it("is the same for a trade from the socket and the same trade from the REST feed, whose id also carries the chain", () => {
    expect(tradeKey(`${tx(7)}-3`)).toBe(`${tx(7)}-3`);
    expect(tradeKey(`11155111-${tx(7)}-3`)).toBe(`${tx(7)}-3`);
  });
});

describe("createCandleAccumulator", () => {
  const make = (initial = [candle(960, 2e-11, 3e-11, 1e-11, 2e-11)]) => createCandleAccumulator({ token: TOKEN, interval: 60, decimals: 18, initial });

  it("moves the last candle in place for a trade inside its bucket: high, low and close move, open does not", () => {
    const acc = make([candle(960, 2e-11, 2.5e-11, 1.5e-11, 2e-11)]);
    acc.apply(trade({ n: 1, timestamp: 990, priceWei: 30_000_000n })); // 3e-11
    expect(acc.series).toEqual([candle(960, 2e-11, 3e-11, 1.5e-11, 3e-11)]);
    acc.apply(trade({ n: 2, timestamp: 1_000, priceWei: 10_000_000n })); // 1e-11
    expect(acc.series).toEqual([candle(960, 2e-11, 3e-11, 1e-11, 1e-11)]);
  });

  it("starts a new candle when the trade crosses into the next bucket", () => {
    const acc = make();
    acc.apply(trade({ timestamp: 1_020, priceWei: 40_000_000n }));
    expect(acc.series).toHaveLength(2);
    expect(acc.series[1]).toEqual(candle(1_020, 4e-11, 4e-11, 4e-11, 4e-11));
  });

  it("puts a trade in the bucket its timestamp belongs to", () => {
    const acc = make([]);
    acc.apply(trade({ timestamp: 125 }));
    expect(acc.series[0]!.time).toBe(120);
  });

  it("starts the chart from nothing", () => {
    const acc = make([]);
    expect(acc.apply(trade({ timestamp: 1_000 }))).toBe(true);
    expect(acc.series).toHaveLength(1);
  });

  // A reorg redelivers a trade. Applying it twice must not change the candle a second time.
  it("ignores a trade it has already applied, by txHash and logIndex", () => {
    const acc = make();
    const t = trade({ n: 5, timestamp: 990, priceWei: 30_000_000n });
    expect(acc.apply(t)).toBe(true);
    const after = acc.series;
    expect(acc.apply(t)).toBe(false);
    expect(acc.apply(trade({ n: 5, timestamp: 990, priceWei: 99_000_000n }))).toBe(false); // same key, different numbers: still the same trade
    expect(acc.series).toBe(after);
  });

  it("tells two trades in one transaction apart", () => {
    const acc = make();
    expect(acc.apply(trade({ n: 5, logIndex: 0, timestamp: 990 }))).toBe(true);
    expect(acc.apply(trade({ n: 5, logIndex: 1, timestamp: 990 }))).toBe(true);
  });

  it("ignores a trade for a different token", () => {
    const acc = make();
    const before = acc.series;
    expect(acc.apply(trade({ token: OTHER }))).toBe(false);
    expect(acc.series).toBe(before);
  });

  it("ignores a trade older than the newest bucket: it cannot be placed in the past, and a refetch will bring it", () => {
    const acc = make([candle(1_020, 1e-11, 1e-11, 1e-11, 1e-11)]);
    expect(acc.apply(trade({ timestamp: 990 }))).toBe(false);
    expect(acc.series).toHaveLength(1);
  });

  it("does not change the series it was given", () => {
    const initial = [candle(960, 2e-11, 2e-11, 2e-11, 2e-11)];
    const acc = createCandleAccumulator({ token: TOKEN, interval: 60, decimals: 18, initial });
    acc.apply(trade({ timestamp: 990, priceWei: 50_000_000n }));
    expect(initial[0]).toEqual(candle(960, 2e-11, 2e-11, 2e-11, 2e-11));
  });

  it("replaces the series after a refetch, and still ignores trades it had already seen", () => {
    const acc = make();
    acc.apply(trade({ n: 9, timestamp: 990, priceWei: 30_000_000n }));
    acc.replace([candle(960, 2e-11, 3e-11, 2e-11, 3e-11)]);
    expect(acc.apply(trade({ n: 9, timestamp: 990, priceWei: 30_000_000n }))).toBe(false);
    expect(acc.series).toEqual([candle(960, 2e-11, 3e-11, 2e-11, 3e-11)]);
  });

  it("remembers a bounded number of trades", () => {
    const acc = make([]);
    for (let i = 1; i <= 6_000; i++) acc.apply(trade({ n: i, timestamp: 1_000 }));
    expect(acc.rememberedCount()).toBeLessThanOrEqual(5_000);
  });

  it("uses the price AFTER the trade (spot from the new reserves), as the REST candles do", () => {
    const acc = make([]);
    acc.apply(trade({ priceWei: 15_654_338n }));
    expect(acc.series[0]!.close).toBeCloseTo(1.5654338e-11, 20);
  });
});

describe("mergeTrades", () => {
  const rest = (n: number, block = "50") => ({
    id: `11155111-${tx(n)}-0`, trader: "0xa", isBuy: true, quoteAmount: 1n, tokenAmount: 1n, fee: 0n, launchTax: 0n,
    virtualQuoteReserves: 1n, virtualTokenReserves: 1n, timestamp: 1n, blockNumber: BigInt(block), logIndex: 0,
  });

  it("puts a live trade first, newest on top", () => {
    const merged = mergeTrades([rest(1, "40")], [trade({ n: 2 })]); // (the live trade is in block 50)
    expect(merged.map((t) => tradeKey(t.id))).toEqual([`${tx(2)}-0`, `${tx(1)}-0`]);
  });

  it("does not list a trade twice when it came over the socket and the REST feed, though their ids differ", () => {
    const merged = mergeTrades([rest(1)], [trade({ n: 1 })]);
    expect(merged).toHaveLength(1);
  });

  it("does not double-count when the same live trade arrives twice", () => {
    const merged = mergeTrades([rest(1)], [trade({ n: 2 }), trade({ n: 2 })]);
    expect(merged).toHaveLength(2);
  });

  it("keeps only the newest N, so a long-open page does not grow for ever", () => {
    const live = Array.from({ length: 300 }, (_, i) => trade({ n: i + 10 }));
    expect(mergeTrades([], live, 100)).toHaveLength(100);
  });

  it("orders by block and log index, whatever order they arrived in", () => {
    const a = { ...trade({ n: 3, logIndex: 1 }), blockNumber: 60n };
    const b = { ...trade({ n: 4, logIndex: 0 }), blockNumber: 60n };
    const c = { ...trade({ n: 5, logIndex: 0 }), blockNumber: 61n };
    expect(mergeTrades([], [a, b, c]).map((t) => tradeKey(t.id))).toEqual([`${tx(5)}-0`, `${tx(3)}-1`, `${tx(4)}-0`]);
  });
});
