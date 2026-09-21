import { onchainTable, primaryKey } from "ponder";

/** One row per launched token. Created by the CreatePool event, completed by TokenCreated. */
export const token = onchainTable("token", (t) => ({
  address: t.hex().primaryKey(),
  creator: t.hex().notNull(),
  quoteToken: t.hex().notNull(),
  antiSniperWindow: t.integer().notNull(), // seconds: 0, 60, 600 or 5880
  name: t.text(),
  ticker: t.text(),
  metadataURI: t.text(), // ipfs://... (the backend resolves it to name/image/description)
  createdAt: t.bigint().notNull(), // unix seconds
  // Latest curve state, taken from the last Trade event (no RPC calls needed).
  virtualQuoteReserves: t.bigint().notNull().default(0n),
  virtualTokenReserves: t.bigint().notNull().default(0n),
  progressBps: t.integer().notNull().default(0), // 0..10000 share of the 80% sellable supply already sold
  volumeQuote: t.bigint().notNull().default(0n), // sum of Trade.quoteAmount
  tradeCount: t.integer().notNull().default(0),
  complete: t.boolean().notNull().default(false), // curve finished, waiting for migrate
  migrated: t.boolean().notNull().default(false),
  pair: t.hex(), // Uniswap V2 pool, set at migration
}));

/** One row per buy or sell. The id is unique per log, so replays and reorgs never create duplicates. */
export const trade = onchainTable("trade", (t) => ({
  id: t.text().primaryKey(), // `${txHash}-${logIndex}`
  token: t.hex().notNull(),
  trader: t.hex().notNull(),
  isBuy: t.boolean().notNull(),
  quoteAmount: t.bigint().notNull(), // curve price, before fees
  tokenAmount: t.bigint().notNull(),
  fee: t.bigint().notNull(), // total fee incl. launch tax
  launchTax: t.bigint().notNull(),
  // Curve reserves right after this trade: spot price after the trade = virtualQuote / virtualToken.
  virtualQuoteReserves: t.bigint().notNull(),
  virtualTokenReserves: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
  // Order trades by (blockNumber, logIndex), never by (timestamp, id): every trade in a block shares a
  // timestamp, and id sorts by transaction hash, which is effectively random. Without logIndex the open
  // and close of a candle are non-deterministic whenever a block holds more than one trade.
  blockNumber: t.bigint().notNull(),
  logIndex: t.integer().notNull(),
}));

/** Token balances per holder, maintained from ERC20 Transfer events. */
export const balance = onchainTable(
  "balance",
  (t) => ({
    token: t.hex().notNull(),
    holder: t.hex().notNull(),
    amount: t.bigint().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.token, table.holder] }) }),
);
