import type { Context, MiddlewareHandler } from "hono";
import { getSql } from "../db.js";
import { apiError } from "../errors.js";

export interface RateLimitResult {
  allowed: boolean;
  /** When refused: how long until the oldest counted hit leaves the window. */
  retryAfterSeconds: number;
}

/**
 * Counts one hit for `key` against the limit named by `bucket`: at most `limit` hits in any `windowSeconds`. Hits
 * live in Postgres, so the limit holds across API instances with nothing else to run. A per-key advisory lock makes
 * the count-then-insert atomic: twenty requests arriving together cannot all read "4 of 5" and all get through. A
 * refused request is not recorded, so a client that keeps hammering does not extend its own lockout.
 */
export async function consumeRateLimit(bucket: string, key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  return getSql().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`${bucket}:${key}`}))`;
    const [row] = await tx`
      select count(*)::int as n,
             greatest(1, ceil(extract(epoch from (min(at) + make_interval(secs => ${windowSeconds}) - now()))))::int as retry
      from app.rate_hit
      where bucket = ${bucket} and key = ${key} and at > now() - make_interval(secs => ${windowSeconds})`;
    if (row!.n >= limit) return { allowed: false, retryAfterSeconds: row!.retry };

    await tx`insert into app.rate_hit (bucket, key) values (${bucket}, ${key})`;
    // Housekeeping on the way past: this key's hits from before the window can never matter again.
    await tx`delete from app.rate_hit where bucket = ${bucket} and key = ${key} and at <= now() - make_interval(secs => ${windowSeconds})`;
    return { allowed: true, retryAfterSeconds: 0 };
  });
}

export interface RateLimitOptions {
  bucket: string;
  limit: number;
  windowSeconds: number;
  /** Who is being counted. Undefined means "not identifiable here": the request passes and the route decides what to do. */
  key: (c: Context) => string | undefined;
}

export function rateLimit({ bucket, limit, windowSeconds, key }: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const who = key(c);
    if (who === undefined) return next();
    const result = await consumeRateLimit(bucket, who, limit, windowSeconds);
    if (!result.allowed) {
      c.header("Retry-After", String(result.retryAfterSeconds));
      return apiError(c, 429, "rate_limited", "Too many requests. Please try again later.");
    }
    return next();
  };
}
