import { getSql } from "../db.js";

/** One request never returns more than this many candles: at interval=1 a busy token would otherwise be unbounded. */
export const MAX_CANDLES = 1000;

export interface Candle {
  /** Start of the bucket, unix seconds. */
  time: number;
  /** Raw quote units per whole token, as decimal strings: full precision, no floats, no exponents. */
  open: string;
  high: string;
  low: string;
  close: string;
  /** Sum of the curve price (before fees) of every trade in the bucket, in raw quote units. */
  volume: string;
}

/**
 * OHLC candles for a chart, built from trades, oldest first.
 *
 * The price of a candle is the SPOT price right after each trade (virtual quote / virtual token), not the
 * average price paid: one huge buy would otherwise print a misleading average, whereas with spot prices the
 * last close equals the current price and, after graduation, the pool's starting price.
 *
 * Open and close are picked by (block_number, log_index). Ordering by (timestamp, id) would be wrong: all the
 * trades in a block share a timestamp, and id is the text "<chain>-<txHash>-<logIndex>", so it sorts by
 * transaction hash. With two trades in one block the open and close would be chosen at random.
 */
export async function getCandles(chainId: number, token: string, intervalSeconds: number, from = 0): Promise<Candle[]> {
  const interval = Number.isFinite(intervalSeconds) ? Math.max(1, Math.floor(intervalSeconds)) : 1;
  const start = Number.isFinite(from) ? Math.max(0, Math.floor(from)) : 0;

  // virtual_token_reserves > 0 keeps one malformed row from turning the whole chart into a division by zero.
  // The inner query takes the NEWEST MAX_CANDLES buckets; the outer one puts them back in chronological order.
  const rows = await getSql()`
    select time, open, high, low, close, volume from (
      with t as (
        select "timestamp" as ts, block_number, log_index, quote_amount,
               virtual_quote_reserves * 1000000000000000000 / virtual_token_reserves as price
        from launchpad.trade
        where chain_id = ${chainId} and token = ${token} and "timestamp" >= ${start} and virtual_token_reserves > 0
      )
      select (floor(ts / ${interval}) * ${interval})::bigint as time,
             (array_agg(price order by block_number, log_index))[1]::text as open,
             max(price)::text as high,
             min(price)::text as low,
             (array_agg(price order by block_number desc, log_index desc))[1]::text as close,
             sum(quote_amount)::text as volume
      from t
      group by 1
      order by 1 desc
      limit ${MAX_CANDLES}
    ) newest
    order by time`;

  return rows.map((r) => ({
    time: Number(r.time),
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
}
