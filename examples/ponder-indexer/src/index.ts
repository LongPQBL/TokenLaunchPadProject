import { ponder } from "ponder:registry";
import { balance, token, trade } from "ponder:schema";
import { zeroAddress } from "viem";

const SUPPLY = 10n ** 27n; // every token has 1 billion tokens with 18 decimals
const INITIAL_VIRTUAL_TOKENS = (SUPPLY * 16n) / 15n; // virtual token reserve at launch (see contract reference)
const SELLABLE = (SUPPLY * 4n) / 5n; // 80% of the supply is sold on the curve, 20% goes to the DEX pool

// CreatePool is emitted by the launchpad first (same transaction), TokenCreated by the factory right after.
ponder.on("Launchpad:CreatePool", async ({ event, context }) => {
  await context.db.insert(token).values({
    address: event.args.mint,
    creator: event.args.creator,
    quoteToken: event.args.quoteToken,
    antiSniperWindow: event.args.antiSniperWindow,
    createdAt: event.block.timestamp,
  });
});

ponder.on("Factory:TokenCreated", async ({ event, context }) => {
  await context.db.update(token, { address: event.args.token }).set({
    name: event.args.name,
    ticker: event.args.ticker,
    metadataURI: event.args.metadataURI,
  });
});

ponder.on("Launchpad:Trade", async ({ event, context }) => {
  const a = event.args;
  await context.db.insert(trade).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
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
  // Tokens sold so far = initial virtual tokens - current virtual tokens, so progress needs no extra RPC call.
  const sold = INITIAL_VIRTUAL_TOKENS - a.virtualTokenReserves;
  await context.db.update(token, { address: a.mint }).set((row) => ({
    virtualQuoteReserves: a.virtualQuoteReserves,
    virtualTokenReserves: a.virtualTokenReserves,
    progressBps: Number((sold * 10_000n) / SELLABLE),
    volumeQuote: row.volumeQuote + a.quoteAmount,
    tradeCount: row.tradeCount + 1,
  }));
});

ponder.on("Launchpad:Complete", async ({ event, context }) => {
  await context.db.update(token, { address: event.args.mint }).set({ complete: true });
});

ponder.on("Launchpad:Migrated", async ({ event, context }) => {
  await context.db.update(token, { address: event.args.mint }).set({ migrated: true, pair: event.args.pair });
});

// Holder balances. Mint (from the zero address) does not subtract from anyone.
ponder.on("Token:Transfer", async ({ event, context }) => {
  const tokenAddress = event.log.address;
  const { from, to, value } = event.args;
  if (from !== zeroAddress) {
    await context.db
      .insert(balance)
      .values({ token: tokenAddress, holder: from, amount: -value })
      .onConflictDoUpdate((row) => ({ amount: row.amount - value }));
  }
  await context.db
    .insert(balance)
    .values({ token: tokenAddress, holder: to, amount: value })
    .onConflictDoUpdate((row) => ({ amount: row.amount + value }));
});
