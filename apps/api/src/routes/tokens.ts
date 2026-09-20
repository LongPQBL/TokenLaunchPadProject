import { Hono, type Context } from "hono";
import type { AppEnv } from "../app.js";
import { apiError } from "../errors.js";
import { jsonSafe } from "../json.js";
import { getCandles } from "../queries/candles.js";
import { commentsRoutes } from "./comments.js";
import { listHolders } from "../queries/holders.js";
import { getToken } from "../queries/tokenDetail.js";
import { BadCursorError, listTokens, SORTS, type Sort } from "../queries/tokenList.js";
import { BadTradeCursorError, listTrades } from "../queries/trades.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DEFAULT_INTERVAL = 60; // seconds
const MAX_INTERVAL = 604_800; // one week

/** A page size or an interval is a hint, not an input worth rejecting: junk means the default, the rest is clamped. */
function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

const json = (c: Context, value: unknown) => c.json(jsonSafe(value) as object);

export interface TokensRoutesDeps {
  /** Launchpad contract per chain id: it holds the unsold supply and so is never a holder. */
  launchpads: Record<number, string>;
  /** Where avatars are fetched from: the same one gateway as token images. */
  ipfsGateway?: string;
}

export function tokensRoutes(deps: TokensRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    const sort = c.req.query("sort") ?? "new";
    if (!Object.hasOwn(SORTS, sort)) return apiError(c, 400, "bad_sort", "Unknown sort.");

    try {
      return json(
        c,
        await listTokens({
          chainId: c.get("chain").chainId,
          sort: sort as Sort,
          cursor: c.req.query("cursor") || undefined,
          q: c.req.query("q") || undefined,
          limit: parseLimit(c.req.query("limit"), 50, 100),
        }),
      );
    } catch (e) {
      if (e instanceof BadCursorError) return apiError(c, 400, "bad_cursor", "Malformed cursor.");
      throw e;
    }
  });

  /**
   * Everything under /:address goes through here first. A malformed address is a 400; a well-formed one that
   * the indexer has not seen, or that is hidden, is the same 404 — so neither the trades nor the holders of a
   * hidden token can be reached by a direct link.
   */
  routes.use("/:address/*", async (c, next) => {
    const address = c.req.param("address");
    if (!address || !ADDRESS.test(address)) return apiError(c, 400, "bad_address", "Not a valid token address.");
    const token = await getToken(c.get("chain").chainId, address.toLowerCase());
    if (!token) return apiError(c, 404, "not_found", "Token not found.");
    c.set("token", token); // the detail route serves exactly this, so the row is read once
    await next();
  });

  routes.get("/:address", (c) => json(c, c.get("token")));
  routes.route("/:address/comments", commentsRoutes({ ipfsGateway: deps.ipfsGateway ?? "https://ipfs.io" }));

  routes.get("/:address/trades", async (c) => {
    try {
      return json(
        c,
        await listTrades(c.get("chain").chainId, c.req.param("address").toLowerCase(), {
          cursor: c.req.query("cursor") || undefined,
          limit: parseLimit(c.req.query("limit"), 50, 200),
        }),
      );
    } catch (e) {
      if (e instanceof BadTradeCursorError) return apiError(c, 400, "bad_cursor", "Malformed cursor.");
      throw e;
    }
  });

  routes.get("/:address/candles", async (c) => {
    const from = Number(c.req.query("from"));
    const items = await getCandles(
      c.get("chain").chainId,
      c.req.param("address").toLowerCase(),
      parseLimit(c.req.query("interval"), DEFAULT_INTERVAL, MAX_INTERVAL),
      Number.isFinite(from) ? from : 0,
    );
    return json(c, { items });
  });

  routes.get("/:address/holders", async (c) => {
    const chainId = c.get("chain").chainId;
    const items = await listHolders(chainId, c.req.param("address").toLowerCase(), {
      limit: parseLimit(c.req.query("limit"), 50, 100),
      launchpad: deps.launchpads[chainId],
    });
    return json(c, { items });
  });

  return routes;
}
