import { chainSlugById } from "@vezta/shared";
import { Hono } from "hono";
import type { AppEnv } from "../../app.js";
import { getSql } from "../../db.js";
import { apiError } from "../../errors.js";
import type { ModerationEvent, ModerationPublisher } from "../../realtime/moderation.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** Comment ids are bigserial: at most 19 digits, and 18 is safe to hand to Postgres as a bigint. */
const COMMENT_ID = /^\d{1,18}$/;

type Action = "token_hide" | "token_unhide" | "comment_hide" | "comment_unhide" | "user_ban" | "user_unban";
type Tx = Parameters<Parameters<ReturnType<typeof getSql>["begin"]>[1]>[0];

/** One row in the record of what moderators did. Written in the same transaction as the change, so the two cannot disagree. */
const record = (tx: Tx, chainId: number, action: Action, target: string, actor: string) =>
  tx`insert into app.moderation_event (chain_id, action, target, actor) values (${chainId}, ${action}, ${target}, ${actor})`;

/**
 * The moderation actions. Every one is idempotent (doing it twice is the same as doing it once, and never an error), none
 * deletes anything (a hidden thing stays in the tables, only unserved, because nothing can be removed from the chain and an
 * operator may need the history). Each change that actually happens is written to `moderation_event`; a repeat that changes
 * nothing writes nothing. Mounted behind `requireAdmin` and `requireJsonPosts`.
 */
