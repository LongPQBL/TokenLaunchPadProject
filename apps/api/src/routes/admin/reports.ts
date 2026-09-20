import { Hono } from "hono";
import type { AppEnv } from "../../app.js";
import { getSql } from "../../db.js";
import { apiError } from "../../errors.js";

const REPORT_ID = /^\d{1,18}$/;
const MAX_REPORTS = 100;

/**
 * The moderators' queue. Reports are stored and returned exactly as written (a reason is hostile text: the page draws it as
 * text), and settling one deletes nothing. A token that has been hidden since it was reported stays in the list, marked, so the
 * report can still be closed. Mounted behind `requireAdmin`.
 */
export function reportsAdminRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/reports", async (c) => {
    const rows = await getSql()`
      select r.id::text as id, r.token, r.reporter, r.reason, floor(extract(epoch from r.created_at))::text as created_at,
             t.name, t.ticker, coalesce(m.status, 'pending') = 'hidden' as hidden
      from app.report r
      left join launchpad.token t on t.chain_id = r.chain_id and t.address = r.token
      left join app.token_metadata m on m.chain_id = r.chain_id and m.token = r.token
      where r.chain_id = ${c.get("chain").chainId} and not r.resolved
      order by r.id desc
      limit ${MAX_REPORTS}`;
    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        token: r.token,
        name: r.name ?? undefined,
        ticker: r.ticker ?? undefined,
        reporter: r.reporter,
        reason: r.reason,
        createdAt: r.created_at,
        hidden: r.hidden,
      })),
    });
  });

  routes.post("/reports/:id/resolve", async (c) => {
    const id = c.req.param("id");
    if (!REPORT_ID.test(id)) return apiError(c, 400, "bad_id", "Not a valid report id.");
    const rows = await getSql()`update app.report set resolved = true where id = ${id}::bigint and chain_id = ${c.get("chain").chainId} returning id::text as id`;
    if (rows.length === 0) return apiError(c, 404, "not_found", "Report not found.");
    return c.json({ id, resolved: true });
  });

  return routes;
}
