import type postgres from "postgres";
import { getSql } from "../db.js";

export type Sort = "new" | "volume" | "progress" | "mcap" | "txns" | "volume24h" | "traders" | "change1h" | "change6h" | "change24h";

const NUMERIC_MAX = 10n ** 78n - 1n; // numeric(78,0)
const INT_MAX = 2_147_483_647n; // a value past this makes Postgres throw

/**
 * Each sort key maps to the SQL expression it orders by (`t` is the token, `s` its numbers, see `statsLateral`) and to the cast
 * and the range its cursor value needs. These are constants: nothing from a request ever becomes part of the SQL text, only
 * bound parameters do. A change in price can be negative, and so can a cursor into one.
 */
export const SORTS: Record<Sort, { expr: string; cast: string; min: bigint; max: bigint }> = {
  new: { expr: "t.created_at", cast: "numeric", min: 0n, max: NUMERIC_MAX },
  volume: { expr: "t.volume_quote", cast: "numeric", min: 0n, max: NUMERIC_MAX },
  progress: { expr: "t.progress_bps", cast: "int", min: 0n, max: INT_MAX },
  mcap: { expr: "s.mcap", cast: "numeric", min: 0n, max: NUMERIC_MAX },
  txns: { expr: "t.trade_count", cast: "int", min: 0n, max: INT_MAX },
  volume24h: { expr: "s.vol24h", cast: "numeric", min: 0n, max: NUMERIC_MAX },
  traders: { expr: "s.traders24h", cast: "int", min: 0n, max: INT_MAX },
  change1h: { expr: "s.change1h", cast: "numeric", min: -10_000n, max: NUMERIC_MAX },
  change6h: { expr: "s.change6h", cast: "numeric", min: -10_000n, max: NUMERIC_MAX },
  change24h: { expr: "s.change24h", cast: "numeric", min: -10_000n, max: NUMERIC_MAX },
};

export class BadCursorError extends Error {
  constructor() {
    super("Malformed cursor");
  }
}

export interface TokenListItem {
  address: string;
  creator: string;
  name?: string;
  ticker?: string;
  description?: string;
  imageUrl?: string;
  progressBps: number;
  volumeQuote: bigint;
  tradeCount: number;
  complete: boolean;
  migrated: boolean;
  createdAt: bigint;
}

/** What a row of the list shows besides the token itself, worked out from its trades. Amounts are in the quote's raw units. */
export interface TokenStats {
  /** Fully diluted market cap now, and the highest it has been (the launch price counts). */
  marketCap: bigint;
  athMarketCap: bigint;
  volume24h: bigint;
  /** Distinct addresses that traded in the last 24 hours. */
  traders24h: number;
  /** Price now against the last price at or before the window's start, in basis points; against the launch price if the token is younger than the window; 0 if it has never traded. */
  change1hBps: number;
  change6hBps: number;
  change24hBps: number;
}

export type TokenRow = TokenListItem & { stats: TokenStats };

/**
 * Row -> item, shared with the detail query. Expects the columns both select: `meta_name` is already null
 * unless the metadata is ok, so a pending or invalid row can never rename or re-image a token.
 */
export function mapListRow(r: postgres.Row): TokenListItem {
  return {
    address: r.address,
    creator: r.creator,
    name: r.meta_name ?? r.chain_name ?? undefined,
    ticker: r.ticker ?? undefined,
    description: r.description ?? undefined,
    imageUrl: r.image_url ?? undefined,
    progressBps: r.progress_bps,
    volumeQuote: BigInt(r.volume_quote),
    tradeCount: r.trade_count,
    complete: r.complete,
    migrated: r.migrated,
    createdAt: BigInt(r.created_at),
  };
}

/**
 * The columns `mapListRow` reads, for a query over `launchpad.token t` left-joined to `app.token_metadata m`. One place, so every
 * list of tokens shows the same thing and none of them can take a name or an image from a row that is not `ok`.
 */
