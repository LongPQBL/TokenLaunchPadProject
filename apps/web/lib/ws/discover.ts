import { marketCap, progressBpsFromVirtualTokens } from "@vezta/shared";
import { z } from "zod";
import type { TokenRow, TokenSort } from "../types";
import type { LiveTrade } from "./live";

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((s) => s.toLowerCase());

/** A token created, as the watcher publishes it. */
export const liveCreatedSchema = z.object({
  type: z.literal("created"),
  id: z.string(),
  chain: z.string(),
  token: address,
  creator: address,
  quoteToken: address,
  name: z.string().max(200),
  ticker: z.string().max(100),
  metadataURI: z.string().max(1000),
});
export type LiveCreated = z.output<typeof liveCreatedSchema>;

/**
 * A card for a token that was created a moment ago. Only what the chain event says: the name and ticker, and nothing
 * else, since its image and description are still being resolved. A card with a placeholder picture is exactly what the
 * list already shows for such a token.
 */
export function newTokenItem(created: LiveCreated, nowSeconds: number): TokenRow {
  return {
    address: created.token,
    creator: created.creator,
    name: created.name,
    ticker: created.ticker,
    progressBps: 0,
    volumeQuote: 0n,
    tradeCount: 0,
    complete: false,
    migrated: false,
    createdAt: BigInt(nowSeconds),
  };
}

/**
 * What one trade does to a row: its volume, its count and its progress, and, for a row that has numbers, the market cap (from
 * the reserves the trade left), the ATH if it was passed, and the 24 h volume. What a trade cannot say (the distinct traders,
 * the changes in price) stays as it was until the next refresh. The same item back if the trade is not about it.
 */
export function applyTradeToItem(item: TokenRow, trade: LiveTrade): TokenRow {
  if (item.address.toLowerCase() !== trade.token) return item;
  const stats = item.stats && {
    ...item.stats,
    marketCap: marketCap(trade.virtualQuoteReserves, trade.virtualTokenReserves),
    athMarketCap: (() => {
      const now = marketCap(trade.virtualQuoteReserves, trade.virtualTokenReserves);
      return now > item.stats.athMarketCap ? now : item.stats.athMarketCap;
    })(),
    volume24h: item.stats.volume24h + trade.quoteAmount,
  };
  return {
    ...item,
    volumeQuote: item.volumeQuote + trade.quoteAmount,
    tradeCount: item.tradeCount + 1,
    progressBps: progressBpsFromVirtualTokens(trade.virtualTokenReserves),
    ...(stats ? { stats } : {}),
  };
}

const KEY: Record<TokenSort, (i: TokenRow) => bigint> = {
  new: (i) => i.createdAt,
  volume: (i) => i.volumeQuote,
  progress: (i) => BigInt(i.progressBps),
  mcap: (i) => i.stats?.marketCap ?? 0n,
  txns: (i) => BigInt(i.tradeCount),
  volume24h: (i) => i.stats?.volume24h ?? 0n,
  traders: (i) => BigInt(i.stats?.traders24h ?? 0),
  change1h: (i) => BigInt(i.stats?.change1hBps ?? 0),
  change6h: (i) => BigInt(i.stats?.change6hBps ?? 0),
  change24h: (i) => BigInt(i.stats?.change24hBps ?? 0),
};

/** The API's own order: the view's key, biggest first, ties broken by address descending. */
export function sortItems(items: TokenRow[], sort: TokenSort): TokenRow[] {
  const key = KEY[sort];
  return [...items].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x !== y) return x < y ? 1 : -1;
    return a.address < b.address ? 1 : a.address > b.address ? -1 : 0;
  });
}
