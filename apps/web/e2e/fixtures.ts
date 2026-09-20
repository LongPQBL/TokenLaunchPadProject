import { test as base, expect } from "@playwright/test";
import postgres from "postgres";

const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set: scripts/e2e.sh sets it, or export it by hand`);
  return value;
};

/** A token that graduated: created, filled to completion and migrated to Uniswap by the lifecycle flow. */
export const FILLED = need("E2E_TOKEN").toLowerCase();
/** A token still on its curve, with three buys that landed in a single block. */
export const SAME_BLOCK = need("E2E_SAME_BLOCK_TOKEN").toLowerCase();
export const LAUNCHPAD = need("E2E_LAUNCHPAD").toLowerCase();
export const CHAIN_ID = 11155111;
/** The local fork the browser wallet sends transactions to. */
export const RPC_URL = need("E2E_RPC_URL");

/** The wallet the API treats as an admin. Random, made by the script that starts the stack: never a well-known key. */
export const ADMIN_KEY = need("E2E_ADMIN_KEY") as `0x${string}`;

export const sql = postgres(need("E2E_DATABASE_URL"), { onnotice: () => {} });

interface Metadata {
  status: string;
  name: string | null;
  symbol: string | null;
  description: string | null;
  socials: Record<string, string>;
}

/** Writes a token's metadata row directly, as the metadata resolver or a moderator would, and hands back how to undo it. */
export async function setMetadata(token: string, fields: Partial<Metadata> & { status: string }) {
  const [before] = await sql`select status, name, symbol, description, socials from app.token_metadata where chain_id = ${CHAIN_ID} and token = ${token}`;
  const next: Metadata = { name: null, symbol: null, description: null, socials: {}, ...fields };
  await sql`
    insert into app.token_metadata (chain_id, token, uri, status, name, symbol, description, socials)
    values (${CHAIN_ID}, ${token}, 'ipfs://e2e', ${next.status}, ${next.name}, ${next.symbol}, ${next.description}, ${sql.json(next.socials)})
    on conflict (chain_id, token) do update set
      status = excluded.status, name = excluded.name, symbol = excluded.symbol,
      description = excluded.description, socials = excluded.socials`;
  return async () => {
    if (before) {
      await sql`
        update app.token_metadata set status = ${before.status}, name = ${before.name}, symbol = ${before.symbol},
          description = ${before.description}, socials = ${sql.json(before.socials)}
        where chain_id = ${CHAIN_ID} and token = ${token}`;
    } else {
      await sql`delete from app.token_metadata where chain_id = ${CHAIN_ID} and token = ${token}`;
    }
  };
}

/**
 * Every test gets a page that fails it if the browser logged an error, threw, or received an HTTP error. A hydration
 * mismatch, a failed request or an uncaught exception all land here, so "the page rendered" cannot hide "the page is
 * broken". A test that is MEANT to get a 404 says so with `test.use({ expectedNotFound: ["/path"] })`.
 */
export const test = base.extend<{ expectedNotFound: string[]; expectedConsoleErrors: RegExp[] }>({
  expectedNotFound: [[], { option: true }],
  // A test that deliberately provokes the browser (a CSP test) says which errors it expects.
  expectedConsoleErrors: [[], { option: true }],
  page: async ({ page, expectedNotFound, expectedConsoleErrors }, use) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      // Chrome's "Failed to load resource" line names no URL, so the response listener below reports those, with one.
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource") && !expectedConsoleErrors.some((re) => re.test(message.text()))) {
        problems.push(`console.error: ${message.text()}`);
      }
    });
    page.on("response", (response) => {
      const { pathname } = new URL(response.url());
      // "Nobody is signed in" is /me's ordinary answer for a wallet that has not signed in yet: a 401, by design.
      const expected = (response.status() === 404 && expectedNotFound.includes(pathname)) || (response.status() === 401 && pathname === "/me");
      if (response.status() >= 400 && !expected) problems.push(`HTTP ${response.status()} ${response.url()}`);
    });
    await use(page);
    expect(problems, "the browser logged errors").toEqual([]);
  },
});

export { expect };
