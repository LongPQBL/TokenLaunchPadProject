import { marketCap } from "@vezta/shared";
import { describe, expect, it } from "vitest";
import type { TokenRow } from "@/lib/types";
import { applyTradeToItem, liveCreatedSchema, newTokenItem, sortItems } from "./discover";
import { liveTradeSchema } from "./live";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

const item = (o: Partial<TokenRow> = {}): TokenRow => ({
  address: A, creator: "0xc0ffee", name: "Demo", ticker: "DEMO", progressBps: 0, volumeQuote: 0n, tradeCount: 0, complete: false, migrated: false, createdAt: 100n, ...o,
});
const trade = (o: { token?: string; quote?: string; vT?: string } = {}) =>
  liveTradeSchema.parse({
    type: "trade", id: `${tx(1)}-0`, chain: "sepolia", token: o.token ?? A, trader: B, isBuy: true, quoteAmount: o.quote ?? "1000", tokenAmount: "1",
    fee: "0", launchTax: "0", virtualQuoteReserves: "1", virtualTokenReserves: o.vT ?? String((10n ** 27n * 16n) / 15n - (10n ** 27n * 2n) / 5n),
    timestamp: "1", blockNumber: "1", txHash: tx(1), logIndex: 0,
  });

describe("liveCreatedSchema and newTokenItem", () => {
  const wire = { type: "created", id: `${tx(2)}-0`, chain: "sepolia", token: A.toUpperCase().replace("0X", "0x"), creator: B, quoteToken: "0x00000000000000000000000000000000000000e5", name: "Fresh", ticker: "FRSH", metadataURI: "ipfs://bafyabcde", blockNumber: "9", txHash: tx(2), logIndex: 0 };

  it("reads a created token as the watcher publishes it", () => {
    const c = liveCreatedSchema.parse(wire);
    expect(c.token).toBe(A);
    expect(c.name).toBe("Fresh");
  });

  it("refuses what is not one", () => {
    for (const bad of [{ ...wire, type: "trade" }, { ...wire, token: "0x12" }, { ...wire, name: 5 }, null]) expect(liveCreatedSchema.safeParse(bad).success).toBe(false);
  });

  it("makes a card from it: the on-chain name and ticker, nothing else known yet, and no image", () => {
    const i = newTokenItem(liveCreatedSchema.parse(wire), 5_000);
    expect(i).toMatchObject({ address: A, creator: B, name: "Fresh", ticker: "FRSH", progressBps: 0, volumeQuote: 0n, tradeCount: 0, complete: false, migrated: false, createdAt: 5_000n });
    expect(i.imageUrl).toBeUndefined();
    expect(i.description).toBeUndefined();
  });
});

describe("applyTradeToItem: the numbers on a table row", () => {
  const stats = { marketCap: 100n, athMarketCap: 500n, volume24h: 1_000n, traders24h: 3, change1hBps: 10, change6hBps: 20, change24hBps: 30 };
  const withStats = (o: Partial<typeof stats> = {}) => ({ ...item(), stats: { ...stats, ...o } });
  const at = (vq: string, vt: string, quote = "1000") =>
    liveTradeSchema.parse({
      type: "trade", id: `${tx(1)}-0`, chain: "sepolia", token: A, trader: B, isBuy: true, quoteAmount: quote, tokenAmount: "1", fee: "0", launchTax: "0",
      virtualQuoteReserves: vq, virtualTokenReserves: vt, timestamp: "1", blockNumber: "1", txHash: tx(1), logIndex: 0,
    });

  it("moves the market cap to where the reserves put it, and the 24 h volume up by the trade", () => {
    const next = applyTradeToItem(withStats(), at("3000000000000000000", "1000000000000000000000000000", "700"));
    expect(next.stats).toMatchObject({ marketCap: marketCap(3_000_000_000_000_000_000n, 1_000_000_000_000_000_000_000_000_000n), volume24h: 1_700n });
  });

  it("raises the ATH when the market cap passes it, and leaves it alone when it does not", () => {
    const high = applyTradeToItem(withStats({ athMarketCap: 5n }), at("3000000000000000000", "1000000000000000000000000000"));
    expect(high.stats!.athMarketCap).toBe(high.stats!.marketCap);
    const low = applyTradeToItem(withStats(), at("3000000000000000000", "1000000000000000000000000000"));
    expect(low.stats!.athMarketCap).toBe(low.stats!.marketCap > 500n ? low.stats!.marketCap : 500n);
  });

  it("leaves what a trade cannot tell it (distinct traders, the changes) as they were: they come with the next refresh", () => {
    const next = applyTradeToItem(withStats(), at("3000000000000000000", "1000000000000000000000000000"));
    expect(next.stats).toMatchObject({ traders24h: 3, change1hBps: 10, change6hBps: 20, change24hBps: 30 });
  });

  it("does not invent numbers for a row that has none", () => {
    expect(applyTradeToItem(item(), at("3000000000000000000", "1000000000000000000000000000")).stats).toBeUndefined();
  });
});

describe("applyTradeToItem", () => {
  it("adds the trade's curve price to the volume and one to the count", () => {
    const next = applyTradeToItem(item({ volumeQuote: 500n, tradeCount: 2 }), trade({ quote: "1000" }));
    expect(next).toMatchObject({ volumeQuote: 1500n, tradeCount: 3 });
  });

  it("moves the progress bar to where the reserves say the curve is", () => {
    const next = applyTradeToItem(item(), trade()); // 2/5 of the supply sold = half of the sellable 80%
    expect(next.progressBps).toBe(5_000);
  });

  it("leaves a token it is not about exactly as it was: the same object", () => {
    const before = item({ address: B });
    expect(applyTradeToItem(before, trade({ token: A }))).toBe(before);
  });

  it("does not change the item it was given", () => {
    const before = item({ volumeQuote: 1n });
    applyTradeToItem(before, trade());
    expect(before.volumeQuote).toBe(1n);
  });
});

describe("sortItems", () => {
  const items = [
    item({ address: "0x00000000000000000000000000000000000000a1", createdAt: 100n, volumeQuote: 5n, progressBps: 10 }),
    item({ address: "0x00000000000000000000000000000000000000a2", createdAt: 300n, volumeQuote: 1n, progressBps: 90 }),
    item({ address: "0x00000000000000000000000000000000000000a3", createdAt: 200n, volumeQuote: 9n, progressBps: 50 }),
  ];
  const order = (sort: "new" | "volume" | "progress") => sortItems(items, sort).map((i) => i.address.slice(-2));

  it("orders by the view's own key, biggest first", () => {
    expect(order("new")).toEqual(["a2", "a3", "a1"]);
    expect(order("volume")).toEqual(["a3", "a1", "a2"]);
    expect(order("progress")).toEqual(["a2", "a3", "a1"]);
  });

  it("breaks a tie by address, descending, exactly as the API does, so a page and its next page never disagree", () => {
    const tied = [item({ address: "0x00000000000000000000000000000000000000a1", volumeQuote: 7n }), item({ address: "0x00000000000000000000000000000000000000a5", volumeQuote: 7n })];
    expect(sortItems(tied, "volume").map((i) => i.address.slice(-2))).toEqual(["a5", "a1"]);
  });

  it("does not change the array it was given", () => {
    const copy = [...items];
    sortItems(items, "volume");
    expect(items).toEqual(copy);
  });
});
