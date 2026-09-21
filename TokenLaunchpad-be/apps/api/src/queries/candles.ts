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
 * The price of a candle is the SPOT price of the curve (virtual quote / virtual token), not the average price paid: one huge buy would
 * otherwise print a misleading average, whereas with spot prices the last close equals the current price and, after graduation, the
 * pool's starting price.
 *
 * A candle OPENS at the price before its first trade. A Trade event carries the reserves after the trade, and the price before it follows
 * from what moved: a buy put `quoteAmount` into the curve and took `tokenAmount` out of it, a sell did the reverse. Opening at the price
 * AFTER the first trade (as this once did) makes a candle of one trade a flat line, so a lone sell never showed as a candle going down;
 * opening at the price before makes every candle open where the one before it closed, and the first candle of a token open at its launch
 * price. It needs no other trade, so it does not depend on `from` or on the newest-candles limit. A trade whose amounts do not agree with
 * its reserves (they would leave the curve with nothing before it) has no price before it, and its own price is used instead.
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
        select "timestamp" as ts, block_number, log_index, quote_amount, virtual_quote_reserves * 1000000000000000000 / virtual_token_reserves as price,
               -- the reserves before the trade: a buy took tokens out of the curve and put quote in, a sell the reverse
               virtual_quote_reserves + case when is_buy then -quote_amount else quote_amount end as q_before,
               virtual_token_reserves + case when is_buy then token_amount else -token_amount end as t_before
        from launchpad.trade
        where chain_id = ${chainId} and token = ${token} and "timestamp" >= ${start} and virtual_token_reserves > 0
      ),
      p as (
        select ts, block_number, log_index, quote_amount, price,
               coalesce(case when q_before > 0 and t_before > 0 then q_before * 1000000000000000000 / t_before end, price) as before
        from t
      )
      select (floor(ts / ${interval}) * ${interval})::bigint as time,
             (array_agg(before order by block_number, log_index))[1]::text as open,
             greatest(max(price), max(before))::text as high,
             least(min(price), min(before))::text as low,
             (array_agg(price order by block_number desc, log_index desc))[1]::text as close,
             sum(quote_amount)::text as volume
      from p
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
