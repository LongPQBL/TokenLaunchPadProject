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

export const tokenPageSchema = z.object({ items: z.array(tokenListItemSchema), nextCursor: z.string().optional() });

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

export const holderSchema = z.object({ holder: z.string(), amount });
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

export type TokenListItem = z.output<typeof tokenListItemSchema>;
export type TokenPage = z.output<typeof tokenPageSchema>;
export type TokenDetail = z.output<typeof tokenDetailSchema>;
export type Trade = z.output<typeof tradeSchema>;
export type TradePage = z.output<typeof tradePageSchema>;
export type Holder = z.output<typeof holderSchema>;
export type Candle = z.output<typeof candleSchema>;
export type Comment = z.output<typeof commentSchema>;
export type Health = z.output<typeof healthSchema>;
export type Report = z.output<typeof reportSchema>;
export type CommentPage = z.output<typeof commentPageSchema>;

export const holdingListSchema = z.object({ items: z.array(z.object({ token: z.string(), amount })) });
