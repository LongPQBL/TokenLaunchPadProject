import { getSql } from "../db.js";
import { listColumns, mapListRow, type TokenListItem } from "./tokenList.js";
import { MAX_HOLDINGS } from "./holdings.js";

const MAX_CREATED = 100;

export interface Profile {
  /** Tokens this address launched, newest first. */
  created: TokenListItem[];
  /** Tokens it holds, biggest first, each described as the lists describe it. */
  holdings: { token: TokenListItem; amount: bigint }[];
}

/**
 * What an address has done on the launchpad. Both lists leave out a hidden token (this is a page about a person, and a
 * hidden token is not to be shown), and holdings leave out a zero balance. An address that never touched the launchpad is
 * two empty lists, never an error. (The withdraw path reads `listHoldings`, which keeps hidden tokens: someone's money must
 * stay reachable however the page treats a token.)
 */
export async function getProfile(chainId: number, address: string): Promise<Profile> {
  const sql = getSql();
  const [created, held] = await Promise.all([
    sql`
      select ${listColumns(sql)}
      from launchpad.token t
      left join app.token_metadata m on m.chain_id = t.chain_id and m.token = t.address
      where t.chain_id = ${chainId} and t.creator = ${address} and coalesce(m.status, 'pending') <> 'hidden'
      order by t.created_at desc, t.address desc
      limit ${MAX_CREATED}`,
    sql`
      select ${listColumns(sql)}, b.amount::text as held
      from launchpad.balance b
      join launchpad.token t on t.chain_id = b.chain_id and t.address = b.token
      left join app.token_metadata m on m.chain_id = t.chain_id and m.token = t.address
      where b.chain_id = ${chainId} and b.holder = ${address} and b.amount > 0 and coalesce(m.status, 'pending') <> 'hidden'
      order by b.amount desc, b.token
      limit ${MAX_HOLDINGS}`,
  ]);
  return {
    created: created.map(mapListRow),
    holdings: held.map((r) => ({ token: mapListRow(r), amount: BigInt(r.held) })),
  };
}
