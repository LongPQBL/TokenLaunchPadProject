import type { Address } from "viem";
import { parseEventLogs } from "viem";
import { launchpadAbi } from "../../../abi/index.ts";
import type { Ctx, Wallet } from "./clients.ts";
import type { Curve } from "./lib.ts";
import { errorName } from "./lib.ts";

// The platform's migration bot. migrate(token) is permissionless: anyone can call it, so the bot only speeds
// things up. It must be idempotent (another wallet, or a retry, may get there first) and must never hold much money:
// the wallet only needs enough ETH for gas (the pair deployment makes migrate cost about 2.7M gas).

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function isMigrated(ctx: Ctx, token: Address) {
  const curve = (await ctx.publicClient.readContract({
    address: ctx.deployment.launchpad, abi: launchpadAbi, functionName: "getCurve", args: [token],
  })) as Curve;
  return curve.migrated;
}

/** Migrates one token. Safe to call twice; returns what happened. */
export async function migrateToken(ctx: Ctx, wallet: Wallet, token: Address, log = console.log) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      if (await isMigrated(ctx, token)) return "already-migrated" as const;
      const hash = await wallet.writeContract({
        address: ctx.deployment.launchpad, abi: launchpadAbi, functionName: "migrate", args: [token],
      });
      await ctx.publicClient.waitForTransactionReceipt({ hash });
      log(`migrated ${token} in ${hash}`);
      return "migrated" as const;
    } catch (e) {
      const name = errorName(e);
      if (name === "AlreadyMigrated") return "already-migrated" as const; // someone else won the race: fine
      if (name === "NotCompleted") throw e; // a bug or a reorg: do not retry blindly
      log(`migrate ${token} failed (attempt ${attempt}): ${name ?? (e as Error).message.split("\n")[0]}`);
      await sleep(500 * 2 ** attempt); // backoff for transient RPC or gas errors
    }
  }
  return "gave-up" as const; // alert a human; the curve stays safe, migration just waits
}

/** On startup: migrate every curve that completed while the bot was down. */
export async function catchUp(ctx: Ctx, wallet: Wallet, log = console.log) {
  const logs = await ctx.publicClient.getLogs({
    address: ctx.deployment.launchpad,
    event: launchpadAbi.find((x) => x.type === "event" && x.name === "Complete")!,
    fromBlock: BigInt(ctx.deployment.deployBlock),
    toBlock: "latest",
  });
  for (const l of parseEventLogs({ abi: launchpadAbi, logs, eventName: "Complete" })) await migrateToken(ctx, wallet, l.args.mint, log);
}

/** Live mode: react to Complete events. Returns a function that stops the bot. */
export function startMigrationBot(ctx: Ctx, wallet: Wallet, log = console.log) {
  const inFlight = new Set<string>();
  return ctx.publicClient.watchContractEvent({
    address: ctx.deployment.launchpad,
    abi: launchpadAbi,
    eventName: "Complete",
    pollingInterval: 1_000,
    onLogs: (logs) => {
      for (const l of logs) {
        const token = l.args.mint!;
        if (inFlight.has(token)) continue; // the same event can be delivered twice around a reorg
        inFlight.add(token);
        migrateToken(ctx, wallet, token, log).finally(() => inFlight.delete(token));
      }
    },
  });
}
