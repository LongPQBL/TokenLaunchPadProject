import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.js";
import { sessionAddress } from "../auth/session.js";
import { notFoundHandler } from "../errors.js";

/**
 * In front of every moderation route. It lets through a live session whose address is on the list, and hands the route who
 * that is (`address`). Everyone else gets the answer a path that does not exist gets, byte for byte, so nothing about the
 * refusal says these routes are here: no session, a session for someone else, an expired one and an empty list all look
 * alike. An empty list refuses everyone. The list is fixed when the app is built, and matched in lower case.
 */
export function createRequireAdmin(admins: readonly string[]): MiddlewareHandler<AppEnv> {
  const allowed = new Set(admins.map((a) => a.toLowerCase()).filter(Boolean));
  return async (c, next) => {
    const address = await sessionAddress(c);
    if (!address || !allowed.has(address.toLowerCase())) return notFoundHandler(c);
    c.set("address", address);
    await next();
  };
}
