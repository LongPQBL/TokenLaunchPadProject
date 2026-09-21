import { loadDeployment } from "@vezta/deployments";
import { ponder } from "ponder:registry";
import { balance, token, trade } from "ponder:schema";
import { zeroAddress } from "viem";

const d = loadDeployment();
const CHAIN_ID = d.chainId;

const SUPPLY = 10n ** 27n; // 1 billion tokens, 18 decimals
const INITIAL_VIRTUAL_TOKENS = (SUPPLY * 16n) / 15n; // virtual token reserve at launch
const SELLABLE = (SUPPLY * 4n) / 5n; // the curve sells 80%; 20% seeds the DEX pool

// Addresses that hold a balance but are not holders: the curve's unsold supply and the burn
// address that receives the LP tokens. Without this the top holder is always a contract. The
// token's pair is excluded at query time, because it is only known after migration.
const NOT_A_HOLDER = new Set([d.launchpad.toLowerCase(), "0x000000000000000000000000000000000000dead"]);

// CreatePool is emitted by the launchpad first; TokenCreated follows in the same transaction.
ponder.on("Launchpad:CreatePool", async ({ event, context }) => {
  // A curve is created with reserves of its own (they set the launch price), and no event says what they are until the first Trade.
  // Read them here, or a token nobody has bought yet is stored with reserves of 0 and shows a price and a market cap of 0.
  const curve = await context.client.readContract({
    abi: context.contracts.Launchpad.abi,
    address: context.contracts.Launchpad.address,
    functionName: "getCurve",
    args: [event.args.mint],
  });
  await context.db.insert(token).values({
    chainId: CHAIN_ID,
    address: event.args.mint,
    creator: event.args.creator,
    quoteToken: event.args.quoteToken,
    antiSniperWindow: event.args.antiSniperWindow,
    createdAt: event.block.timestamp,
    virtualQuoteReserves: curve.virtualQuoteReserves,
    virtualTokenReserves: curve.virtualTokenReserves,
  });
});

ponder.on("Factory:TokenCreated", async ({ event, context }) => {
  await context.db.update(token, { chainId: CHAIN_ID, address: event.args.token }).set({
    name: event.args.name,
    ticker: event.args.ticker,
    metadataURI: event.args.metadataURI,
  });
});

ponder.on("Launchpad:Trade", async ({ event, context }) => {
  const a = event.args;
  await context.db.insert(trade).values({
    id: `${CHAIN_ID}-${event.transaction.hash}-${event.log.logIndex}`,
    chainId: CHAIN_ID,
    token: a.mint,
    trader: a.user,
    isBuy: a.isBuy,
    quoteAmount: a.quoteAmount,
    tokenAmount: a.tokenAmount,
    fee: a.fee,
    launchTax: a.launchTax,
    virtualQuoteReserves: a.virtualQuoteReserves,
    virtualTokenReserves: a.virtualTokenReserves,
    timestamp: a.timestamp,
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
  });
  // Tokens sold = initial virtual tokens - current, so progress needs no extra RPC call.
  const sold = INITIAL_VIRTUAL_TOKENS - a.virtualTokenReserves;
  await context.db.update(token, { chainId: CHAIN_ID, address: a.mint }).set((row) => ({
    virtualQuoteReserves: a.virtualQuoteReserves,
    virtualTokenReserves: a.virtualTokenReserves,
    progressBps: Number((sold * 10_000n) / SELLABLE),
    volumeQuote: row.volumeQuote + a.quoteAmount,
    tradeCount: row.tradeCount + 1,
  }));
});

ponder.on("Launchpad:Complete", async ({ event, context }) => {
  await context.db.update(token, { chainId: CHAIN_ID, address: event.args.mint }).set({ complete: true });
});

ponder.on("Launchpad:Migrated", async ({ event, context }) => {
  await context.db
    .update(token, { chainId: CHAIN_ID, address: event.args.mint })
    .set({ migrated: true, pair: event.args.pair });
});

// Holder balances. A mint comes from the zero address and subtracts from nobody.
ponder.on("Token:Transfer", async ({ event, context }) => {
  const tokenAddress = event.log.address;
  const { from, to, value } = event.args;
  if (from !== zeroAddress && !NOT_A_HOLDER.has(from.toLowerCase())) {
    await context.db
      .insert(balance)
      .values({ chainId: CHAIN_ID, token: tokenAddress, holder: from, amount: -value })
      .onConflictDoUpdate((row) => ({ amount: row.amount - value }));
  }
  if (!NOT_A_HOLDER.has(to.toLowerCase())) {
    await context.db
      .insert(balance)
      .values({ chainId: CHAIN_ID, token: tokenAddress, holder: to, amount: value })
      .onConflictDoUpdate((row) => ({ amount: row.amount + value }));
  }
});
