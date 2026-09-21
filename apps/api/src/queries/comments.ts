import { getSql } from "../db.js";
import { ipfsToHttp } from "../metadata/ipfs.js";

export class BadCommentCursorError extends Error {
  constructor() {
    super("Malformed cursor");
  }
}

export interface CommentView {
  id: string;
  /** Lower-case address of whoever wrote it, taken from their session, never from anything they sent. */
  author: string;
  username?: string;
  avatarUrl?: string;
  body: string;
  /** Unix seconds. */
  createdAt: bigint;
}

const MAX_LIMIT = 100;

/** A cursor is the id of the last comment seen: comments are numbered as they are written, so "older than this" is a position. */
function decodeCursor(cursor: string): string {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(v) && v.length === 1 && typeof v[0] === "string" && /^\d{1,18}$/.test(v[0])) return v[0];
  } catch {
    /* fall through */
  }
  throw new BadCommentCursorError();
}

const encodeCursor = (id: string) => Buffer.from(JSON.stringify([id])).toString("base64url");

/**
 * A token's comments, newest first. Four kinds are never served, and none is deleted: one the operator hid, one written by
 * someone who has since been banned, and any of them on a token that has since been hidden. History the operator may need
 * stays in the table; it just stops being shown. Text comes back exactly as written: it is hostile input, and escaping it
 * is the renderer's job.
 */
export async function listComments(
  chainId: number,
  token: string,
  opts: { limit: number; cursor?: string; gateway: string },
): Promise<{ items: CommentView[]; nextCursor?: string }> {
  const sql = getSql();
  const limit = Math.min(Math.max(Math.trunc(opts.limit) || 1, 1), MAX_LIMIT);
  const before = opts.cursor ? sql`and c.id < ${decodeCursor(opts.cursor)}::bigint` : sql``;

  const rows = await sql`
    select c.id::text as id, c.author, c.body, floor(extract(epoch from c.created_at))::text as created_at,
           u.username, u.avatar_uri
    from app.comment c
    join app.app_user u on u.address = c.author
    where c.chain_id = ${chainId} and c.token = ${token}
      and not c.hidden
      and u.banned_at is null
      and not exists (
        select 1 from app.token_metadata m where m.chain_id = c.chain_id and m.token = c.token and m.status = 'hidden'
      )
      ${before}
    order by c.id desc
    limit ${limit + 1}`;

  const page = rows.slice(0, limit);
  const items: CommentView[] = page.map((r) => ({
    id: r.id,
    author: r.author,
    username: r.username ?? undefined,
    avatarUrl: (r.avatar_uri && ipfsToHttp(r.avatar_uri, opts.gateway)) || undefined,
    body: r.body,
    createdAt: BigInt(r.created_at),
  }));
  const last = page.at(-1);
  return rows.length > limit && last ? { items, nextCursor: encodeCursor(last.id) } : { items };
}
