import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../app.js";
import { requireSession } from "../auth/session.js";
import { getSql } from "../db.js";
import { apiError } from "../errors.js";
import { jsonSafe } from "../json.js";
import { ipfsToHttp } from "../metadata/ipfs.js";
import { consumeRateLimit } from "../middleware/rate-limit.js";
import { BadCommentCursorError, listComments, type CommentView } from "../queries/comments.js";

/** Counted as a person counts: an emoji is one. The database's CHECK counts the same way. */
export const MAX_COMMENT_CHARS = 500;
const COMMENTS_PER_MINUTE = 10;
/** A comment is at most 500 characters of at most four bytes each, plus JSON around it: nothing legitimate is bigger. */
const MAX_REQUEST_BYTES = 8 * 1024;

/** Junk means the default and the rest is clamped, as for every list in this API. */
function parseLimit(raw: string | undefined): number {
  const n = Number(raw);
  return raw === undefined || raw === "" || !Number.isFinite(n) ? 30 : Math.min(Math.max(Math.trunc(n), 1), 100);
}

export interface CommentsRoutesDeps {
  ipfsGateway: string;
}

/**
 * Mounted under /:chain/tokens/:address, AFTER the middleware that resolves the token: an unknown token and a hidden one
 * are the same 404, so a hidden token's thread cannot be reached by its address either.
 */
export function commentsRoutes(deps: CommentsRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    try {
      return c.json(
        jsonSafe(
          await listComments(c.get("chain").chainId, c.get("token").address, {
            limit: parseLimit(c.req.query("limit")),
            cursor: c.req.query("cursor") || undefined,
            gateway: deps.ipfsGateway,
          }),
        ) as object,
      );
    } catch (e) {
      if (e instanceof BadCommentCursorError) return apiError(c, 400, "bad_cursor", "Malformed cursor.");
      throw e;
    }
  });

  /**
   * Writes a comment. WHO wrote it is the session and nothing else: the body is read for its `body` and no other field, so a
   * client cannot speak as someone else, on another chain, or as hidden. Checked in this order: a session, a sane request, a
   * body that is a comment, a person who is not banned, a rate that is not too fast. Only then is anything written, so a
   * refused comment costs nothing, and a refusal for a typo does not use up the person's ten a minute.
   */
  routes.post(
    "/",
    requireSession,
    bodyLimit({ maxSize: MAX_REQUEST_BYTES, onError: (c) => apiError(c, 413, "too_large", "That comment is too large.") }),
    async (c) => {
      if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        return apiError(c, 400, "bad_request", "Send the comment as JSON.");
      }
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return apiError(c, 400, "bad_request", "Send the comment as JSON.");
      }
      const text = typeof (raw as { body?: unknown } | null)?.body === "string" ? ((raw as { body: string }).body).trim() : "";
      // NUL cannot be stored in Postgres text, and would otherwise surface as a 500.
      if (text === "" || [...text].length > MAX_COMMENT_CHARS || text.includes(String.fromCharCode(0))) {
        return apiError(c, 400, "bad_comment", `Write between 1 and ${MAX_COMMENT_CHARS} characters.`);
      }

      const sql = getSql();
      const author = c.get("address");
      await sql`insert into app.app_user (address) values (${author}) on conflict do nothing`;
      const [user] = await sql`select username, avatar_uri, banned_at from app.app_user where address = ${author}`;
      if (user!.banned_at) return apiError(c, 403, "banned", "You cannot post here.");

      const limit = await consumeRateLimit("comment", author, COMMENTS_PER_MINUTE, 60);
      if (!limit.allowed) {
        c.header("Retry-After", String(limit.retryAfterSeconds));
        return apiError(c, 429, "rate_limited", "You are commenting too fast. Please wait a moment.");
      }

      const [row] = await sql`
        insert into app.comment (chain_id, token, author, body)
        values (${c.get("chain").chainId}, ${c.get("token").address}, ${author}, ${text})
        returning id::text as id, floor(extract(epoch from created_at))::text as created_at`;
      const comment: CommentView = {
        id: row!.id,
        author,
        username: user!.username ?? undefined,
        avatarUrl: (user!.avatar_uri && ipfsToHttp(user!.avatar_uri, deps.ipfsGateway)) || undefined,
        body: text,
        createdAt: BigInt(row!.created_at),
      };
      return c.json(jsonSafe(comment) as object, 201);
    },
  );

  return routes;
}
