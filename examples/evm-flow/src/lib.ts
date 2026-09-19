import { BaseError, ContractFunctionRevertedError, formatUnits } from "viem";

export const BPS = 10_000n;

/** The contract shape returned by getCurve(token). */
export interface Curve {
  quoteToken: `0x${string}`;
  creator: `0x${string}`;
  pair: `0x${string}`;
  virtualTokenReserves: bigint;
  virtualQuoteReserves: bigint;
  initialVirtualQuoteReserves: bigint;
  realTokenReserves: bigint;
  realQuoteReserves: bigint;
  tokenTotalSupply: bigint;
  floor: bigint;
  creatorFeeBps: bigint;
  complete: boolean;
  migrated: boolean;
  launchTime: bigint;
  antiSniperWindow: number;
}

/** Buy: never send less than the quote. Add slippage headroom for other trades landing first. */
export const maxCostWithSlippage = (total: bigint, slippageBps: bigint) => (total * (BPS + slippageBps)) / BPS + 1n;

/** Sell: the minimum payout you accept. */
export const minPayoutWithSlippage = (payout: bigint, slippageBps: bigint) => (payout * (BPS - slippageBps)) / BPS;

/** Spot price in quote per whole token (18 decimals), as a decimal string. */
export function spotPrice(c: Curve, quoteDecimals: number): string {
  const perWholeToken = (c.virtualQuoteReserves * 10n ** 18n) / c.virtualTokenReserves; // raw quote units
  return formatUnits(perWholeToken, quoteDecimals);
}

/** Progress to graduation in basis points: share of the sellable supply (80%) already sold. */
export function progressBps(c: Curve): bigint {
  return ((c.tokenTotalSupply - c.realTokenReserves) * BPS) / (c.tokenTotalSupply - c.floor);
}

/** Status the UI should show. */
export function status(c: Curve): "trading" | "awaiting-migration" | "migrated" {
  if (c.migrated) return "migrated";
  return c.complete ? "awaiting-migration" : "trading";
}

/** Name of the custom error a contract call reverted with, e.g. "SlippageExceeded". */
export function errorName(e: unknown): string | undefined {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName;
  }
  return undefined;
}
