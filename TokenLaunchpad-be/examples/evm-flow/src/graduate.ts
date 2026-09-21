import { maxUint256, parseEventLogs, parseAbi, type Address } from "viem";
import { launchpadAbi } from "../../../abi/index.ts";
import type { Ctx, Wallet } from "./clients.ts";
import { buyWithEth } from "./trade.ts";

const pairAbi = parseAbi([
  "function token0() view returns (address)",
  "function getReserves() view returns (uint112, uint112, uint32)",
]);

/** Buys everything that is left on the curve. The contract clips the amount at the graduation floor. */
export async function buyToCompletion(ctx: Ctx, trader: Wallet, token: Address) {
  const result = await buyWithEth(ctx, trader, token, maxUint256, 100n);
  const receipt = await ctx.publicClient.getTransactionReceipt({ hash: result.hash });
  const completed = parseEventLogs({ abi: launchpadAbi, logs: receipt.logs, eventName: "Complete" }).length > 0;
  return { ...result, completed };
}

/** Anyone can call migrate once the curve is complete. This is what the platform's bot does. */
export async function migrate(ctx: Ctx, caller: Wallet, token: Address) {
  const { deployment, publicClient } = ctx;
  const hash = await caller.writeContract({
    address: deployment.launchpad,
    abi: launchpadAbi,
    functionName: "migrate",
    args: [token],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const [migrated] = parseEventLogs({ abi: launchpadAbi, logs: receipt.logs, eventName: "Migrated" });
  return { ...migrated!.args, hash, gasUsed: receipt.gasUsed };
}

/** Reads the Uniswap V2 pool created by migrate: [quote reserve, token reserve]. */
export async function poolReserves(ctx: Ctx, pair: Address, quoteToken: Address) {
  const [token0, reserves] = await Promise.all([
    ctx.publicClient.readContract({ address: pair, abi: pairAbi, functionName: "token0" }),
    ctx.publicClient.readContract({ address: pair, abi: pairAbi, functionName: "getReserves" }),
  ]);
  const quoteIsToken0 = token0.toLowerCase() === quoteToken.toLowerCase();
  return quoteIsToken0 ? { quote: reserves[0], token: reserves[1] } : { quote: reserves[1], token: reserves[0] };
}
