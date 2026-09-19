import { parseEther, parseUnits } from "viem";
import { launchpadAbi } from "../../../abi/index.ts";
import { makeContext } from "./clients.ts";
import { createToken } from "./create.ts";
import type { Curve } from "./lib.ts";
import { previewBuyLocal, previewSellLocal, tokensForBudget } from "./quote.ts";
import { buyWithEth } from "./trade.ts";

// Compares the off-chain replicas with the contract on a live deployment, at several points of the curve.
const ctx = makeContext();
const { deployment, publicClient } = ctx;
const read = <T>(functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address: deployment.launchpad, abi: launchpadAbi, functionName, args } as never) as Promise<T>;

const funder = ctx.wallet(Number(process.env.FUNDER_INDEX ?? 4));
const creator = ctx.randomWallet();
const trader = ctx.randomWallet();
for (const w of [creator, trader]) {
  await publicClient.waitForTransactionReceipt({ hash: await funder.sendTransaction({ to: w.account.address, value: parseEther("10") }) });
}
const { token } = await createToken(ctx, creator, {
  name: "Quote Check", ticker: "QC", metadataURI: "ipfs://x", quoteToken: deployment.weth, antiSniperWindow: 600,
});
const feeBps = await read<bigint>("tradeFeeBps");

let checked = 0;
for (const round of [0, 1, 2]) {
  const c = await read<Curve>("getCurve", [token]);
  const taxBps = await read<bigint>("currentLaunchTaxBps", [token]);
  for (const amount of [1n, 12_345n, parseUnits("1", 18), parseUnits("5000000", 18), parseUnits("300000000", 18), 2n ** 200n]) {
    const [amountOut, quoteCost, fee] = await read<readonly [bigint, bigint, bigint]>("previewBuy", [token, amount]);
    const local = previewBuyLocal(c, { feeBps, taxBps }, amount);
    if (local.amountOut !== amountOut || local.quoteCost !== quoteCost || local.fee !== fee) {
      throw new Error(`buy mismatch (round ${round}, amount ${amount}): chain ${[amountOut, quoteCost, fee]} local ${[local.amountOut, local.quoteCost, local.fee]}`);
    }
    checked++;
  }
  // "spend X ETH": the amount found off-chain must be affordable and the next token unit must not be.
  for (const budget of [parseEther("0.01"), parseEther("0.05")]) {
    const amount = tokensForBudget(c, { feeBps, taxBps }, budget);
    const [, cost, fee] = await read<readonly [bigint, bigint, bigint]>("previewBuy", [token, amount]);
    if (amount > 0n && cost + fee > budget) throw new Error("tokensForBudget overspends");
    const over = previewBuyLocal(c, { feeBps, taxBps }, amount + 1n).total;
    if (amount < c.realTokenReserves - c.floor && over <= budget) throw new Error("tokensForBudget is not maximal");
    checked++;
  }
  // sells, once there is something to sell
  if (round > 0) {
    const sold = c.tokenTotalSupply - c.realTokenReserves;
    for (const amount of [1n, sold / 3n, sold]) {
      const [quoteOut, fee] = await read<readonly [bigint, bigint]>("previewSell", [token, amount]);
      const local = previewSellLocal(c, feeBps, amount);
      if (local.quoteOut !== quoteOut || local.fee !== fee) throw new Error(`sell mismatch (amount ${amount})`);
      checked++;
    }
  }
  // move the curve, and skip time so the launch tax changes between rounds
  await buyWithEth(ctx, trader, token, parseUnits("40000000", 18), 200n);
  await ctx.testClient.increaseTime({ seconds: 300 });
  await ctx.testClient.mine({ blocks: 1 });
}
console.log(`OK: ${checked} off-chain quotes match the contract exactly`);
