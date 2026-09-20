import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { getSql } from "../db.js";
import { apiError } from "../errors.js";
import { jsonSafe } from "../json.js";
import { ipfsToHttp } from "../metadata/ipfs.js";
import { getProfile } from "../queries/profile.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** What an address has made and holds, and who it is if they have said. Mounted under /:chain/addresses. */
export function profileRoutes(deps: { ipfsGateway: string }): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/:address/profile", async (c) => {
    const raw = c.req.param("address");
    if (!ADDRESS.test(raw)) return apiError(c, 400, "bad_address", "Not a valid address.");
    const address = raw.toLowerCase();
    const [profile, [user]] = await Promise.all([
      getProfile(c.get("chain").chainId, address),
      getSql()`select username, avatar_uri from app.app_user where address = ${address} and banned_at is null`,
    ]);
    const avatarUrl = user?.avatar_uri ? ipfsToHttp(user.avatar_uri, deps.ipfsGateway) : undefined;
    const named = user && (user.username || avatarUrl) ? { username: user.username ?? undefined, avatarUrl } : undefined;
    return c.json(jsonSafe({ ...profile, ...(named ? { user: named } : {}) }) as object);
  });

  return routes;
}
