import { chainBySlug, type ChainConfig } from "@vezta/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { apiError, errorHandler, notFoundHandler } from "./errors.js";
import { tokensRoutes } from "./routes/tokens.js";

export interface AppDeps {
  /** Origins allowed to call the API from a browser. Never "*": sessions are cookies (spec §5). */
  corsOrigins: string[];
  /** True when the database answers. Injected so the app can be built and tested without one. */
  ready: () => Promise<boolean>;
}

export type AppEnv = { Variables: { chain: ChainConfig } };

export function createApp(deps: Partial<AppDeps> = {}): Hono<AppEnv> {
  const allowed = new Set(deps.corsOrigins ?? []);
  const ready = deps.ready ?? (async () => true);

  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  app.use(
    "*",
    cors({
      // A function, so an unlisted origin gets no Access-Control-Allow-Origin at all rather than "*".
      origin: (origin) => (allowed.has(origin) ? origin : null),
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/ready", async (c) => {
    let ok = false;
    try {
      ok = await ready();
    } catch {
      ok = false;
    }
    return c.json({ ready: ok }, ok ? 200 : 503);
  });

  // Everything below is scoped to a chain, so the slug is resolved once here and handed on. Routes
  // that are not chain-scoped (health, auth, metadata) are registered above this mount.
  const chain = new Hono<AppEnv>();
  chain.use("*", async (c, next) => {
    const resolved = chainBySlug(c.req.param("chain") ?? "");
    if (!resolved) return apiError(c, 404, "unknown_chain", "Unknown chain.");
    c.set("chain", resolved);
    await next();
  });
  chain.route("/tokens", tokensRoutes());
  app.route("/:chain", chain);

  return app;
}