export function moderationRoutes(publish?: ModerationPublisher): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  /** Tells open pages, after the change is committed. A failure to tell is never a failure to moderate. */
  const tell = async (event: ModerationEvent) => {
    try {
      await publish?.(event);
    } catch {
      /* the change stands; pages catch up when they reload */
    }
  };

  /**
   * Hides a token by making its metadata row say so, creating the row if the resolver has not yet (a token can be spam before
   * its metadata ever resolves). Whoever hid it first stays on the record, so hiding again does not rewrite the trail.
   */
  routes.post("/tokens/:address/hide", async (c) => {
    const address = c.req.param("address");
    if (!ADDRESS.test(address)) return apiError(c, 400, "bad_address", "Not a valid token address.");
    const chainId = c.get("chain").chainId;
    const token = address.toLowerCase();
    const actor = c.get("address");
    const row = await getSql().begin(async (tx) => {
      const [before] = await tx`select status from app.token_metadata where chain_id = ${chainId} and token = ${token}`;
      const rows = await tx`
        insert into app.token_metadata as m (chain_id, token, uri, status, hidden_by, hidden_at)
        select t.chain_id, t.address, coalesce(t.metadata_uri, ''), 'hidden', ${actor}, now()
        from launchpad.token t
        where t.chain_id = ${chainId} and t.address = ${token}
        on conflict (chain_id, token) do update set
          status = 'hidden',
          hidden_by = case when m.status = 'hidden' then m.hidden_by else excluded.hidden_by end,
          hidden_at = case when m.status = 'hidden' then m.hidden_at else excluded.hidden_at end
        returning hidden_by, floor(extract(epoch from hidden_at))::text as hidden_at`;
      const changed = rows.length > 0 && before?.status !== "hidden";
      if (changed) await record(tx, chainId, "token_hide", token, actor);
      const first = rows[0];
      return first && { hidden_by: first.hidden_by as string, hidden_at: first.hidden_at as string, changed };
    });
    if (!row) return apiError(c, 404, "not_found", "Token not found.");
    if (row.changed) await tell({ type: "token_hidden", chain: c.get("chain").slug, token });
    return c.json({ token, hidden: true, hiddenBy: row.hidden_by, hiddenAt: row.hidden_at });
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
    await sql.begin(async (tx) => {
      const changed = await tx`
        update app.token_metadata
        set status = 'pending', attempts = 0, next_attempt = null, hidden_by = null, hidden_at = null
        where chain_id = ${chainId} and token = ${token} and status = 'hidden'
        returning 1`;
      // The token row forgets who hid it, so the record is the only place that remembers.
      if (changed.length > 0) await record(tx, chainId, "token_unhide", token, c.get("address"));
    });
    return c.json({ token, hidden: false });
  });

  routes.post("/comments/:id/hide", async (c) => {
    const id = c.req.param("id");
    if (!COMMENT_ID.test(id)) return apiError(c, 400, "bad_id", "Not a valid comment id.");
    const chainId = c.get("chain").chainId;
    // Scoped to this chain: an id from another chain is simply not found here.
    const found = await getSql().begin(async (tx) => {
      const [row] = await tx`select token, hidden from app.comment where id = ${id}::bigint and chain_id = ${chainId}`;
      if (!row) return undefined;
      if (!row.hidden) {
        await tx`update app.comment set hidden = true where id = ${id}::bigint`;
        await record(tx, chainId, "comment_hide", id, c.get("address"));
      }
      return { token: row.token as string, changed: !row.hidden };
    });
    if (!found) return apiError(c, 404, "not_found", "Comment not found.");
    if (found.changed) await tell({ type: "comments_hidden", chain: c.get("chain").slug, token: found.token, ids: [id] });
    return c.json({ id, hidden: true });
  });

  /**
   * Puts a hidden comment back. It is served again only if nothing ELSE hides it: a banned author's comments and a hidden
   * token's stay unserved by their own cause, so this can never bring back something a ban or a hidden token still covers.
   */
  routes.post("/comments/:id/unhide", async (c) => {
    const id = c.req.param("id");
    if (!COMMENT_ID.test(id)) return apiError(c, 400, "bad_id", "Not a valid comment id.");
    const chainId = c.get("chain").chainId;
    const found = await getSql().begin(async (tx) => {
      const [row] = await tx`select hidden from app.comment where id = ${id}::bigint and chain_id = ${chainId}`;
      if (!row) return false;
      if (row.hidden) {
        await tx`update app.comment set hidden = false where id = ${id}::bigint`;
        await record(tx, chainId, "comment_unhide", id, c.get("address"));
      }
      return true;
    });
    if (!found) return apiError(c, 404, "not_found", "Comment not found.");
    return c.json({ id, hidden: false });
  });

  /**
   * Bans an address, whether or not it has ever posted. Their comments stop being served and they cannot post; the rows stay.
   * The time of the first ban is kept.
   */
  routes.post("/users/:address/ban", async (c) => {
    const address = c.req.param("address");
    if (!ADDRESS.test(address)) return apiError(c, 400, "bad_address", "Not a valid address.");
    const who = address.toLowerCase();
    const chainId = c.get("chain").chainId;
    const { bannedAt, hidNow } = await getSql().begin(async (tx) => {
      const [before] = await tx`select banned_at from app.app_user where address = ${who}`;
      const first = !before?.banned_at;
      // What this ban takes off open pages, worked out before the ban is in place: on every chain, since a ban is not per chain.
      const visible = first
        ? await tx`select id::text as id, token, chain_id from app.comment where author = ${who} and not hidden order by id`
        : [];
      const [row] = await tx`
        insert into app.app_user (address, banned_at) values (${who}, now())
        on conflict (address) do update set banned_at = coalesce(app.app_user.banned_at, now())
        returning floor(extract(epoch from banned_at))::text as banned_at`;
      if (first) await record(tx, chainId, "user_ban", who, c.get("address"));
      return { bannedAt: row!.banned_at as string, hidNow: visible };
    });
    const byThread = new Map<string, ModerationEvent & { type: "comments_hidden" }>();
    for (const comment of hidNow) {
      const chain = chainSlugById(comment.chain_id as number);
      if (!chain) continue;
      const key = `${chain}:${comment.token}`;
      const event = byThread.get(key) ?? { type: "comments_hidden" as const, chain, token: comment.token as string, ids: [] };
      event.ids.push(comment.id as string);
      byThread.set(key, event);
    }
    for (const event of byThread.values()) await tell(event);
    return c.json({ address: who, bannedAt });
  });

  /** Lets them post again. What they wrote comes back with them, except what a moderator hid by hand. */
  routes.post("/users/:address/unban", async (c) => {
    const address = c.req.param("address");
    if (!ADDRESS.test(address)) return apiError(c, 400, "bad_address", "Not a valid address.");
    const who = address.toLowerCase();
    // Never creates a person: an address nobody has seen has nothing to lift.
    await getSql().begin(async (tx) => {
      const lifted = await tx`update app.app_user set banned_at = null where address = ${who} and banned_at is not null returning 1`;
      if (lifted.length > 0) await record(tx, c.get("chain").chainId, "user_unban", who, c.get("address"));
    });
    return c.json({ address: who, banned: false });
  });

  return routes;
}
