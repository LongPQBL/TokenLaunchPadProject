import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { apiError } from "../errors.js";
import { jsonSafe } from "../json.js";
import { listHoldings } from "../queries/holdings.js";
import { BadOrderCursorError, listOrders, listPositions } from "../queries/positions.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function holdingsRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/:address/holdings", async (c) => {
    const address = c.req.param("address");
    if (!ADDRESS.test(address)) return apiError(c, 400, "bad_address", "Not a valid address.");
    return c.json(jsonSafe({ items: await listHoldings(c.get("chain").chainId, address.toLowerCase()) }) as object);
  });

  /**
   * What an address holds now, worth and cost (open positions only). Public, like holdings: it is what the chain shows anyone.
   * Hidden tokens are included, so moderation never hides anyone's money from them.
   */
  routes.get("/:address/positions", async (c) => {
    const address = c.req.param("address");
    if (!ADDRESS.test(address)) return apiError(c, 400, "bad_address", "Not a valid address.");
    return c.json(jsonSafe({ items: await listPositions(c.get("chain").chainId, address.toLowerCase()) }) as object);
  });

  /** Every trade an address made, newest first, across all tokens. A page size is a hint: junk means the default, the rest is clamped. */
  routes.get("/:address/orders", async (c) => {
    const address = c.req.param("address");
    if (!ADDRESS.test(address)) return apiError(c, 400, "bad_address", "Not a valid address.");
    const n = Number(c.req.query("limit"));
    const limit = c.req.query("limit") === undefined || c.req.query("limit") === "" || !Number.isFinite(n) ? 50 : Math.min(Math.max(Math.trunc(n), 1), 100);
    try {
      return c.json(jsonSafe(await listOrders(c.get("chain").chainId, address.toLowerCase(), { limit, cursor: c.req.query("cursor") || undefined })) as object);
    } catch (e) {
      if (e instanceof BadOrderCursorError) return apiError(c, 400, "bad_cursor", "Malformed cursor.");
      throw e;
    }
  });

  return routes;
}
