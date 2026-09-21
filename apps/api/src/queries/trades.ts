import { getSql } from "../db.js";

export class BadTradeCursorError extends Error {
  constructor() {
    super("Malformed cursor");
  }
}

export interface Trade {
  id: string;
  trader: string;
  isBuy: boolean;
  quoteAmount: bigint;
  tokenAmount: bigint;
  fee: bigint;
  launchTax: bigint;
  virtualQuoteReserves: bigint;
  virtualTokenReserves: bigint;
  timestamp: bigint;
  blockNumber: bigint;
  logIndex: number;
}

/** A position in the feed: [blockNumber, logIndex]. Both are needed, since one block can hold many trades. */
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
  throw new BadTradeCursorError();
}

/**
 * Newest first, ordered by (block_number, log_index). Every trade in a block shares a timestamp and the id
 * sorts by transaction hash, so neither can recover the order the chain applied them in; log_index can.
 */
export async function listTrades(
  chainId: number,
  token: string,
  opts: { limit: number; cursor?: string },
): Promise<{ items: Trade[]; nextCursor?: string }> {
  const sql = getSql();
  const after = opts.cursor
    ? (([block, log]) => sql`and (block_number, log_index) < (${block}::numeric, ${log}::int)`)(decodeCursor(opts.cursor))
    : sql``;

  const rows = await sql`
    select id, trader, is_buy, quote_amount, token_amount, fee, launch_tax,
           virtual_quote_reserves, virtual_token_reserves, "timestamp", block_number, log_index
    from launchpad.trade
    where chain_id = ${chainId} and token = ${token} ${after}
    order by block_number desc, log_index desc
    limit ${opts.limit + 1}`;

  const page = rows.slice(0, opts.limit);
  const items: Trade[] = page.map((r) => ({
    id: r.id,
    trader: r.trader,
    isBuy: r.is_buy,
    quoteAmount: BigInt(r.quote_amount),
    tokenAmount: BigInt(r.token_amount),
    fee: BigInt(r.fee),
    launchTax: BigInt(r.launch_tax),
    virtualQuoteReserves: BigInt(r.virtual_quote_reserves),
    virtualTokenReserves: BigInt(r.virtual_token_reserves),
    timestamp: BigInt(r.timestamp),
    blockNumber: BigInt(r.block_number),
    logIndex: r.log_index,
  }));
  const last = page.at(-1);
  return rows.length > opts.limit && last
    ? { items, nextCursor: Buffer.from(JSON.stringify([String(last.block_number), last.log_index])).toString("base64url") }
    : { items };
}
