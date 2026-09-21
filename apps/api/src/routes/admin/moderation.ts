import { Hono } from "hono";
import type { AppEnv } from "../../app.js";
import { getSql } from "../../db.js";
import { apiError } from "../../errors.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** Comment ids are bigserial: at most 19 digits, and 18 is safe to hand to Postgres as a bigint. */
const COMMENT_ID = /^\d{1,18}$/;

/**
 * The moderation actions. Every one is idempotent (doing it twice is the same as doing it once, and never an error), none
 * deletes anything (a hidden thing stays in the tables, only unserved, because nothing can be removed from the chain and an
 * operator may need the history). Mounted behind `requireAdmin` and `requireJsonPosts`.
 */
export function moderationRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  /**
   * Hides a token by making its metadata row say so, creating the row if the resolver has not yet (a token can be spam before
   * its metadata ever resolves). Whoever hid it first stays on the record, so hiding again does not rewrite the trail.
   */
  routes.post("/tokens/:address/hide", async (c) => {
    const address = c.req.param("address");
    if (!ADDRESS.test(address)) return apiError(c, 400, "bad_address", "Not a valid token address.");
    const rows = await getSql()`
      insert into app.token_metadata as m (chain_id, token, uri, status, hidden_by, hidden_at)
      select t.chain_id, t.address, coalesce(t.metadata_uri, ''), 'hidden', ${c.get("address")}, now()
      from launchpad.token t
      where t.chain_id = ${c.get("chain").chainId} and t.address = ${address.toLowerCase()}
      on conflict (chain_id, token) do update set
        status = 'hidden',
        hidden_by = case when m.status = 'hidden' then m.hidden_by else excluded.hidden_by end,
        hidden_at = case when m.status = 'hidden' then m.hidden_at else excluded.hidden_at end
      returning hidden_by, floor(extract(epoch from hidden_at))::text as hidden_at`;
    const row = rows[0];
    if (!row) return apiError(c, 404, "not_found", "Token not found.");
    return c.json({ token: address.toLowerCase(), hidden: true, hiddenBy: row.hidden_by, hiddenAt: row.hidden_at });
  });

  /** Puts a hidden token back to be resolved afresh: what it had resolved to is not trusted after being hidden for a while. */
  routes.post("/tokens/:address/unhide", async (c) => {
    const address = c.req.param("address");
    if (!ADDRESS.test(address)) return apiError(c, 400, "bad_address", "Not a valid token address.");
    const sql = getSql();
    const chainId = c.get("chain").chainId;
    const token = address.toLowerCase();
    const [known] = await sql`select 1 as ok from launchpad.token where chain_id = ${chainId} and address = ${token}`;
    if (!known) return apiError(c, 404, "not_found", "Token not found.");
    await sql`
      update app.token_metadata
      set status = 'pending', attempts = 0, next_attempt = null, hidden_by = null, hidden_at = null
      where chain_id = ${chainId} and token = ${token} and status = 'hidden'`;
    return c.json({ token, hidden: false });
  });

  routes.post("/comments/:id/hide", async (c) => {
    const id = c.req.param("id");
    if (!COMMENT_ID.test(id)) return apiError(c, 400, "bad_id", "Not a valid comment id.");
    // Scoped to this chain: an id from another chain is simply not found here.
    const rows = await getSql()`update app.comment set hidden = true where id = ${id}::bigint and chain_id = ${c.get("chain").chainId} returning id::text as id`;
    if (rows.length === 0) return apiError(c, 404, "not_found", "Comment not found.");
    return c.json({ id, hidden: true });
  });

  /**
   * Bans an address, whether or not it has ever posted. Their comments stop being served and they cannot post; the rows stay.
   * The time of the first ban is kept.
   */
  routes.post("/users/:address/ban", async (c) => {
    const address = c.req.param("address");
    if (!ADDRESS.test(address)) return apiError(c, 400, "bad_address", "Not a valid address.");
    const [row] = await getSql()`
      insert into app.app_user (address, banned_at) values (${address.toLowerCase()}, now())
      on conflict (address) do update set banned_at = coalesce(app.app_user.banned_at, now())
      returning floor(extract(epoch from banned_at))::text as banned_at`;
    return c.json({ address: address.toLowerCase(), bannedAt: row!.banned_at });
  });

  return routes;
}
