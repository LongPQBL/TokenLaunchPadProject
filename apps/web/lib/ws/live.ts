import { z } from "zod";
import type { ChartCandle } from "../candles";
import type { Trade } from "../types";

const amount = z
  .string()
  .regex(/^\d+$/, "expected a non-negative integer string")
  .transform((s) => BigInt(s));
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((s) => s.toLowerCase());
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

/** A trade as the watcher publishes it. Everything from the wire is checked: a malformed message is dropped, never drawn. */
export const liveTradeSchema = z.object({
  type: z.literal("trade"),
  id: z.string(),
  chain: z.string(),
  token: address,
  trader: address,
  isBuy: z.boolean(),
  quoteAmount: amount,
  tokenAmount: amount,
  fee: amount,
  launchTax: amount,
  virtualQuoteReserves: amount,
  virtualTokenReserves: amount,
  timestamp: amount,
  blockNumber: amount,
  txHash: hash,
  logIndex: z.number().int().nonnegative(),
});
export type LiveTrade = z.output<typeof liveTradeSchema>;

/**
 * What makes a trade THE trade: its transaction and its position in it. The socket names it `<txHash>-<logIndex>` and the
 * REST feed `<chainId>-<txHash>-<logIndex>`; this is the part they share, so the same trade is recognised whichever way it
 * arrived (and whenever a reorg delivers it again).
 */
export const tradeKey = (id: string): string => id.split("-").slice(-2).join("-");

/** The REST feed's shape, so a live trade sits in the same list as the ones fetched. */
export function liveToTrade(t: LiveTrade): Trade {
  return {
    id: `${t.txHash}-${t.logIndex}`,
    trader: t.trader,
    isBuy: t.isBuy,
    quoteAmount: t.quoteAmount,
    tokenAmount: t.tokenAmount,
    fee: t.fee,
    launchTax: t.launchTax,
    virtualQuoteReserves: t.virtualQuoteReserves,
    virtualTokenReserves: t.virtualTokenReserves,
    timestamp: t.timestamp,
    blockNumber: t.blockNumber,
    logIndex: t.logIndex,
  };
}

/** Newest first, no trade twice, at most `limit` of them. Order is by block and log index, whatever order they arrived in. */
export function mergeTrades(fetched: Trade[], live: LiveTrade[], limit = 200): Trade[] {
  const byKey = new Map<string, Trade>();
  for (const trade of fetched) byKey.set(tradeKey(trade.id), trade);
  for (const trade of live) if (!byKey.has(tradeKey(`${trade.txHash}-${trade.logIndex}`))) byKey.set(tradeKey(`${trade.txHash}-${trade.logIndex}`), liveToTrade(trade));
  return [...byKey.values()]
    .sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber < b.blockNumber ? 1 : -1))
    .slice(0, limit);
}

const MAX_SEEN = 5_000;

/**
 * The live end of a chart. It starts from the candles that were fetched and moves them as trades arrive: the last candle in
 * place for a trade in its bucket, a new one for the next bucket. A trade it has already applied (a reorg redelivers,
 * and so can a poll racing the socket) is ignored, so nothing is counted twice; so is a trade for another token, and one
 * older than the newest bucket (that needs a refetch, not a patch). It never changes the series it was given.
 */
export function createCandleAccumulator({ token, interval, decimals, initial }: { token: string; interval: number; decimals: number; initial: ChartCandle[] }) {
  let series = initial;
  const seen = new Set<string>();
  const wanted = token.toLowerCase();

  /** The spot price after the trade, as whole quote units per token: the same price the REST candles are built from. */
  const priceOf = (t: LiveTrade) => (t.virtualTokenReserves > 0n ? Number(`${(t.virtualQuoteReserves * 10n ** 18n) / t.virtualTokenReserves}e-${decimals}`) : 0);

  return {
    get series() {
      return series;
    },
    /** True if the series changed. */
    apply(t: LiveTrade): boolean {
      if (t.token !== wanted) return false;
      const key = tradeKey(`${t.txHash}-${t.logIndex}`);
      if (seen.has(key)) return false;
      seen.add(key);
      if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value!);

      const price = priceOf(t);
      const bucket = Math.floor(Number(t.timestamp) / interval) * interval;
      const last = series.at(-1);
      if (!last) {
        series = [{ time: bucket, open: price, high: price, low: price, close: price }];
        return true;
      }
      if (bucket < last.time) return false;
      if (bucket === last.time) {
        series = [...series.slice(0, -1), { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price }];
        return true;
      }
      series = [...series, { time: bucket, open: price, high: price, low: price, close: price }];
      return true;
    },
    /** After a refetch: the fetched candles are the truth. Trades already seen stay seen. */
    replace(next: ChartCandle[]) {
      series = next;
    },
    rememberedCount: () => seen.size,
  };
}
