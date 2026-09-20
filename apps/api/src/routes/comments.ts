import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { apiError } from "../errors.js";
import { jsonSafe } from "../json.js";
import { BadCommentCursorError, listComments } from "../queries/comments.js";

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

  return routes;
}
