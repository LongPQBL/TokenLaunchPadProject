import { Hono } from "hono";
import type { AppEnv } from "../../app.js";
import { getSql } from "../../db.js";
import { getHealth, type HealthDeps } from "../../queries/health.js";

/**
 * The operator's view of the running system, and the one repair that needs no wallet. Mounted behind `requireAdmin` and
 * `requireJsonPosts`.
 */
export function healthAdminRoutes(deps: HealthDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/health", async (c) => c.json(await getHealth(c.get("chain").chainId, deps)));

  /**
   * Gives every token whose metadata was given up on another try. The resolver's back-off has a ceiling; this is the way to try
   * again by hand once whatever was wrong (a gateway outage, say) is mended. Only `invalid` ones move: a resolved, waiting or
   * hidden token is not touched.
   */
  routes.post("/metadata/re-resolve", async (c) => {
    const rows = await getSql()`
      update app.token_metadata set status = 'pending', attempts = 0, next_attempt = null
      where chain_id = ${c.get("chain").chainId} and status = 'invalid'
      returning token`;
    return c.json({ count: rows.length });
  });

  return routes;
}
