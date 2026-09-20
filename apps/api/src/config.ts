export interface Config {
  databaseUrl: string;
  port: number;
  corsOrigins: string[];
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

  return { databaseUrl, port, corsOrigins };
}
