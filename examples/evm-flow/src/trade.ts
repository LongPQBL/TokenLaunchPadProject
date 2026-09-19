import { parseEventLogs, type Address } from "viem";
import { launchpadAbi, tokenAbi } from "../../../abi/index.ts";
import type { Ctx, Wallet } from "./clients.ts";
import { maxCostWithSlippage, minPayoutWithSlippage } from "./lib.ts";

/** Reads the current price of `amount` tokens. Includes the launch tax at the current time. */
export async function quoteBuy(ctx: Ctx, token: Address, amount: bigint) {
  const { deployment, publicClient } = ctx;
  const [amountOut, quoteCost, fee] = await publicClient.readContract({
    address: deployment.launchpad,
    abi: launchpadAbi,
    functionName: "previewBuy",
    args: [token, amount],
  });
  const taxBps = await publicClient.readContract({
    address: deployment.launchpad,
    abi: launchpadAbi,
    functionName: "currentLaunchTaxBps",
    args: [token],
  });
  // amountOut can be smaller than `amount`: the last buy is clipped at the graduation floor.
  return { amountOut, quoteCost, fee, total: quoteCost + fee, taxBps };
}

/** Buys with native ETH (WETH curves only). `amount` may be maxUint256 to buy everything that is left. */
export async function buyWithEth(ctx: Ctx, trader: Wallet, token: Address, amount: bigint, slippageBps = 100n) {
  const { deployment, publicClient } = ctx;
  const q = await quoteBuy(ctx, token, amount);
  const maxCost = maxCostWithSlippage(q.total, slippageBps);
  const hash = await trader.writeContract({
    address: deployment.launchpad,
    abi: launchpadAbi,
    functionName: "buyWithEth",
    args: [token, amount, maxCost],
    value: maxCost, // the contract refunds whatever exceeds the real price
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  // Always read what was really bought from the event, not from the request.
  const [trade] = parseEventLogs({ abi: launchpadAbi, logs: receipt.logs, eventName: "Trade" });
  return { quote: q, trade: trade!.args, hash, gasUsed: receipt.gasUsed };
}

/** Sells tokens for native ETH. The token must be approved for the launchpad first. */
export async function sellForEth(ctx: Ctx, trader: Wallet, token: Address, amount: bigint, slippageBps = 100n) {
  const { deployment, publicClient } = ctx;
  const approveHash = await trader.writeContract({
    address: token,
    abi: tokenAbi,
    functionName: "approve",
    args: [deployment.launchpad, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const [quoteOut, fee] = await publicClient.readContract({
    address: deployment.launchpad,
    abi: launchpadAbi,
    functionName: "previewSell",
    args: [token, amount],
  });
  const payout = quoteOut - fee; // the seller receives the price minus the fee
  const hash = await trader.writeContract({
    address: deployment.launchpad,
    abi: launchpadAbi,
    functionName: "sellForEth",
    args: [token, amount, minPayoutWithSlippage(payout, slippageBps)],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const [trade] = parseEventLogs({ abi: launchpadAbi, logs: receipt.logs, eventName: "Trade" });
  return { payout, trade: trade!.args, hash, gasUsed: receipt.gasUsed };
}
