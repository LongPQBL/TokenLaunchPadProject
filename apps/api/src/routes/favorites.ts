import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { requireSession } from "../auth/session.js";
import { getSql } from "../db.js";
import { apiError } from "../errors.js";
import { consumeRateLimit } from "../middleware/rate-limit.js";
import { jsonSafe } from "../json.js";
import { listTokens } from "../queries/tokenList.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** Most stars one person may hold: a list nobody could read is not a list, and it bounds what one account can store. */
export const MAX_FAVORITES = 500;
const CHANGES_PER_MINUTE = 60;

/**
 * The tokens a person has starred, on the account, so they follow the person to any device. WHO is the session and nothing else:
 * no route names a person. A star on a token that is hidden is not shown (and cannot be made), as for every other list: hiding
 * takes nothing from the person, and unhiding gives it back. Mounted under /:chain/me/favorites.
 */
export function favoritesRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use("*", requireSession);

  routes.get("/", async (c) => {
    const rows = await getSql()`
      select f.token
      from app.favorite f
      join launchpad.token t on t.chain_id = f.chain_id and t.address = f.token
      left join app.token_metadata m on m.chain_id = f.chain_id and m.token = f.token
      where f.chain_id = ${c.get("chain").chainId} and f.address = ${c.get("address")} and coalesce(m.status, 'pending') <> 'hidden'
      order by f.created_at desc, f.token desc
      limit ${MAX_FAVORITES}`;
    return c.json({ tokens: rows.map((r) => r.token as string) });
  });

  routes.put("/:token", async (c) => {
    const raw = c.req.param("token");
    if (!ADDRESS.test(raw)) return apiError(c, 400, "bad_address", "Not a valid token address.");
    const token = raw.toLowerCase();
    const chainId = c.get("chain").chainId;
    const me = c.get("address");
    const limit = await consumeRateLimit("favorite", me, CHANGES_PER_MINUTE, 60);
    if (!limit.allowed) {
      c.header("Retry-After", String(limit.retryAfterSeconds));
      return apiError(c, 429, "rate_limited", "You are changing your stars too fast. Please wait a moment.");
    }

    const sql = getSql();
    // Only a token the app would show: the same "not found" as a hidden one's own page.
    const [known] = await sql`
      select 1 as ok from launchpad.token t
      left join app.token_metadata m on m.chain_id = t.chain_id and m.token = t.address
      where t.chain_id = ${chainId} and t.address = ${token} and coalesce(m.status, 'pending') <> 'hidden'`;
    if (!known) return apiError(c, 404, "not_found", "Token not found.");

    const full = await sql.begin(async (tx) => {
      // One person's changes take turns, so two at once cannot both slip under the cap.
      await tx`select pg_advisory_xact_lock(hashtext(${`favorite:${me}`}))`;
      await tx`insert into app.app_user (address) values (${me}) on conflict do nothing`;
      const [have] = await tx`select 1 as ok from app.favorite where chain_id = ${chainId} and address = ${me} and token = ${token}`;
      if (have) return false; // already starred: nothing to add, and the first time is kept
      const [count] = await tx`select count(*)::int as n from app.favorite where address = ${me}`;
      if (count!.n >= MAX_FAVORITES) return true;
      await tx`insert into app.favorite (chain_id, address, token) values (${chainId}, ${me}, ${token})`;
      return false;
    });
    if (full) return apiError(c, 409, "too_many", `You can star at most ${MAX_FAVORITES} tokens. Remove one first.`);
    return c.json({ token, starred: true });
  });

  routes.delete("/:token", async (c) => {
    const raw = c.req.param("token");
    if (!ADDRESS.test(raw)) return apiError(c, 400, "bad_address", "Not a valid token address.");
    const token = raw.toLowerCase();
    const me = c.get("address");
    const limit = await consumeRateLimit("favorite", me, CHANGES_PER_MINUTE, 60);
    if (!limit.allowed) {
      c.header("Retry-After", String(limit.retryAfterSeconds));
      return apiError(c, 429, "rate_limited", "You are changing your stars too fast. Please wait a moment.");
    }
    // Idempotent, and not found-checked: removing what is not there, or on a token that has since gone, is just done.
    await getSql()`delete from app.favorite where chain_id = ${c.get("chain").chainId} and address = ${me} and token = ${token}`;
    return c.json({ token, starred: false });
  });

  return routes;
}

/**
 * The person's starred tokens as rows of a token table, with the numbers the table shows: what /me/favorites lists as addresses,
 * as one answer. Every star in one go (a person holds at most MAX_FAVORITES) and so no page to ask for next; the page sorts
 * them. A hidden token is left out, as everywhere. Mounted under /:chain/me/watchlist.
 */
export function watchlistRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use("*", requireSession);
  routes.get("/", async (c) => {
    const { items } = await listTokens({ chainId: c.get("chain").chainId, sort: "new", limit: MAX_FAVORITES, starredBy: c.get("address") });
    return c.json(jsonSafe({ items }) as object);
  });
  return routes;
}
