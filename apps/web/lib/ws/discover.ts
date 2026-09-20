import { progressBpsFromVirtualTokens } from "@vezta/shared";
import { z } from "zod";
import type { TokenListItem, TokenSort } from "../types";
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
export function newTokenItem(created: LiveCreated, nowSeconds: number): TokenListItem {
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

/** What one trade does to a card: its volume, its count and its progress. The same item back if the trade is not about it. */
export function applyTradeToItem(item: TokenListItem, trade: LiveTrade): TokenListItem {
  if (item.address.toLowerCase() !== trade.token) return item;
  return {
    ...item,
    volumeQuote: item.volumeQuote + trade.quoteAmount,
    tradeCount: item.tradeCount + 1,
    progressBps: progressBpsFromVirtualTokens(trade.virtualTokenReserves),
  };
}

const KEY: Record<TokenSort, (i: TokenListItem) => bigint> = {
  new: (i) => i.createdAt,
  volume: (i) => i.volumeQuote,
  progress: (i) => BigInt(i.progressBps),
};

/** The API's own order: the view's key, biggest first, ties broken by address descending. */
export function sortItems(items: TokenListItem[], sort: TokenSort): TokenListItem[] {
  const key = KEY[sort];
  return [...items].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x !== y) return x < y ? 1 : -1;
    return a.address < b.address ? 1 : a.address > b.address ? -1 : 0;
  });
}
