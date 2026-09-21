import { safeHttpUrl } from "@vezta/shared";
import { getSql } from "../db.js";
import { mapListRow, type TokenListItem } from "./tokenList.js";

export interface TokenDetail extends TokenListItem {
  quoteToken: string;
  antiSniperWindow: number;
  virtualQuoteReserves: bigint;
  virtualTokenReserves: bigint;
  pair?: string;
  /** ok | pending | invalid. A token in any of these is shown; only `hidden` removes it. */
  metadataStatus: string;
  socials: Record<string, string>;
}

const SOCIAL_KEYS = ["website", "twitter", "telegram"] as const;

/**
 * The resolver already validates links before caching them, but a link is about to be put in an href, so it
 * is checked again here: a row written by any other route must still not hand the browser a javascript: URL.
 */
function safeSocials(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const key of SOCIAL_KEYS) {
    const url = safeHttpUrl((raw as Record<string, unknown>)[key]);
    if (url) out[key] = url;
  }
  return out;
}

/**
 * One token, or undefined when the indexer has never seen it OR it is hidden. Returning undefined for a
 * hidden token, rather than the row with a flag, is what makes moderation complete: a shared link to a
 * hidden token cannot show it, and neither can anything built on this function.
 */
export async function getToken(chainId: number, address: string): Promise<TokenDetail | undefined> {
  const [r] = await getSql()`
    select
      t.address, t.creator, t.ticker, t.progress_bps, t.volume_quote, t.trade_count, t.complete, t.migrated, t.created_at,
      t.quote_token, t.anti_sniper_window, t.virtual_quote_reserves, t.virtual_token_reserves, t.pair,
      t.name as chain_name,
      case when m.status = 'ok' then m.name end as meta_name,
      case when m.status = 'ok' then m.description end as description,
      case when m.status = 'ok' then m.image_cdn_url end as image_url,
      case when m.status = 'ok' then m.socials end as socials,
      coalesce(m.status, 'pending') as metadata_status
    from launchpad.token t
    left join app.token_metadata m on m.chain_id = t.chain_id and m.token = t.address
    where t.chain_id = ${chainId} and t.address = ${address}
      and coalesce(m.status, 'pending') <> 'hidden'`;
  if (!r) return undefined;
  return {
    ...mapListRow(r),
    quoteToken: r.quote_token,
    antiSniperWindow: r.anti_sniper_window,
    virtualQuoteReserves: BigInt(r.virtual_quote_reserves),
    virtualTokenReserves: BigInt(r.virtual_token_reserves),
    pair: r.pair ?? undefined,
    metadataStatus: r.metadata_status,
    socials: safeSocials(r.socials),
  };
}