export const listColumns = (sql: postgres.Sql) => sql`
      t.address, t.creator, t.ticker, t.progress_bps, t.volume_quote, t.trade_count, t.complete, t.migrated, t.created_at,
      t.name as chain_name,
      case when m.status = 'ok' then m.name end as meta_name,
      case when m.status = 'ok' then m.description end as description,
      case when m.status = 'ok' then m.image_cdn_url end as image_url`;

/**
 * The numbers a table of tokens shows, as a lateral join so they are worked out only for the rows a page needs (a sort on
 * a stored column stops early) and are available to ORDER BY when the sort is one of them.
 *
 * Price is the spot price after a trade, `virtual quote * 1e18 / virtual token` (the same as the chart). The launch price is
 * not stored: the curve's virtual reserves start at G/3 and 16/15 of the supply, and G follows from the reserves at any
 * point (`graduationAmountFromReserves`), so vq0 * 1e18 / vt0 works out to 225 * vq * vt * 1e18 / (256 * S^2). Nothing is
 * divided by a missing reserve: a token whose reserves are not set has no price, and reads as zero everywhere.
 */
const statsLateral = (sql: postgres.Sql) => sql`
    cross join lateral (
      select
        floor(coalesce(p.price_now, 0) * 1000000000) as mcap,
        floor(greatest(coalesce(x.max_price, 0), coalesce(floor(p.launch), 0), coalesce(p.price_now, 0)) * 1000000000) as ath,
        coalesce(x.vol24h, 0) as vol24h,
        x.traders24h as traders24h,
        ${change(sql, "x.p1h")} as change1h,
        ${change(sql, "x.p6h")} as change6h,
        ${change(sql, "x.p24h")} as change24h
      from (
        select
          case when t.virtual_quote_reserves > 0 and t.virtual_token_reserves > 0
            then floor(t.virtual_quote_reserves * 1000000000000000000 / t.virtual_token_reserves) end as price_now,
          case when t.virtual_quote_reserves > 0 and t.virtual_token_reserves > 0
            then 225 * t.virtual_quote_reserves * t.virtual_token_reserves * 1000000000000000000 / (256 * power(10::numeric, 54)) end as launch
      ) p
      cross join lateral (
        select
          max(tr.price) as max_price,
          sum(tr.quote_amount) filter (where tr.ts >= tr.now_s - 86400) as vol24h,
          count(distinct tr.trader) filter (where tr.ts >= tr.now_s - 86400) as traders24h,
          (array_agg(tr.price order by tr.block_number desc, tr.log_index desc) filter (where tr.ts <= tr.now_s - 3600))[1] as p1h,
          (array_agg(tr.price order by tr.block_number desc, tr.log_index desc) filter (where tr.ts <= tr.now_s - 21600))[1] as p6h,
          (array_agg(tr.price order by tr.block_number desc, tr.log_index desc) filter (where tr.ts <= tr.now_s - 86400))[1] as p24h
        from (
          select
            floor(r.virtual_quote_reserves * 1000000000000000000 / nullif(r.virtual_token_reserves, 0)) as price,
            r.quote_amount, r.trader, r.block_number, r.log_index,
            r."timestamp" as ts, extract(epoch from now()) as now_s
          from launchpad.trade r
          where r.chain_id = t.chain_id and r.token = t.address
        ) tr
      ) x
    ) s`;

/** Price now against a reference price (or the launch price when there is none), as a whole number of basis points. */
const change = (sql: postgres.Sql, reference: string) => sql`
  case when p.price_now > 0 and coalesce(${sql.unsafe(reference)}, floor(p.launch)) > 0
    then round((p.price_now - coalesce(${sql.unsafe(reference)}, floor(p.launch))) * 10000 / coalesce(${sql.unsafe(reference)}, floor(p.launch)))
    else 0 end`;

