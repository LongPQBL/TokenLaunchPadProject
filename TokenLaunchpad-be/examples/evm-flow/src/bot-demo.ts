import { maxUint256, parseEther } from "viem";
import { launchpadAbi } from "../../../abi/index.ts";
import { startMigrationBot } from "./bot.ts";
import { makeContext } from "./clients.ts";
import { createToken } from "./create.ts";
import { status, type Curve } from "./lib.ts";
import { buyWithEth } from "./trade.ts";

// Starts the bot, then completes a curve WITHOUT calling migrate, and waits for the bot to do it.
const ctx = makeContext();
const funder = ctx.wallet(Number(process.env.FUNDER_INDEX ?? 4));
const [creator, trader, botWallet] = [ctx.randomWallet(), ctx.randomWallet(), ctx.randomWallet()];
for (const w of [creator, trader, botWallet]) {
  await ctx.publicClient.waitForTransactionReceipt({ hash: await funder.sendTransaction({ to: w.account.address, value: parseEther("10") }) });
}
const stop = startMigrationBot(ctx, botWallet);
const { token } = await createToken(ctx, creator, {
  name: "Bot Demo", ticker: "BOT", metadataURI: "ipfs://x", quoteToken: ctx.deployment.weth, antiSniperWindow: 0,
});
await buyWithEth(ctx, trader, token, maxUint256, 100n);
console.log("curve completed; waiting for the bot...");
for (let i = 0; i < 30; i++) {
  const c = (await ctx.publicClient.readContract({ address: ctx.deployment.launchpad, abi: launchpadAbi, functionName: "getCurve", args: [token] })) as Curve;
  if (status(c) === "migrated") {
    console.log(`OK: the bot migrated the curve (status=${status(c)}, pair=${c.pair})`);
    stop();
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.error("bot did not migrate in 30 s");
process.exit(1);
