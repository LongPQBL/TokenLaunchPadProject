// Exact off-chain replicas of the contract's price maths (CurveMath.sol), so the app can quote on every keystroke
// without an RPC call and can solve "I want to spend X ETH" (the contract only accepts a token amount).
//
// Ported unchanged from examples/evm-flow/src/quote.ts, which was checked against a live deployment to the wei. The
// integer rounding here is deliberate and mirrors the contract: do not "simplify" it. `pnpm verify:quote` re-checks
// it against a running deployment.

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

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Fee and launch-tax parameters that apply to a buy. Read tradeFeeBps() once and currentLaunchTaxBps(token) often. */
export interface BuyParams {
  feeBps: bigint;
  taxBps: bigint;
}

export function previewBuyLocal(c: Curve, p: BuyParams, amount: bigint) {
  const sellable = c.realTokenReserves - c.floor;
  const amountOut = amount > sellable ? sellable : amount; // the last buy is clipped at the graduation floor
  const newVirtualQuote = ceilDiv(c.virtualQuoteReserves * c.virtualTokenReserves, c.virtualTokenReserves - amountOut);
  const quoteCost = newVirtualQuote - c.virtualQuoteReserves; // rounds up: in favour of the curve
  const baseFee = (quoteCost * p.feeBps) / BPS;
  const subtotal = quoteCost + baseFee;
  const tax = p.taxBps === 0n ? 0n : ceilDiv(subtotal * p.taxBps, BPS - p.taxBps); // tax is a share of what you pay
  const fee = baseFee + tax;
  return { amountOut, quoteCost, fee, total: quoteCost + fee };
}

export function previewSellLocal(c: Curve, feeBps: bigint, amount: bigint) {
  const newVirtualQuote = ceilDiv(c.virtualQuoteReserves * c.virtualTokenReserves, c.virtualTokenReserves + amount);
  const quoteOut = c.virtualQuoteReserves - newVirtualQuote; // rounds down: in favour of the curve
  const fee = (quoteOut * feeBps) / BPS;
  return { quoteOut, fee, payout: quoteOut - fee }; // sells are never taxed
}

/** Largest token amount whose total price is <= budget ("spend 0.1 ETH"). Binary search on the exact replica. */
export function tokensForBudget(c: Curve, p: BuyParams, budget: bigint): bigint {
  let lo = 0n;
  let hi = c.realTokenReserves - c.floor;
  if (previewBuyLocal(c, p, hi).total <= budget) return hi; // the budget covers everything that is left
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (previewBuyLocal(c, p, mid).total <= budget) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

/** Buy: never send less than the quote. Add slippage headroom for other trades landing first. */
export const maxCostWithSlippage = (total: bigint, slippageBps: bigint) => (total * (BPS + slippageBps)) / BPS + 1n;

/** Sell: the minimum payout you accept. */
export const minPayoutWithSlippage = (payout: bigint, slippageBps: bigint) => (payout * (BPS - slippageBps)) / BPS;

/** Progress to graduation in basis points: share of the sellable supply (80%) already sold. */
export function progressBps(c: Curve): bigint {
  return ((c.tokenTotalSupply - c.realTokenReserves) * BPS) / (c.tokenTotalSupply - c.floor);
}

/** What the trade panel should offer. */
export function curveStatus(c: Curve): "trading" | "awaiting-migration" | "migrated" {
  if (c.migrated) return "migrated";
  return c.complete ? "awaiting-migration" : "trading";
}
