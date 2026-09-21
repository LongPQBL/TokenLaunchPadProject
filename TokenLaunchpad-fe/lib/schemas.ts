import { z } from "zod";

/**
 * uint256 does not fit a JavaScript number, so the API sends every amount as a decimal string. It becomes a bigint
 * here, once, and no component ever sees the string. The pattern is strict on purpose: "1e18", "-5" or "12.5" would
 * otherwise reach BigInt() and either throw or quietly mean something else.
 */
const amount = z
  .string()
  .regex(/^\d+$/, "expected a non-negative integer string")
  .transform((s) => BigInt(s));

/** A price: raw quote units per whole token. It carries a fraction, so it stays a string until it is drawn. */
const decimal = z.string().regex(/^\d+(\.\d+)?$/, "expected a plain decimal string");

export const tokenListItemSchema = z.object({
  address: z.string(),
  creator: z.string(),
  name: z.string().optional(),
  ticker: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  progressBps: z.number().int(),
  volumeQuote: amount,
  tradeCount: z.number().int(),
  complete: z.boolean(),
  migrated: z.boolean(),
  createdAt: amount,
});

/** What a table row shows besides the token, worked out by the API from its trades. Amounts are in the quote's raw units. */
export const tokenStatsSchema = z.object({
  marketCap: amount,
  athMarketCap: amount,
  volume24h: amount,
  traders24h: z.number().int().nonnegative(),
  /** Basis points, and negative when the price has fallen. */
  change1hBps: z.number().int(),
  change6hBps: z.number().int(),
  change24hBps: z.number().int(),
});

/** A token as a list of them serves it. Optional here (a row the socket made has no numbers yet); the API always sends them. */
export const tokenRowSchema = tokenListItemSchema.extend({ stats: tokenStatsSchema.optional() });

export const tokenPageSchema = z.object({ items: z.array(tokenRowSchema), nextCursor: z.string().optional() });

export const tokenDetailSchema = tokenListItemSchema.extend({
  quoteToken: z.string(),
  antiSniperWindow: z.number().int(),
  virtualQuoteReserves: amount,
  virtualTokenReserves: amount,
  pair: z.string().optional(),
  metadataStatus: z.enum(["ok", "pending", "invalid"]),
  socials: z.record(z.string(), z.string()).default({}),
});

export const tradeSchema = z.object({
  id: z.string(),
  trader: z.string(),
  isBuy: z.boolean(),
  quoteAmount: amount,
  tokenAmount: amount,
  fee: amount,
  launchTax: amount,
  virtualQuoteReserves: amount,
  virtualTokenReserves: amount,
  timestamp: amount,
  blockNumber: amount,
  logIndex: z.number().int(),
});

export const tradePageSchema = z.object({ items: z.array(tradeSchema), nextCursor: z.string().optional() });

/** The two things the API sends about a token that is only being named in a list. */
const tokenBriefSchema = z.object({ address: z.string(), name: z.string().optional(), ticker: z.string().optional(), imageUrl: z.string().optional() });

const signed = z
  .string()
  .regex(/^-?\d+$/, "expected an integer string")
  .transform((s) => BigInt(s));

/** A token an address holds now, with what it cost and what it is worth. `pnlBps` is null when nothing was spent on it. */
export const positionSchema = z.object({
  token: tokenBriefSchema,
  balance: amount,
  spent: amount,
  received: amount,
  buys: z.number().int().nonnegative(),
  sells: z.number().int().nonnegative(),
  value: amount,
  pnl: signed,
  pnlBps: z.number().int().nullable(),
});
export const positionListSchema = z.object({ items: z.array(positionSchema) });

/** One trade an address made, on any token. */
export const orderSchema = z.object({
  id: z.string(),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  token: tokenBriefSchema,
  isBuy: z.boolean(),
  quoteAmount: amount,
  fee: amount,
  total: signed,
  tokenAmount: amount,
  price: amount,
  timestamp: amount,
  blockNumber: amount,
  logIndex: z.number().int().nonnegative(),
});
export const orderPageSchema = z.object({ items: z.array(orderSchema), nextCursor: z.string().optional() });

/** A holder of a token, with what their tokens are worth now and what they have made on them (`pnl`, negative for a loss). */
export const holderSchema = z.object({
  holder: z.string(),
  amount,
  spent: amount,
  received: amount,
  value: amount,
  pnl: signed,
  username: z.string().optional(),
  avatarUrl: z.string().optional(),
});
export const holderListSchema = z.object({ items: z.array(holderSchema) });

export const candleSchema = z.object({
  time: z.number().int(),
  open: decimal,
  high: decimal,
  low: decimal,
  close: decimal,
  volume: amount,
});
export const candleListSchema = z.object({ items: z.array(candleSchema) });

/** A comment as the API serves it. Its text and name are hostile input: they are checked for shape here and drawn as text. */
export const commentSchema = z.object({
  id: z.string().regex(/^\d+$/),
  author: z.string(),
  username: z.string().optional(),
  avatarUrl: z.string().optional(),
  body: z.string(),
  createdAt: amount,
});
export const commentPageSchema = z.object({ items: z.array(commentSchema), nextCursor: z.string().optional() });

/** The admin page's health report. Figures from outside the database are null when unknown: never read null as zero. */
export const healthSchema = z.object({
  indexerLagBlocks: z.number().int().nonnegative().nullable(),
  watcherAliveSince: amount.nullable(),
  botAddress: z.string().nullable(),
  botBalance: amount.nullable(),
  failedMetadataCount: z.number().int().nonnegative(),
  stuckTokens: z.array(z.object({ address: z.string(), name: z.string().optional(), ticker: z.string().optional(), completeSince: amount })),
});

/** A report as a moderator sees it. The reason is a stranger's text: it is drawn as text. */
export const reportSchema = z.object({
  id: z.string().regex(/^\d+$/),
  token: z.string(),
  name: z.string().optional(),
  ticker: z.string().optional(),
  reporter: z.string(),
  reason: z.string(),
  createdAt: amount,
  hidden: z.boolean(),
});
export const reportListSchema = z.object({ items: z.array(reportSchema) });

/** What an address made and holds, and who it is if they have said so. Names and pictures are strangers' input. */
export const profileSchema = z.object({
  created: z.array(tokenListItemSchema),
  holdings: z.array(z.object({ token: tokenListItemSchema, amount })),
  user: z.object({ username: z.string().optional(), avatarUrl: z.string().optional() }).optional(),
});

export type TokenListItem = z.output<typeof tokenListItemSchema>;
export type TokenStats = z.output<typeof tokenStatsSchema>;
export type Position = z.output<typeof positionSchema>;
export type Order = z.output<typeof orderSchema>;
export type TokenRow = z.output<typeof tokenRowSchema>;
export type TokenPage = z.output<typeof tokenPageSchema>;
export type TokenDetail = z.output<typeof tokenDetailSchema>;
export type Trade = z.output<typeof tradeSchema>;
export type TradePage = z.output<typeof tradePageSchema>;
export type Holder = z.output<typeof holderSchema>;
export type Candle = z.output<typeof candleSchema>;
export type Comment = z.output<typeof commentSchema>;
export type Health = z.output<typeof healthSchema>;
export type Profile = z.output<typeof profileSchema>;
export type Report = z.output<typeof reportSchema>;
export type CommentPage = z.output<typeof commentPageSchema>;

export const holdingListSchema = z.object({ items: z.array(z.object({ token: z.string(), amount })) });
