import type { Heartbeat } from "@vezta/shared";
import { getSql } from "../db.js";

export interface HealthDeps {
  /** The chain's newest block. */
  chainHead?: () => Promise<bigint>;
  /** The newest block the indexer has handled. */
  indexerBlock?: () => Promise<bigint | undefined>;
  heartbeat?: () => Promise<Heartbeat | undefined>;
  /** Unix seconds. Injected so a test can say what time it is. */
  now?: () => number;
  /** How long to wait for any one dependency before giving up on it. */
  timeoutMs?: number;
}

export interface Health {
  /** Blocks the indexer is behind the chain, or null when either could not be read. */
  indexerLagBlocks: number | null;
  /** Unix seconds, as a string, or null when the watcher is not sending heartbeats. */
  watcherAliveSince: string | null;
  botAddress: string | null;
  /** Wei, as a string, or null when unknown. */
  botBalance: string | null;
  /** Tokens whose metadata was given up on. */
  failedMetadataCount: number;
  stuckTokens: { address: string; name?: string; ticker?: string; completeSince: string }[];
}

/** A curve that filled and has not migrated after this long has missed the bot: someone should look. */
const STUCK_AFTER_SECONDS = 120;
const DEFAULT_TIMEOUT_MS = 3_000;

/** What a dependency says, or undefined if it errors or is too slow. A monitor must keep answering when what it watches is down. */
async function tryFor<T>(read: (() => Promise<T>) | undefined, timeoutMs: number): Promise<T | undefined> {
  if (!read) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const gaveUp = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), timeoutMs);
    });
    return await Promise.race([read(), gaveUp]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What an operator needs to see at a glance. Every figure that comes from outside (the node, the indexer, Redis) is null when
 * it cannot be had, never zero or a guess: "unknown" and "fine" must not look alike.
 */
export async function getHealth(chainId: number, deps: HealthDeps = {}): Promise<Health> {
  const timeout = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  const sql = getSql();

  const [head, indexed, beat, failed, stuck] = await Promise.all([
    tryFor(deps.chainHead, timeout),
    tryFor(deps.indexerBlock, timeout),
    tryFor(deps.heartbeat, timeout),
    sql`select count(*)::int as n from app.token_metadata where chain_id = ${chainId} and status = 'invalid'`,
    // "Since" is the last trade on record: the trade that fills a curve is the last one it ever has. A token with no trades on
    // record counts from when it was made.
    sql`
      select t.address, t.name, t.ticker, floor(coalesce(max(tr."timestamp"), t.created_at))::text as complete_since
      from launchpad.token t
      left join launchpad.trade tr on tr.chain_id = t.chain_id and tr.token = t.address
      left join app.token_metadata m on m.chain_id = t.chain_id and m.token = t.address
      where t.chain_id = ${chainId} and t.complete and not t.migrated and coalesce(m.status, 'pending') <> 'hidden'
      group by t.address, t.name, t.ticker, t.created_at
      having coalesce(max(tr."timestamp"), t.created_at) < ${now - STUCK_AFTER_SECONDS}
      order by coalesce(max(tr."timestamp"), t.created_at) asc`,
  ]);

  return {
    indexerLagBlocks: head === undefined || indexed === undefined ? null : Number(head > indexed ? head - indexed : 0n),
    watcherAliveSince: beat?.since ?? null,
    botAddress: beat?.address ?? null,
    botBalance: beat?.balance ?? null,
    failedMetadataCount: failed[0]!.n,
    stuckTokens: stuck.map((r) => ({ address: r.address, name: r.name ?? undefined, ticker: r.ticker ?? undefined, completeSince: r.complete_since })),
  };
}
