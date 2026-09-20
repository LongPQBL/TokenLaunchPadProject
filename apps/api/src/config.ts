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
}

function parseGateway(raw: string | undefined): string {
  const value = raw ?? "https://ipfs.io";
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

/** Everything the API reads from the environment, validated once at start-up rather than at first use. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const port = env.PORT === undefined ? 3001 : Number(env.PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`PORT must be a valid port number (got "${env.PORT}")`);

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

  return {
    databaseUrl,
    port,
    corsOrigins,
    ipfsGatewayUrl: parseGateway(env.IPFS_GATEWAY_URL),
    webOrigin: web.origin,
    rpcUrl: env.RPC_URL || undefined,
    trustProxy: env.TRUST_PROXY === "true",
  };
}
