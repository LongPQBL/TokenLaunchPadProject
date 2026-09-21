import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.js";
import { apiError } from "../errors.js";

/**
 * A POST must say it is JSON. A form on another page cannot send that type (and a cross-origin script that tries triggers a
 * preflight the CORS allow-list refuses), so a request that lacks it did not come from our own pages. It is a second lock
 * beside SameSite=Lax on the session cookie, put in front of every state-changing admin route.
 */
export const requireJsonPosts: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === "POST" && !(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return apiError(c, 400, "bad_request", "Send the request as JSON.");
  }
  await next();
};
