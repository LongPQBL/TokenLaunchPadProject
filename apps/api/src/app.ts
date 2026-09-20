import { chainBySlug, type ChainConfig } from "@vezta/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { VerifySignature } from "./auth/signature.js";
import { apiError, errorHandler, notFoundHandler } from "./errors.js";
import type { TokenDetail } from "./queries/tokenDetail.js";
import type { Pinner } from "./metadata/pin.js";
import { authRoutes } from "./routes/auth.js";
import { holdingsRoutes } from "./routes/holdings.js";
import { metadataRoutes } from "./routes/metadata.js";
import { tokensRoutes } from "./routes/tokens.js";

/** What sign-in needs to know about the site it serves. Absent, sign-in answers 503. */
export interface AuthDeps {
  /** The website's host (with port if it has one). A sign-in message written for any other domain is refused. */
  domain: string;
  uri: string;
  chainId: number;
  /** Defaults to plain-wallet verification; give one that asks the chain to accept smart-contract wallets too. */
  verify?: VerifySignature;
  /** True behind a reverse proxy, so rate limits count the real client and not the proxy. */
  trustProxy?: boolean;
}

export interface AppDeps {
  /** Origins allowed to call the API from a browser. Never "*": sessions are cookies (spec §5). */
  corsOrigins: string[];
  /** True when the database answers. Injected so the app can be built and tested without one. */
  ready: () => Promise<boolean>;
  /** Launchpad contract address per chain id, so the holders list can leave it out. */
  launchpads: Record<number, string>;
  auth: AuthDeps;
  /** Where logos and metadata are pinned. Absent, uploads answer 503. */
  pinner: Pinner;
  /** The one IPFS gateway avatars and images are fetched through. */
  ipfsGateway: string;
}

/** `token` is set only inside the /:chain/tokens/:address routes, by the middleware that resolves it. */
export type AppEnv = { Variables: { chain: ChainConfig; token: TokenDetail; address: string } };

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

  app.route("/", authRoutes(deps.auth));
  app.route("/", metadataRoutes({ pinner: deps.pinner }));

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
  chain.route("/tokens", tokensRoutes({ launchpads: deps.launchpads ?? {}, ipfsGateway: deps.ipfsGateway }));
  chain.route("/addresses", holdingsRoutes());
  app.route("/:chain", chain);

  return app;
}
