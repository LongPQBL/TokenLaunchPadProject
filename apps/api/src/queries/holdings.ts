import { getSql } from "../db.js";

export interface Holding {
  token: string;
  amount: bigint;
}

/** More than this many distinct tokens in one wallet is not a real wallet, and one response should stay a sensible size. */
export const MAX_HOLDINGS = 200;

/**
 * Every token an address holds, biggest first. Hidden tokens are INCLUDED: moderation removes a token from the lists, and
 * must never make anyone's money unreachable. The launchpad and the burn address are not special-cased here: this asks
 * about one address, and whoever asks about those gets their real balances.
 */
export async function listHoldings(chainId: number, holder: string): Promise<Holding[]> {
  const rows = await getSql()`
    select token, amount
    from launchpad.balance
    where chain_id = ${chainId} and holder = ${holder} and amount > 0
    order by amount desc, token
    limit ${MAX_HOLDINGS}`;
  return rows.map((r) => ({ token: r.token, amount: BigInt(r.amount) }));
}
