import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { apiError } from "../errors.js";
import { jsonSafe } from "../json.js";
import { listHoldings } from "../queries/holdings.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function holdingsRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/:address/holdings", async (c) => {
    const address = c.req.param("address");
    if (!ADDRESS.test(address)) return apiError(c, 400, "bad_address", "Not a valid address.");
    return c.json(jsonSafe({ items: await listHoldings(c.get("chain").chainId, address.toLowerCase()) }) as object);
  });

  return routes;
}