export interface ListTokensOptions {
  chainId: number;
  sort: Sort;
  cursor?: string;
  limit: number;
  /** Search text. A full 0x address is a direct lookup; anything else matches name or ticker. */
  q?: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const MAX_QUERY_LENGTH = 64;

/**
 * The WHERE fragment for a search, or nothing for a blank query.
 *
 * In LIKE, % and _ are wildcards, so they are escaped: typed by a user they are plain characters, or a
 * search for "%" would list every token. The pattern is a bound parameter, never part of the SQL text.
 * Only metadata with status 'ok' contributes its name; a pending row's name is unverified data.
 * A token with no metadata row is matched on its on-chain name and ticker, so a brand-new token is findable.
 */
function searchFilter(sql: ReturnType<typeof getSql>, q: string | undefined) {
  const term = q?.trim().slice(0, MAX_QUERY_LENGTH);
  if (!term) return sql``;
  if (ADDRESS.test(term)) return sql`and t.address = ${term.toLowerCase()}`;
  const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
  return sql`and (coalesce(case when m.status = 'ok' then m.name end, t.name) ilike ${pattern} or t.ticker ilike ${pattern})`;
}

/**
 * A cursor is `[sortValue, address]`: a position in the ordering, not a row id, so it survives deletions.
 * The value must also fit the sort's column: it is cast to that type in SQL, and one that does not fit would
 * be a database error, a 500, for what is really a bad request.
 */
function decodeCursor(cursor: string, min: bigint, max: bigint): [string, string] {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      Array.isArray(v) &&
      v.length === 2 &&
      typeof v[0] === "string" &&
      /^-?\d{1,78}$/.test(v[0]) &&
      BigInt(v[0]) >= min &&
      BigInt(v[0]) <= max &&
      typeof v[1] === "string" &&
      /^0x[0-9a-f]{1,64}$/.test(v[1])
    ) {
      return [v[0], v[1]];
    }
  } catch {
    /* fall through */
  }
  throw new BadCursorError();
}

const encodeCursor = (sortValue: string, address: string) =>
  Buffer.from(JSON.stringify([sortValue, address])).toString("base64url");

export async function listTokens(opts: ListTokensOptions): Promise<{ items: TokenRow[]; nextCursor?: string }> {
  const sql = getSql();
  const { expr, cast, min, max } = SORTS[opts.sort];
  const key = sql.unsafe(expr);

  // The tuple comparison is the cursor. `address` breaks ties, so tokens that share a volume are still
  // in a total order and pagination can neither repeat nor skip one.
  const after = opts.cursor
    ? (([value, address]) => sql`and (${key}, t.address) < (${value}::${sql.unsafe(cast)}, ${address})`)(decodeCursor(opts.cursor, min, max))
    : sql``;

  // LEFT JOIN, not JOIN: a token created seconds ago has no metadata row yet and must still appear.
  // coalesce(m.status,'pending'): `NULL <> 'hidden'` is NULL in SQL, which would silently drop exactly
  // those new tokens.
  // Metadata fields are used only when status = 'ok': a pending or invalid row can hold partial or hostile data.
  const rows = await sql`
    select
      ${listColumns(sql)},
      s.mcap::text as mcap, s.ath::text as ath, s.vol24h::text as vol24h, s.traders24h::int as traders24h,
      s.change1h::text as change1h, s.change6h::text as change6h, s.change24h::text as change24h,
      ${key}::text as sort_value
    from launchpad.token t
    left join app.token_metadata m on m.chain_id = t.chain_id and m.token = t.address
    ${statsLateral(sql)}
    where t.chain_id = ${opts.chainId}
      and coalesce(m.status, 'pending') <> 'hidden'
      ${searchFilter(sql, opts.q)}
      ${after}
    order by ${key} desc, t.address desc
    limit ${opts.limit + 1}`;

  const page = rows.slice(0, opts.limit);
  const items: TokenRow[] = page.map((r) => ({
    ...mapListRow(r),
    stats: {
      marketCap: BigInt(r.mcap),
      athMarketCap: BigInt(r.ath),
      volume24h: BigInt(r.vol24h),
      traders24h: r.traders24h,
      change1hBps: Number(r.change1h),
      change6hBps: Number(r.change6h),
      change24hBps: Number(r.change24h),
    },
  }));

  const last = page.at(-1);
  return rows.length > opts.limit && last ? { items, nextCursor: encodeCursor(last.sort_value, last.address) } : { items };
}
