import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { apiError } from "../errors.js";
import { jsonSafe } from "../json.js";
import { BadCursorError, listTokens, SORTS, type Sort } from "../queries/tokenList.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** A page size is a hint, not an input worth rejecting: junk means the default, the rest is clamped. */
function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT);
}

export function tokensRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    const sort = c.req.query("sort") ?? "new";
    if (!Object.hasOwn(SORTS, sort)) return apiError(c, 400, "bad_sort", "Unknown sort.");

    try {
      const result = await listTokens({
        chainId: c.get("chain").chainId,
        sort: sort as Sort,
        cursor: c.req.query("cursor") || undefined,
        limit: parseLimit(c.req.query("limit")),
      });
      return c.json(jsonSafe(result) as object);
    } catch (e) {
      if (e instanceof BadCursorError) return apiError(c, 400, "bad_cursor", "Malformed cursor.");
      throw e;
    }
  });

  return routes;
}
