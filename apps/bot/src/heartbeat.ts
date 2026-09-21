import { HEARTBEAT_TTL_SECONDS, heartbeatKey } from "@vezta/shared";
import type { Address } from "viem";

/** A balance read that takes longer than this is left out of the beat: the beat must go out on time. */
const BALANCE_TIMEOUT_MS = 5_000;

export interface HeartbeatDeps {
  /** The chain's slug ("sepolia"): it names the key, so deployments do not read each other's. */
  chain: string;
  /** The bot wallet, so the admin page can say whose balance it is showing. */
  address: Address;
  getBalance: () => Promise<bigint>;
  /** Stores a value that expires after this many seconds. May throw: Redis being down must never stop the bot. */
  set: (key: string, value: string, ttlSeconds: number) => Promise<unknown>;
  onError?: (error: unknown) => void;
}

const unixNow = () => Math.floor(Date.now() / 1000);

/**
 * Tells the admin page this process is alive, and what the bot's wallet holds, by writing one key that expires. It never throws
 * and never blocks the bot: a failed write is reported and the next beat tries again, and a balance that cannot be read (or is
 * slow) is left out rather than holding the beat back, because being alive matters more than the figure.
 */
export function createHeartbeat(deps: HeartbeatDeps) {
  const onError = deps.onError ?? ((e: unknown) => console.error(e));
  const since = unixNow();
  let beating = false;

  async function balance(): Promise<string | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const gaveUp = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), BALANCE_TIMEOUT_MS);
      });
      const wei = await Promise.race([deps.getBalance(), gaveUp]);
      return wei === undefined ? undefined : wei.toString();
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  async function beat(): Promise<void> {
    try {
      const wei = await balance();
      const body = { since: String(since), at: String(unixNow()), address: deps.address, ...(wei === undefined ? {} : { balance: wei }) };
      await deps.set(heartbeatKey(deps.chain), JSON.stringify(body), HEARTBEAT_TTL_SECONDS);
    } catch (e) {
      onError(e);
    }
  }

  return {
    beat,
    /** Beats now and then every `everySeconds`. A beat that is still going is not joined by another. Returns how to stop. */
    start(everySeconds: number): () => void {
      const run = async () => {
        if (beating) return;
        beating = true;
        try {
          await beat();
        } finally {
          beating = false;
        }
      };
      void run();
      const timer = setInterval(() => void run(), everySeconds * 1_000);
      return () => clearInterval(timer);
    },
  };
}
