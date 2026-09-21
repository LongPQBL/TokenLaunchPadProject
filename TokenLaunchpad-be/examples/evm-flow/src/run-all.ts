import { formatEther, formatUnits, parseEther, parseUnits, type Address } from "viem";
import { launchpadAbi } from "../../../abi/index.ts";
import { makeContext } from "./clients.ts";
import { createToken } from "./create.ts";
import { buyToCompletion, migrate, poolReserves } from "./graduate.ts";
import { errorName, minPayoutWithSlippage, progressBps, spotPrice, status, type Curve } from "./lib.ts";
import { buyWithEth, quoteBuy, sellForEth } from "./trade.ts";

const ctx = makeContext();
const { deployment, publicClient, testClient } = ctx;
const creator = ctx.randomWallet();
const trader = ctx.randomWallet();
const bot = ctx.randomWallet(); // anyone can call migrate; in production this is the platform's bot wallet
const step = (t: string) => console.log(`\n=== ${t}`);

const readCurve = (token: Address) =>
  publicClient.readContract({ address: deployment.launchpad, abi: launchpadAbi, functionName: "getCurve", args: [token] }) as Promise<Curve>;

async function main() {
  console.log(`chain ${deployment.chainId} | launchpad ${deployment.launchpad} | factory ${deployment.factory}`);

  // Local demo only: fund the fresh demo wallets from one of anvil's pre-funded accounts. On a fork use 4, not 0:
  // the well-known keys get swept by bots on public networks (see 05-local-development.md).
  const funder = ctx.wallet(Number(process.env.FUNDER_INDEX ?? 4));
  for (const w of [creator, trader, bot]) {
    const hash = await funder.sendTransaction({ to: w.account.address, value: parseEther("10") });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  step("1. Create a token with a 60 s anti-sniper window");
  const [enabled, graduationAmount] = await publicClient.readContract({
    address: deployment.launchpad, abi: launchpadAbi, functionName: "quotes", args: [deployment.weth],
  });
  console.log(`WETH quote enabled=${enabled}, graduation amount=${formatEther(graduationAmount)} ETH`);
  const created = await createToken(ctx, creator, {
    name: "Demo Token", ticker: "DEMO", metadataURI: "ipfs://bafy-demo-metadata", quoteToken: deployment.weth, antiSniperWindow: 60,
  });
  console.log(`token ${created.token}, create fee ${formatEther(created.createFee)} ETH, gas ${created.gasUsed}`);
  const token = created.token;

  step("2. Read the curve state for the token page");
  let c = await readCurve(token);
  console.log(`status=${status(c)} price=${spotPrice(c, 18)} ETH/token progress=${progressBps(c) / 100n}% pair=${c.pair}`);

  step("3. Quote the same buy at launch and after the tax window");
  const amount = parseUnits("1000000", 18); // 1M tokens (0.1% of supply)
  const early = await quoteBuy(ctx, token, amount);
  console.log(`t=0s : tax ${early.taxBps} bps, pays ${formatEther(early.total)} ETH (fee ${formatEther(early.fee)})`);
  await testClient.increaseTime({ seconds: 61 });
  await testClient.mine({ blocks: 1 });
  const late = await quoteBuy(ctx, token, amount);
  console.log(`t=61s: tax ${late.taxBps} bps, pays ${formatEther(late.total)} ETH (fee ${formatEther(late.fee)})`);

  step("4. Slippage protection: a too-low maxQuoteCost reverts with a readable error");
  try {
    await publicClient.simulateContract({
      account: trader.account, address: deployment.launchpad, abi: launchpadAbi, functionName: "buyWithEth",
      args: [token, amount, late.total - 1n], value: late.total,
    });
  } catch (e) {
    console.log(`reverted with: ${errorName(e)}`);
  }

  step("5. Buy with ETH, then sell half back");
  const buy = await buyWithEth(ctx, trader, token, amount);
  console.log(`bought ${formatUnits(buy.trade.tokenAmount, 18)} tokens, curve price ${formatEther(buy.trade.quoteAmount)} ETH, fee ${formatEther(buy.trade.fee)} (launch tax ${buy.trade.launchTax}), gas ${buy.gasUsed}`);
  const sell = await sellForEth(ctx, trader, token, buy.trade.tokenAmount / 2n);
  console.log(`sold ${formatUnits(sell.trade.tokenAmount, 18)} tokens for ${formatEther(sell.payout)} ETH (fee ${formatEther(sell.trade.fee)}), gas ${sell.gasUsed}`);

  step("6. Buy the rest: the last buy is clipped, the curve completes");
  const last = await buyToCompletion(ctx, trader, token);
  console.log(`completed=${last.completed}, bought ${formatUnits(last.trade.tokenAmount, 18)} tokens`);
  c = await readCurve(token);
  console.log(`status=${status(c)} collected=${formatEther(c.realQuoteReserves)} ETH (target ${formatEther(graduationAmount)})`);

  step("7. Migrate to Uniswap V2 (bot)");
  const m = await migrate(ctx, bot, token);
  const pool = await poolReserves(ctx, m.pair, deployment.weth);
  c = await readCurve(token);
  console.log(`status=${status(c)} pair=${m.pair} pool=${formatEther(pool.quote)} ETH + ${formatUnits(pool.token, 18)} tokens, gas ${m.gasUsed}`);

  step("8. Claim fees (anyone can trigger; money goes to the fixed recipient)");
  const platformFees = await publicClient.readContract({ address: deployment.launchpad, abi: launchpadAbi, functionName: "accruedQuoteFees", args: [deployment.weth] });
  const creatorFees = await publicClient.readContract({ address: deployment.launchpad, abi: launchpadAbi, functionName: "creatorFees", args: [creator.account.address, deployment.weth] });
  console.log(`platform fees ${formatEther(platformFees)} WETH, creator fees ${formatEther(creatorFees)} WETH`);
  for (const [fn, args] of [
    ["claimFees", [deployment.weth]],
    ["claimCreatorFees", [creator.account.address, deployment.weth]],
    ["claimCreateFees", []],
  ] as const) {
    const hash = await bot.writeContract({ address: deployment.launchpad, abi: launchpadAbi, functionName: fn, args: args as never });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`${fn} ok`);
  }
  console.log(`\nminPayout example (1% slippage on 1 ETH): ${formatEther(minPayoutWithSlippage(parseEther("1"), 100n))} ETH`);
  console.log("\nAll steps completed.");
}

main().catch((e) => {
  console.error(errorName(e) ?? e);
  process.exit(1);
});
