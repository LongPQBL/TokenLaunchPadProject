import { getSql } from "../db.js";

const DEAD = "0x000000000000000000000000000000000000dead";

export interface Holder {
  holder: string;
  amount: bigint;
}

/**
 * Top holders by balance. Three addresses are not holders even though they hold a balance: the launchpad (it
 * keeps the unsold supply), the burn address (it receives the LP tokens) and, once migrated, the token's pool.
 * Left in, the top holder would always be a contract. The pool is only known after migration, so it is
 * excluded here, at query time, rather than in the indexer.
 */
export async function listHolders(
  chainId: number,
  token: string,
  opts: { limit: number; launchpad?: string },
): Promise<Holder[]> {
  const launchpad = (opts.launchpad ?? DEAD).toLowerCase();
  const rows = await getSql()`
    select b.holder, b.amount
    from launchpad.balance b
    join launchpad.token t on t.chain_id = b.chain_id and t.address = b.token
    where b.chain_id = ${chainId} and b.token = ${token}
      and b.amount > 0
      and b.holder <> ${launchpad}
      and b.holder <> ${DEAD}
      and (t.pair is null or b.holder <> t.pair)
    order by b.amount desc, b.holder desc
    limit ${opts.limit}`;
  return rows.map((r) => ({ holder: r.holder, amount: BigInt(r.amount) }));
}
