import { DEFAULT_IPFS_GATEWAY } from "./metadata/ipfs.js";

export interface Config {
  databaseUrl: string;
  port: number;
  corsOrigins: string[];
  /** The one host the metadata resolver may contact. Never taken from anything on-chain. */
  ipfsGatewayUrl: string;
  /** The website's origin. Its host is the domain a sign-in message must name: that is what defeats phishing. */
  webOrigin: string;
  /** Lets smart-contract wallets sign in (their signatures are checked on chain). Optional. */
  rpcUrl?: string;
  /** True behind a reverse proxy: rate limits then count the client the proxy reports, not the proxy. */
  trustProxy: boolean;
  /** Where logos and metadata are pinned. Undefined: uploads answer 503. "fake" pins nothing (never in production). */
  pinner?: "pinata" | "fake";
  /** Pinata's key. Exists only in the API's environment; nothing secret is ever put in a NEXT_PUBLIC_ variable. */
  pinataJwt?: string;
  /** Where the watcher publishes live events. Absent: no websockets, and pages poll instead. */
  redisUrl?: string;
  /** Who may use the moderation tools, lower-case. Empty: nobody, and the admin routes look like they do not exist. */
  adminAddresses: string[];
  /** The indexer's own HTTP address (Ponder's /status tells how far it has got). Optional: without it the lag reads as unknown. */
  indexerUrl?: string;
}

function parseGateway(raw: string | undefined): string {
  const value = raw ?? DEFAULT_IPFS_GATEWAY;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`IPFS_GATEWAY_URL must be an http(s) URL (got "${value}")`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`IPFS_GATEWAY_URL must be an http(s) URL (got "${value}")`);
  }
  return value.replace(/\/+$/, "");
}

function parseHttpUrl(name: string, raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an http(s) URL (got "${raw}")`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${name} must be an http(s) URL (got "${raw}")`);
  return url;
}

function parseAdminAddresses(raw: string | undefined): string[] {
  const entries = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const entry of entries) {
    // Refused at start-up: a typo here would lock the operator out of their own tools with nothing to say why.
    if (!/^0x[0-9a-fA-F]{40}$/.test(entry)) throw new Error(`ADMIN_ADDRESSES must be a comma-separated list of addresses (got "${entry}")`);
  }
  return entries.map((entry) => entry.toLowerCase());
}

/** Everything the API reads from the environment, validated once at start-up rather than at first use. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  // Not PORT: that name is a de facto standard many tools (Ponder among them) read as an override regardless of their own
  // flags, and now that every backend package shares one env file, a plain PORT here would leak into all of them.
  const port = env.API_PORT === undefined ? 3001 : Number(env.API_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`API_PORT must be a valid port number (got "${env.API_PORT}")`);

  const corsOrigins = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Sessions live in a cookie, and a browser will not send cookies to a wildcard origin anyway; an
  // allow-list that quietly accepted "*" would hide a misconfiguration behind broken logins (spec §5).
  if (corsOrigins.includes("*")) {
    throw new Error("CORS_ORIGINS must list origins explicitly: a wildcard is refused because the API uses cookies");
  }

  const web = parseHttpUrl("WEB_ORIGIN", env.WEB_ORIGIN ?? "http://localhost:3000");
  if (web.pathname !== "/" || web.search || web.hash) throw new Error(`WEB_ORIGIN must be an origin, with no path (got "${env.WEB_ORIGIN}")`);

  if (env.TRUST_PROXY !== undefined && env.TRUST_PROXY !== "true" && env.TRUST_PROXY !== "false") {
    throw new Error(`TRUST_PROXY must be "true" or "false" (got "${env.TRUST_PROXY}")`);
  }

  if (env.RPC_URL) parseHttpUrl("RPC_URL", env.RPC_URL); // validated here, used as given
  if (env.INDEXER_URL) parseHttpUrl("INDEXER_URL", env.INDEXER_URL);

  if (env.PINNER !== undefined && env.PINNER !== "pinata" && env.PINNER !== "fake") {
    throw new Error(`PINNER must be "pinata" or "fake" (got "${env.PINNER}")`);
  }
  if (env.PINNER === "fake" && env.NODE_ENV === "production") {
    throw new Error('PINNER="fake" pins nothing and is refused in production');
  }
  const pinner = env.PINNER ?? (env.PINATA_JWT ? "pinata" : undefined);
  if (pinner === "pinata" && !env.PINATA_JWT) throw new Error('PINNER="pinata" needs PINATA_JWT');

  if (env.REDIS_URL !== undefined && env.REDIS_URL !== "" && !/^rediss?:\/\//.test(env.REDIS_URL)) {
    // The url can carry a password: the message says what is wrong, not what was given.
    throw new Error("REDIS_URL must start with redis:// or rediss://");
  }

  return {
    databaseUrl,
    port,
    corsOrigins,
    ipfsGatewayUrl: parseGateway(env.IPFS_GATEWAY_URL),
    webOrigin: web.origin,
    rpcUrl: env.RPC_URL || undefined,
    trustProxy: env.TRUST_PROXY === "true",
    pinner,
    pinataJwt: env.PINATA_JWT || undefined,
    redisUrl: env.REDIS_URL || undefined,
    adminAddresses: parseAdminAddresses(env.ADMIN_ADDRESSES),
    indexerUrl: env.INDEXER_URL ? env.INDEXER_URL.replace(/\/+$/, "") : undefined,
  };
}
