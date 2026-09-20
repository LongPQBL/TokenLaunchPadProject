import { launchpadAbi, tokenFactoryAbi } from "@vezta/abi";
import { parseEventLogs, type Address, type Log, type PublicClient } from "viem";
import type { MigrationOutcome } from "./migrate";

const MAX_REMEMBERED = 10_000;
const LOG_RANGE = 2_000n;
/** Each poll re-reads this many recent blocks: an event in a block that arrived late, or one that failed to publish, gets another chance. */
const OVERLAP = 5n;

export interface WatcherDeps {
  publicClient: PublicClient;
  launchpad: Address;
  factory: Address;
  /** The chain's slug in URLs and channel names ("sepolia"). */
  chain: string;
  /** Sends one message to a Redis channel. May throw: Redis being down must never stop the watcher. */
  publish: (channel: string, message: string) => Promise<unknown>;
  /** The migration bot, in this same process: a Complete is handed to it. */
  migrator: { handleComplete: (token: Address) => Promise<MigrationOutcome> };
  onError?: (error: unknown) => void;
}

/** A bounded set that forgets its oldest entries, so a process that runs for months does not grow without limit. */
function boundedSet() {
  const set = new Set<string>();
  return {
    has: (k: string) => set.has(k),
    add(k: string) {
      set.add(k);
      if (set.size > MAX_REMEMBERED) set.delete(set.values().next().value!);
    },
    get size() {
      return set.size;
    },
  };
}

const lower = (a: string) => a.toLowerCase();
const str = (n: bigint) => n.toString();

/**
 * The one process that follows the chain (spec §6). It publishes what it sees to Redis pub/sub, and API instances fan that
 * out over websockets, so adding API instances never duplicates an event. Side effects are HERE and never in a Ponder
 * handler, because handlers replay during backfill and reorgs and would re-emit old events.
 *
 * It starts from the head: history is what REST and the migration bot's catch-up are for. Each poll re-reads a few
 * recent blocks and deduplicates by txHash-logIndex, so a reorg, a late block or a failed publish gets a second chance
 * and nothing goes out twice. It is best-effort by design: if it dies, realtime stops, REST keeps working, and pages fall
 * back to polling.
 */
export function createWatcher(deps: WatcherDeps) {
  const { publicClient, chain } = deps;
  const onError = deps.onError ?? ((e: unknown) => console.error(e));
  const published = boundedSet(); // events that reached Redis
  const handedToBot = boundedSet(); // Complete events the migration bot has been given
  let cursor: bigint | undefined;

  async function send(channels: string[], message: Record<string, unknown>): Promise<boolean> {
    const body = JSON.stringify(message);
    try {
      for (const channel of channels) await deps.publish(channel, body);
      return true;
    } catch (e) {
      onError(e);
      return false;
    }
  }

  async function handle(log: Log & { eventName: string; args: Record<string, unknown> }) {
    const id = `${log.transactionHash}-${log.logIndex}`;
    const common = { id, chain, blockNumber: str(log.blockNumber!), txHash: log.transactionHash!, logIndex: log.logIndex! };
    const a = log.args;
    const tokenChannel = (token: string) => `token:${chain}:${lower(token)}`;

    if (log.eventName === "Complete" && !handedToBot.has(id)) {
      handedToBot.add(id);
      // Not awaited: a migration takes seconds and must not hold up the feed. It reports its own failures.
      void deps.migrator.handleComplete(a.mint as Address).catch(onError);
    }
    if (published.has(id)) return;

    let ok = false;
    switch (log.eventName) {
      case "Trade": {
        const message = {
          type: "trade",
          ...common,
          token: lower(a.mint as string),
          trader: lower(a.user as string),
          isBuy: a.isBuy as boolean,
          quoteAmount: str(a.quoteAmount as bigint),
          tokenAmount: str(a.tokenAmount as bigint),
          timestamp: str(a.timestamp as bigint),
          virtualQuoteReserves: str(a.virtualQuoteReserves as bigint),
          virtualTokenReserves: str(a.virtualTokenReserves as bigint),
          fee: str(a.fee as bigint),
          launchTax: str(a.launchTax as bigint),
        };
        ok = await send(["trades", tokenChannel(a.mint as string)], message);
        break;
      }
      case "Complete":
        ok = await send([tokenChannel(a.mint as string)], { type: "complete", ...common, token: lower(a.mint as string), timestamp: str(a.timestamp as bigint) });
        break;
      case "Migrated":
        ok = await send([tokenChannel(a.mint as string)], {
          type: "migrated",
          ...common,
          token: lower(a.mint as string),
          pair: lower(a.pair as string),
          quoteAmount: str(a.quoteAmount as bigint),
          tokenAmount: str(a.tokenAmount as bigint),
        });
        break;
      case "TokenCreated":
        ok = await send(["tokens"], {
          type: "created",
          ...common,
          token: lower(a.token as string),
          creator: lower(a.creator as string),
          quoteToken: lower(a.quoteToken as string),
          name: a.name as string,
          ticker: a.ticker as string,
          metadataURI: a.metadataURI as string,
        });
        break;
    }
    // Only what actually reached Redis is remembered as sent: the overlap re-reads the rest and tries again.
    if (ok) published.add(id);
  }

  /** One pass: everything since last time, in bounded ranges, in chain order. Throws if the RPC fails; nothing is skipped. */
  async function poll(): Promise<void> {
    const head = await publicClient.getBlockNumber();
    if (cursor === undefined) {
      cursor = head;
      return;
    }
    if (head <= cursor) return;

    const from = cursor - OVERLAP + 1n > 0n ? cursor - OVERLAP + 1n : 0n;
    for (let start = from; start <= head; start += LOG_RANGE) {
      const end = start + LOG_RANGE - 1n < head ? start + LOG_RANGE - 1n : head;
      const logs = await publicClient.getLogs({ address: [deps.launchpad, deps.factory], fromBlock: start, toBlock: end });
      const own = (address: Address) => logs.filter((l) => lower(l.address) === lower(address));
      const decoded = [
        ...parseEventLogs({ abi: launchpadAbi, logs: own(deps.launchpad), eventName: ["Trade", "Complete", "Migrated"] }),
        ...parseEventLogs({ abi: tokenFactoryAbi, logs: own(deps.factory), eventName: ["TokenCreated"] }),
      ] as unknown as (Log & { eventName: string; args: Record<string, unknown> })[];
      decoded.sort((x, y) => Number(x.blockNumber! - y.blockNumber!) || x.logIndex! - y.logIndex!);
      for (const log of decoded) await handle(log);
    }
    cursor = head; // only after every range was read: a failure above leaves the cursor, and the next poll retries
  }

  /** Polls every `pollMs`, never two at once, and keeps going after a failure. */
  function start(pollMs: number): { stop: () => void } {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await poll();
      } catch (e) {
        onError(e);
      } finally {
        running = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), pollMs);
    return { stop: () => clearInterval(timer) };
  }

  return { poll, start, rememberedCount: () => published.size + handedToBot.size };
}
