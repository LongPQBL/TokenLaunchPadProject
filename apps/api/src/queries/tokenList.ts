import type postgres from "postgres";
import { getSql } from "../db.js";

export type Sort = "new" | "volume" | "progress";

/**
 * Each sort key maps to a column and to the cast its cursor value needs. These are constants: nothing
 * from a request ever becomes part of the SQL text, only bound parameters do.
 */
export const SORTS: Record<Sort, { column: string; cast: string }> = {
  new: { column: "created_at", cast: "numeric" },
  volume: { column: "volume_quote", cast: "numeric" },
  progress: { column: "progress_bps", cast: "int" },
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

/** A cursor is `[sortValue, address]`: a position in the ordering, not a row id, so it survives deletions. */
function decodeCursor(cursor: string): [string, string] {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      Array.isArray(v) &&
      v.length === 2 &&
      typeof v[0] === "string" &&
      /^\d{1,78}$/.test(v[0]) &&
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

export async function listTokens(opts: ListTokensOptions): Promise<{ items: TokenListItem[]; nextCursor?: string }> {
  const sql = getSql();
  const { column, cast } = SORTS[opts.sort];
  const col = sql(column);

  // The tuple comparison is the cursor. `address` breaks ties, so tokens that share a volume are still
  // in a total order and pagination can neither repeat nor skip one.
  const after = opts.cursor
    ? (([value, address]) => sql`and (t.${col}, t.address) < (${value}::${sql.unsafe(cast)}, ${address})`)(decodeCursor(opts.cursor))
    : sql``;

  // LEFT JOIN, not JOIN: a token created seconds ago has no metadata row yet and must still appear.
  // coalesce(m.status,'pending'): `NULL <> 'hidden'` is NULL in SQL, which would silently drop exactly
  // those new tokens.
  // Metadata fields are used only when status = 'ok': a pending or invalid row can hold partial or hostile data.
  const rows = await sql`
    select
      t.address, t.creator, t.ticker, t.progress_bps, t.volume_quote, t.trade_count, t.complete, t.migrated, t.created_at,
      t.name as chain_name,
      case when m.status = 'ok' then m.name end as meta_name,
      case when m.status = 'ok' then m.description end as description,
      case when m.status = 'ok' then m.image_cdn_url end as image_url,
      t.${col}::text as sort_value
    from launchpad.token t
    left join app.token_metadata m on m.chain_id = t.chain_id and m.token = t.address
    where t.chain_id = ${opts.chainId}
      and coalesce(m.status, 'pending') <> 'hidden'
      ${searchFilter(sql, opts.q)}
      ${after}
    order by t.${col} desc, t.address desc
    limit ${opts.limit + 1}`;

  const page = rows.slice(0, opts.limit);
  const items = page.map(mapListRow);

  const last = page.at(-1);
  return rows.length > opts.limit && last ? { items, nextCursor: encodeCursor(last.sort_value, last.address) } : { items };
}
