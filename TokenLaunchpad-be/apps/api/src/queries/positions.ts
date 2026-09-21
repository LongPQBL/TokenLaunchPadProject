import { getSql } from "../db.js";
import { listColumns } from "./tokenList.js";

/** Enough of a token to name it in a list: written by strangers, so shown as text (an image URL is scheme-checked by the page). */
export interface TokenBrief {
  address: string;
  name?: string;
  ticker?: string;
  imageUrl?: string;
}

/** More than this many distinct tokens in one wallet is not a real wallet, and one response should stay a sensible size. */
export const MAX_POSITIONS = 200;

export interface Position {
  token: TokenBrief;
  balance: bigint;
  /** What the buys cost: each one's price plus its fee (which includes any launch tax). Raw quote units. */
  spent: bigint;
  /** What the sells paid out: each one's price less its fee. */
  received: bigint;
  buys: number;
  sells: number;
  /** The balance at the price the curve is at now (spot, before the slippage of selling it all). 0 with no reserves. */
  value: bigint;
  /** value + received - spent. For a token that came by transfer (nothing spent) it is the whole value. */
  pnl: bigint;
  /** pnl as basis points of what was spent, or null when nothing was spent (there is nothing to be a percentage of). */
  pnlBps: number | null;
}

/**
 * What an address holds now, with what it cost and what it is worth. Only open positions: a balance above zero. Hidden tokens are
 * INCLUDED, as for holdings: moderation removes a token from the lists and must never make anyone's money unreachable.
 *
 * The amounts follow the contract: a buy pays `quoteAmount + fee` (the fee includes the launch tax), a sell receives
 * `quoteAmount - fee`. Only trades on the curve are counted: a token that was bought elsewhere or received has no cost here.
 */
export async function listPositions(chainId: number, holder: string): Promise<Position[]> {
  const rows = await getSql()`
    select
      ${listColumns(getSql())},
      b.amount::text as balance,
      x.spent::text as spent, x.received::text as received, x.buys::int as buys, x.sells::int as sells,
      v.value::text as value
    from launchpad.balance b
    join launchpad.token t on t.chain_id = b.chain_id and t.address = b.token
    left join app.token_metadata m on m.chain_id = t.chain_id and m.token = t.address
    cross join lateral (
      select
        coalesce(sum(tr.quote_amount + tr.fee) filter (where tr.is_buy), 0) as spent,
        coalesce(sum(tr.quote_amount - tr.fee) filter (where not tr.is_buy), 0) as received,
        count(*) filter (where tr.is_buy) as buys,
        count(*) filter (where not tr.is_buy) as sells
      from launchpad.trade tr
      where tr.chain_id = b.chain_id and tr.token = b.token and tr.trader = b.holder
    ) x
    cross join lateral (
      select case when t.virtual_token_reserves > 0 then floor(b.amount * t.virtual_quote_reserves / t.virtual_token_reserves) else 0 end as value
    ) v
    where b.chain_id = ${chainId} and b.holder = ${holder} and b.amount > 0
    order by v.value desc, t.address
    limit ${MAX_POSITIONS}`;

  return rows.map((r) => {
    const spent = BigInt(r.spent);
    const received = BigInt(r.received);
    const value = BigInt(r.value);
    const pnl = value + received - spent;
    return {
      token: { address: r.address, name: r.meta_name ?? r.chain_name ?? undefined, ticker: r.ticker ?? undefined, imageUrl: r.image_url ?? undefined },
      balance: BigInt(r.balance),
      spent,
      received,
      buys: r.buys,
      sells: r.sells,
      value,
      pnl,
      // Rounded to the nearest basis point, half away from zero, in integers: no floating point near money.
      pnlBps: spent > 0n ? Number((pnl * 10_000n * 2n + (pnl < 0n ? -spent : spent)) / (spent * 2n)) : null,
    };
  });
}

export class BadOrderCursorError extends Error {
  constructor() {
    super("Malformed cursor");
  }
}

export interface Order {
  id: string;
  txHash: string;
  token: TokenBrief;
  isBuy: boolean;
  quoteAmount: bigint;
  fee: bigint;
  /** What was really paid (a buy: price + fee) or received (a sell: price - fee). */
  total: bigint;
  tokenAmount: bigint;
  /** Quote per whole token that this trade was done at (its price, before the fee). */
  price: bigint;
  timestamp: bigint;
  blockNumber: bigint;
  logIndex: number;
}

/** A position in the history: [blockNumber, logIndex], as for a token's own trade feed. */
function decodeCursor(cursor: string): [string, number] {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      Array.isArray(v) && v.length === 2 &&
      typeof v[0] === "string" && /^\d{1,78}$/.test(v[0]) &&
      typeof v[1] === "number" && Number.isInteger(v[1]) && v[1] >= 0 && v[1] <= 2_147_483_647
    ) {
      return [v[0], v[1]];
    }
  } catch {
    /* fall through */
  }
  throw new BadOrderCursorError();
}

/**
 * Every trade an address made on the launchpad, on every token, newest first (by block and log index, which is the order the chain
 * applied them in). Hidden tokens are included: this is the person's own history.
 */
export async function listOrders(chainId: number, trader: string, opts: { limit: number; cursor?: string }): Promise<{ items: Order[]; nextCursor?: string }> {
  const sql = getSql();
  const after = opts.cursor
    ? (([block, log]) => sql`and (tr.block_number, tr.log_index) < (${block}::numeric, ${log}::int)`)(decodeCursor(opts.cursor))
    : sql``;

  const rows = await sql`
    select
      tr.id, tr.is_buy, tr.quote_amount::text as quote_amount, tr.fee::text as fee, tr.token_amount::text as token_amount,
      tr."timestamp"::text as timestamp, tr.block_number::text as block_number, tr.log_index,
      ${listColumns(sql)}
    from launchpad.trade tr
    join launchpad.token t on t.chain_id = tr.chain_id and t.address = tr.token
    left join app.token_metadata m on m.chain_id = t.chain_id and m.token = t.address
    where tr.chain_id = ${chainId} and tr.trader = ${trader} ${after}
    order by tr.block_number desc, tr.log_index desc
    limit ${opts.limit + 1}`;

  const page = rows.slice(0, opts.limit);
  const items: Order[] = page.map((r) => {
    const quoteAmount = BigInt(r.quote_amount);
    const fee = BigInt(r.fee);
    const tokenAmount = BigInt(r.token_amount);
    return {
      id: r.id,
      // The id is `<chain id>-<transaction hash>-<log index>`.
      txHash: String(r.id).split("-").at(-2) ?? "",
      token: { address: r.address, name: r.meta_name ?? r.chain_name ?? undefined, ticker: r.ticker ?? undefined, imageUrl: r.image_url ?? undefined },
      isBuy: r.is_buy,
      quoteAmount,
      fee,
      total: r.is_buy ? quoteAmount + fee : quoteAmount - fee,
      tokenAmount,
      price: tokenAmount > 0n ? (quoteAmount * 10n ** 18n) / tokenAmount : 0n,
      timestamp: BigInt(r.timestamp),
      blockNumber: BigInt(r.block_number),
      logIndex: r.log_index,
    };
  });
  const last = page.at(-1);
  return rows.length > opts.limit && last
    ? { items, nextCursor: Buffer.from(JSON.stringify([last.block_number, last.log_index])).toString("base64url") }
    : { items };
}
