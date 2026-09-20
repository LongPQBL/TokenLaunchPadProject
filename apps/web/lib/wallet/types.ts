import type { Address, Hash } from "viem";

/** Who signs. Groups C and D add "session" and "embedded"; the panels never look at this except to hide prompts. */
export type SignerKind = "self-custody" | "session" | "embedded";

export interface TradeCapabilities {
  kind: SignerKind;
  address: Address | undefined;
  chainId: number | undefined;
  /** True when approve+sell can be one prompt (EIP-5792) or needs none at all. */
  canBatch: boolean;
  /** True when a trade needs no user interaction. Only the session and embedded signers set this. */
  isZeroPrompt: boolean;
}

/** What a finished trade really was, read from the Trade event: the last buy on a curve is clipped, so never the request. */
export interface TradeResult {
  hash: Hash;
  tokenAmount: bigint;
  quoteAmount: bigint;
  fee: bigint;
  launchTax: bigint;
}

/** The four creation windows the contract accepts, in seconds of launch tax on buys. */
export type AntiSniperWindow = 0 | 60 | 600 | 5880;

export interface CreateTokenArgs {
  name: string;
  ticker: string;
  metadataURI: string;
  quoteToken: Address;
  antiSniperWindow: AntiSniperWindow;
}

export interface UseTrade {
  capabilities: TradeCapabilities;
  buyWithEth(args: { token: Address; amount: bigint; maxQuoteCost: bigint }): Promise<TradeResult>;
  sell(args: { token: Address; amount: bigint; minQuoteOutput: bigint }): Promise<TradeResult>;
  /** Makes sure the launchpad may take `amount` of the token; a no-op when the allowance already covers it. */
  approveIfNeeded(args: { token: Address; amount: bigint; exact?: boolean }): Promise<void>;
  createToken(args: CreateTokenArgs): Promise<{ token: Address; hash: Hash }>;
}

export type TradeErrorCode =
  | "not_configured"
  | "not_connected"
  | "wrong_chain"
  | "user_rejected"
  | "bad_amount"
  | "reverted"
  | "no_trade_event"
  | "no_created_event";

/**
 * Every failure of the seam. `user_rejected` is not a failure to show: the person said no, and the UI stays calm.
 * Anything else the wallet or the contract throws is kept as `cause` so the error mapper can read the revert name.
 */
export class TradeError extends Error {
  constructor(
    readonly code: TradeErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "TradeError";
  }
}
