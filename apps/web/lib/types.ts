export type { Candle, Comment, CommentPage, Health, Holder, Profile, Report, TokenDetail, TokenListItem, TokenPage, TokenRow, TokenStats, Trade, TradePage } from "./schemas";

export type TokenSort = "new" | "volume" | "progress" | "mcap" | "txns" | "volume24h" | "traders" | "change1h" | "change6h" | "change24h";
/** How discover draws its tokens: a table of numbers, or a grid of cards. */
export type DiscoverView = "table" | "grid";
