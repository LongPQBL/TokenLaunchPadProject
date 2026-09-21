import postgres from "postgres";

let client: ReturnType<typeof postgres> | undefined;

/**
 * The raw SQL client, for the queries that join the indexer's `launchpad` views to the app's `app` schema
 * (Prisma cannot express those). Created on first use so importing this module never opens a connection.
 *
 * numeric and bigint columns come back as strings, which is what we want: they hold uint256 values that
 * do not fit a JavaScript number.
 */
export function getSql() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    client = postgres(url, { onnotice: () => {}, max: 10 });
  }
  return client;
}

export async function isDatabaseReady(): Promise<boolean> {
  try {
    await getSql()`select 1`;
    return true;
  } catch {
    return false;
  }
}
