import { launchpadAbi } from "@vezta/abi";
import { BaseError, ContractFunctionRevertedError, type Account, type Address, type PublicClient, type WalletClient } from "viem";

/** migrate deploys the Uniswap pair, so it costs about 2.7M gas; 3M is the ceiling used to size the reserve. */
export const MIGRATE_GAS = 3_000_000n;
/** The wallet only needs gas. It is warned about when it could not pay for this many more migrations. */
export const MIN_MIGRATIONS_OF_GAS = 50;

const MAX_ATTEMPTS = 4;
const LOG_RANGE = 5_000n;
const MAX_REMEMBERED = 10_000;

export type MigrationOutcome = "migrated" | "already" | "not-ready";

/** The contract's custom error a call reverted with, if it was a revert at all. */
function errorName(e: unknown): string | undefined {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName;
  }
  return undefined;
}

const completeEvent = launchpadAbi.find((item) => item.type === "event" && item.name === "Complete")!;

export interface MigratorDeps {
  publicClient: PublicClient;
  walletClient: WalletClient;
  /** The bot wallet's address: what its balance is read from and what a warning names. */
  account: Address;
  /**
   * What is handed to the client as `account` when sending. Defaults to `account`, an address, which tells viem to ask the
   * NODE to sign for it, and a node holds no such key ("No Signer available"). A bot that signs itself passes its local
   * account object here.
   */
  signer?: Account | Address;
  launchpad: Address;
  /** Block to start catching up from: the deployment's own, so history is never scanned from genesis. */
  deployBlock: bigint;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

/**
 * The migration bot's logic. `migrate(token)` is permissionless: anyone may call it, so the bot only makes it happen
 * sooner, and it has to be idempotent, since another wallet, a retry or a reorg may get there first. It never holds much:
 * its wallet needs gas and nothing else.
 */
export function createMigrator(deps: MigratorDeps) {
  const { publicClient, walletClient, account, launchpad } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = deps.log ?? ((m: string) => console.log(m));
  const warn = deps.warn ?? ((m: string) => console.warn(m));

  /**
   * One token. Reads the curve FIRST, so an event delivered again after the migration costs a read and no gas. Every
   * retry reads it again: a transaction that failed on the wire may still have landed. A revert is an answer, not a
   * failure: AlreadyMigrated means someone else won (success), NotCompleted means a bug or a reorg (retrying cannot help).
   * Only what looks like a failure of the network is retried, with growing pauses, and then reported.
   */
  async function migrateIfNeeded(token: Address): Promise<MigrationOutcome> {
    for (let attempt = 1; ; attempt++) {
      try {
        const curve = (await publicClient.readContract({ address: launchpad, abi: launchpadAbi, functionName: "getCurve", args: [token] })) as {
          complete: boolean;
          migrated: boolean;
        };
        if (curve.migrated) return "already";
        if (!curve.complete) return "not-ready";
        const hash = await walletClient.writeContract({ address: launchpad, abi: launchpadAbi, functionName: "migrate", args: [token], account: deps.signer ?? account, chain: null });
        await publicClient.waitForTransactionReceipt({ hash });
        log(`migrated ${token} in ${hash}`);
        return "migrated";
      } catch (e) {
        const name = errorName(e);
        if (name === "AlreadyMigrated") return "already";
        if (name === "NotCompleted" || name === "CurveNotFound") return "not-ready";
        if (attempt >= MAX_ATTEMPTS) throw e;
        await sleep(1_000 * 2 ** (attempt - 1));
      }
    }
  }

  // What has been dealt with, so a Complete event that arrives again (a reorg redelivers) is not worked on again. Bounded.
  const done = new Set<string>();
  const inFlight = new Map<string, Promise<MigrationOutcome>>();

  /** Handles one Complete event. Delivered twice, at once or later, it migrates once. A failure is not remembered as done. */
  function handleComplete(token: Address): Promise<MigrationOutcome> {
    const key = token.toLowerCase();
    if (done.has(key)) return Promise.resolve("already");
    const running = inFlight.get(key);
    if (running) return running;

    const work = migrateIfNeeded(token)
      .then((outcome) => {
        if (outcome !== "not-ready") {
          done.add(key);
          if (done.size > MAX_REMEMBERED) done.delete(done.values().next().value!);
        }
        return outcome;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, work);
    return work;
  }

  /** Migrates whatever completed while the bot was not watching. Returns the tokens it migrated. */
  async function catchUp(fromBlock: bigint = deps.deployBlock): Promise<Address[]> {
    const head = await publicClient.getBlockNumber();
    const tokens = new Map<string, Address>();
    for (let from = fromBlock; from <= head; from += LOG_RANGE) {
      const to = from + LOG_RANGE - 1n < head ? from + LOG_RANGE - 1n : head;
      const logs = await publicClient.getLogs({ address: launchpad, event: completeEvent as never, fromBlock: from, toBlock: to });
      for (const l of logs as unknown as { args: { mint: Address } }[]) tokens.set(l.args.mint.toLowerCase(), l.args.mint);
    }

    const migrated: Address[] = [];
    for (const token of tokens.values()) {
      try {
        if ((await handleComplete(token)) === "migrated") migrated.push(token);
      } catch (e) {
        warn(`could not migrate ${token}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return migrated;
  }

  /** Says so when the wallet could not pay for fifty more migrations. It never stops the bot. */
  async function checkBalance(): Promise<void> {
    try {
      const [balance, gasPrice] = await Promise.all([publicClient.getBalance({ address: account }), publicClient.getGasPrice()]);
      const needed = MIGRATE_GAS * gasPrice * BigInt(MIN_MIGRATIONS_OF_GAS);
      if (balance < needed) {
        warn(`bot wallet ${account} holds ${balance} wei, less than ${needed} wei: not enough for ${MIN_MIGRATIONS_OF_GAS} migrations. Top it up.`);
      }
    } catch (e) {
      warn(`could not read the balance of bot wallet ${account}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { migrateIfNeeded, handleComplete, catchUp, checkBalance, rememberedCount: () => done.size + inFlight.size };
}

export type Migrator = ReturnType<typeof createMigrator>;
