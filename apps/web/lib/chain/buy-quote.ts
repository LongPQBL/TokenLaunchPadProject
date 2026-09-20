import { BPS, previewBuyLocal, tokensForBudget, type Curve } from "@vezta/shared";

export interface BuyQuote {
  /** Tokens the budget buys. On the last buy this is fewer than a bigger budget asked for: the curve clips it. */
  amount: bigint;
  /** The curve price, before any fee. */
  quoteCost: bigint;
  /** The ordinary trading fee. */
  baseFee: bigint;
  /** The launch tax, inside the anti-sniper window; zero after it. */
  launchTax: bigint;
  /** What the buyer pays in all. */
  total: bigint;
  /** total / (price + ordinary fee): how many times the launch tax multiplies the cost. 1 outside the window. */
  taxMultiplier: number;
}

/**
 * "I want to spend this much" -> everything the panel shows, worked out locally, so it can update on every keystroke.
 * The replica is the one checked against the contract to the wei; this only splits its fee into the ordinary fee and
 * the tax, which the replica reports together.
 */
export function computeBuyQuote(curve: Curve, feeBps: bigint, taxBps: bigint, budget: bigint): BuyQuote {
  const params = { feeBps, taxBps };
  const amount = budget > 0n ? tokensForBudget(curve, params, budget) : 0n;
  if (amount === 0n) return { amount: 0n, quoteCost: 0n, baseFee: 0n, launchTax: 0n, total: 0n, taxMultiplier: 1 };

  const { quoteCost, fee, total } = previewBuyLocal(curve, params, amount);
  const baseFee = (quoteCost * feeBps) / BPS;
  const subtotal = quoteCost + baseFee;
  return {
    amount,
    quoteCost,
    baseFee,
    launchTax: fee - baseFee,
    total,
    taxMultiplier: subtotal === 0n ? 1 : Number((total * 1000n) / subtotal) / 1000,
  };
}
