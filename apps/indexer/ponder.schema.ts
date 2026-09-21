import { index, onchainTable, primaryKey } from "ponder";

/** One row per launched token. Created by CreatePool, named by TokenCreated. */
export const token = onchainTable(
  "token",
  (t) => ({
    chainId: t.integer().notNull(),
    address: t.hex().notNull(),
    creator: t.hex().notNull(),
    quoteToken: t.hex().notNull(),
    antiSniperWindow: t.integer().notNull(), // 0, 60, 600 or 5880 seconds
    name: t.text(),
    ticker: t.text(),
    metadataURI: t.text(), // ipfs://… — hostile input, resolved and cached by the API
    createdAt: t.bigint().notNull(), // unix seconds
    // Latest curve state, taken from the last Trade event: no RPC call per trade.
    virtualQuoteReserves: t.bigint().notNull().default(0n),
    virtualTokenReserves: t.bigint().notNull().default(0n),
    progressBps: t.integer().notNull().default(0), // 0..10000 of the sellable 80%
    volumeQuote: t.bigint().notNull().default(0n),
    tradeCount: t.integer().notNull().default(0),
    complete: t.boolean().notNull().default(false),
    migrated: t.boolean().notNull().default(false),
    pair: t.hex(),
  }),
  (table) => ({
    // (chainId, address): the same address can exist on two chains. Changing a primary key later
    // means a full re-index, so it is paid for now while there is nothing to re-index.
    pk: primaryKey({ columns: [table.chainId, table.address] }),
    // One index per list sort in the API (spec §5.1). chainId leads because every query filters it.
    newIdx: index().on(table.chainId, table.createdAt),
    volumeIdx: index().on(table.chainId, table.volumeQuote),
    progressIdx: index().on(table.chainId, table.progressBps),
  }),
);

/** One row per buy or sell. The id is unique per log, so replays and reorgs never duplicate. */
export const trade = onchainTable(
  "trade",
  (t) => ({
    id: t.text().primaryKey(), // `${chainId}-${txHash}-${logIndex}`
    chainId: t.integer().notNull(),
    token: t.hex().notNull(),
    trader: t.hex().notNull(),
    isBuy: t.boolean().notNull(),
    quoteAmount: t.bigint().notNull(), // curve price, before fees
    tokenAmount: t.bigint().notNull(),
    fee: t.bigint().notNull(), // total fee including the launch tax
    launchTax: t.bigint().notNull(),
    // Curve reserves right after this trade: spot price = virtualQuote / virtualToken.
    virtualQuoteReserves: t.bigint().notNull(),
    virtualTokenReserves: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    // Order by (blockNumber, logIndex), never by (timestamp, id): every trade in a block shares a
    // timestamp, and id sorts by transaction hash, which is effectively random. Without this the
    // open and close of a candle are non-deterministic whenever a block holds two trades.
    logIndex: t.integer().notNull(),
  }),
  (table) => ({
    feedIdx: index().on(table.chainId, table.token, table.blockNumber, table.logIndex),
  }),
);

/** Token balances per holder, maintained from ERC20 Transfer events. */
export const balance = onchainTable(
  "balance",
  (t) => ({
    chainId: t.integer().notNull(),
    token: t.hex().notNull(),
    holder: t.hex().notNull(),
    amount: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.token, table.holder] }),
    topIdx: index().on(table.chainId, table.token, table.amount),
  }),
);
