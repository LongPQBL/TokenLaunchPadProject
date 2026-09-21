import { getSql } from "../db.js";
import { DEFAULT_IPFS_GATEWAY, ipfsToHttp } from "../metadata/ipfs.js";

const DEAD = "0x000000000000000000000000000000000000dead";

export interface Holder {
  holder: string;
  amount: bigint;
  /** What the buys cost: each one's price plus its fee (which includes any launch tax). Raw quote units. Trades on the curve only. */
  spent: bigint;
  /** What the sells paid out: each one's price less its fee. */
  received: bigint;
  /** The balance at the price the curve is at now (spot, before the slippage of selling it all). 0 with no reserves. */
  value: bigint;
  /** value + received - spent: what they have made on this token, counting what they still hold. For tokens that came by transfer (nothing spent) it is the whole value. */
  pnl: bigint;
  /** Who they are, if they have said (and are not banned): the name they chose, and their picture as a URL on the one gateway. */
  username?: string;
  avatarUrl?: string;
}

/**
 * Top holders by balance, with what their tokens are worth and what they have made. Three addresses are not holders even though they
 * hold a balance: the launchpad (it keeps the unsold supply), the burn address (it receives the LP tokens) and, once migrated, the
 * token's pool. Left in, the top holder would always be a contract. The pool is only known after migration, so it is excluded here,
 * at query time, rather than in the indexer.
 *
 * Value and profit are worked out as they are for an address's positions (see listPositions): a buy pays `quoteAmount + fee`, a sell
 * receives `quoteAmount - fee`, and the balance is valued at the spot price. A banned user is not named and their picture is not shown,
 * but their balance still counts: a ban is about what they say, not about the supply.
 */
export async function listHolders(
  chainId: number,
  token: string,
  opts: { limit: number; launchpad?: string; gateway?: string },
): Promise<Holder[]> {
  const launchpad = (opts.launchpad ?? DEAD).toLowerCase();
  const gateway = opts.gateway ?? DEFAULT_IPFS_GATEWAY;
  const rows = await getSql()`
    select b.holder, b.amount::text as amount,
           x.spent::text as spent, x.received::text as received,
           v.value::text as value,
           u.username, u.avatar_uri
    from launchpad.balance b
    join launchpad.token t on t.chain_id = b.chain_id and t.address = b.token
    left join app.app_user u on u.address = b.holder and u.banned_at is null
    cross join lateral (
      select
        coalesce(sum(tr.quote_amount + tr.fee) filter (where tr.is_buy), 0) as spent,
        coalesce(sum(tr.quote_amount - tr.fee) filter (where not tr.is_buy), 0) as received
      from launchpad.trade tr
      where tr.chain_id = b.chain_id and tr.token = b.token and tr.trader = b.holder
    ) x
    cross join lateral (
      select case when t.virtual_token_reserves > 0 then floor(b.amount * t.virtual_quote_reserves / t.virtual_token_reserves) else 0 end as value
    ) v
    where b.chain_id = ${chainId} and b.token = ${token}
      and b.amount > 0
      and b.holder <> ${launchpad}
      and b.holder <> ${DEAD}
      and (t.pair is null or b.holder <> t.pair)
    order by b.amount desc, b.holder desc
    limit ${opts.limit}`;
  return rows.map((r) => {
    const spent = BigInt(r.spent);
    const received = BigInt(r.received);
    const value = BigInt(r.value);
    const avatarUrl = (r.avatar_uri && ipfsToHttp(r.avatar_uri, gateway)) || undefined;
    return {
      holder: r.holder,
      amount: BigInt(r.amount),
      spent,
      received,
      value,
      pnl: value + received - spent,
      ...(r.username ? { username: r.username } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
    };
  });
}
