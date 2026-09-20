import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../app.js";
import { requireSession } from "../auth/session.js";
import { getSql } from "../db.js";
import { apiError } from "../errors.js";
import { consumeRateLimit } from "../middleware/rate-limit.js";

export const MAX_REPORT_CHARS = 280;
const REPORTS_PER_HOUR = 5;
/** A reason is at most 280 characters of at most four bytes each, plus JSON around it. */
const MAX_REQUEST_BYTES = 4 * 1024;

/**
 * Mounted under /:chain/tokens/:address, AFTER the middleware that resolves the token: a token that is hidden or unknown is the
 * same 404 here as anywhere. Anyone with a session may report; what they wrote is stored as written and shown to moderators
 * as text. WHO reported is the session and nothing else.
 *
 * Checked in this order: a session, a sane request, a reason that is a reason, a complaint not already open, a rate that is not
 * too fast. Only then is anything written, so a refused report costs nothing.
 */
export function reportsRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post(
    "/",
    requireSession,
    bodyLimit({ maxSize: MAX_REQUEST_BYTES, onError: (c) => apiError(c, 413, "too_large", "That report is too large.") }),
    async (c) => {
      if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        return apiError(c, 400, "bad_request", "Send the report as JSON.");
      }
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return apiError(c, 400, "bad_request", "Send the report as JSON.");
      }
      const reason = typeof (raw as { reason?: unknown } | null)?.reason === "string" ? ((raw as { reason: string }).reason).trim() : "";
      if (reason === "" || [...reason].length > MAX_REPORT_CHARS || reason.includes(String.fromCharCode(0))) {
        return apiError(c, 400, "bad_reason", `Write between 1 and ${MAX_REPORT_CHARS} characters.`);
      }

      const sql = getSql();
      const reporter = c.get("address");
      const chainId = c.get("chain").chainId;
      const token = c.get("token").address;
      await sql`insert into app.app_user (address) values (${reporter}) on conflict do nothing`;

      // Before the rate limit, so telling a moderator twice does not use up someone's five.
      const [open] = await sql`select 1 as ok from app.report where chain_id = ${chainId} and token = ${token} and reporter = ${reporter} and not resolved`;
      if (open) return c.json({ alreadyReported: true }, 200);

      const limit = await consumeRateLimit("report", reporter, REPORTS_PER_HOUR, 3600);
      if (!limit.allowed) {
        c.header("Retry-After", String(limit.retryAfterSeconds));
        return apiError(c, 429, "rate_limited", "You are reporting too fast. Please try again later.");
      }

      // The partial unique index decides a race between two identical requests: one row, and the other is "already reported".
      const rows = await sql`
        insert into app.report (chain_id, token, reporter, reason) values (${chainId}, ${token}, ${reporter}, ${reason})
        on conflict do nothing returning id::text as id`;
      return rows.length === 1 ? c.json({ id: rows[0]!.id }, 201) : c.json({ alreadyReported: true }, 200);
    },
  );

  return routes;
}
