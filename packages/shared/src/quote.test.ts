import { describe, expect, it } from "vitest";
import {
  curveStatus,
  maxCostWithSlippage,
  minPayoutWithSlippage,
  previewBuyLocal,
  previewSellLocal,
  progressBps,
  tokensForBudget,
  type Curve,
} from "./quote";

const ADDR = "0x0000000000000000000000000000000000000001" as const;

// A fresh curve at a 0.05 ETH graduation: 1B tokens, vQ0 = G/3, vT0 = 16/15 of the supply, floor = 20%.
const SUPPLY = 10n ** 27n;
const curve: Curve = {
  quoteToken: ADDR,
  creator: ADDR,
  pair: ADDR,
  virtualTokenReserves: (SUPPLY * 16n) / 15n,
  virtualQuoteReserves: 50_000_000_000_000_000n / 3n,
  initialVirtualQuoteReserves: 50_000_000_000_000_000n / 3n,
  realTokenReserves: SUPPLY,
  realQuoteReserves: 0n,
  tokenTotalSupply: SUPPLY,
  floor: SUPPLY / 5n,
  creatorFeeBps: 0n,
  complete: false,
  migrated: false,
  launchTime: 0n,
  antiSniperWindow: 0,
};
const calm = { feeBps: 100n, taxBps: 0n };
const sniped = { feeBps: 100n, taxBps: 9800n };

describe("previewBuyLocal", () => {
  it("prices a buy and adds the fee on top of the curve price", () => {
    const { amountOut, quoteCost, fee, total } = previewBuyLocal(curve, calm, 10n ** 24n);
    expect(amountOut).toBe(10n ** 24n);
    expect(fee).toBe((quoteCost * 100n) / 10_000n);
    expect(total).toBe(quoteCost + fee);
  });

  it("clips the amount at the graduation floor: the last buy gets what is left, not what was asked for", () => {
    const nearlyDone = { ...curve, realTokenReserves: curve.floor + 10n ** 18n };
    expect(previewBuyLocal(nearlyDone, calm, 10n ** 27n).amountOut).toBe(10n ** 18n);
  });

  it("charges the launch tax as a share of what the buyer pays: 98% of the total at 9800 bps", () => {
    const base = previewBuyLocal(curve, calm, 10n ** 24n);
    const taxed = previewBuyLocal(curve, sniped, 10n ** 24n);
    expect(taxed.fee).toBeGreaterThan(base.fee * 40n);
    const taxPaid = taxed.fee - (taxed.quoteCost * 100n) / 10_000n;
    expect(Number((taxPaid * 10_000n) / taxed.total)).toBeGreaterThanOrEqual(9799);
  });

  it("charges nothing for nothing", () => {
    expect(previewBuyLocal(curve, calm, 0n).total).toBe(0n);
  });
});

describe("previewSellLocal", () => {
  it("takes the fee out of the proceeds and never taxes a sell", () => {
    const { quoteOut, fee, payout } = previewSellLocal(curve, 100n, 10n ** 24n);
    expect(fee).toBe((quoteOut * 100n) / 10_000n);
    expect(payout).toBe(quoteOut - fee);
  });

  it("pays no more than the buy cost of the same tokens: the curve rounds in its own favour", () => {
    const bought = previewBuyLocal(curve, { feeBps: 0n, taxBps: 0n }, 10n ** 24n);
    const after = {
      ...curve,
      virtualTokenReserves: curve.virtualTokenReserves - 10n ** 24n,
      virtualQuoteReserves: curve.virtualQuoteReserves + bought.quoteCost,
    };
    expect(previewSellLocal(after, 0n, 10n ** 24n).quoteOut).toBeLessThanOrEqual(bought.quoteCost);
  });
});

describe("tokensForBudget", () => {
  it("solves 'spend this much' into a token amount that fits the budget and is the largest that does", () => {
    const budget = 10n ** 16n; // 0.01 ETH
    const amount = tokensForBudget(curve, calm, budget);
    expect(previewBuyLocal(curve, calm, amount).total).toBeLessThanOrEqual(budget);
    expect(previewBuyLocal(curve, calm, amount + 1n).total).toBeGreaterThan(budget);
  });

  it("returns zero for a zero budget", () => {
    expect(tokensForBudget(curve, calm, 0n)).toBe(0n);
  });

  it("returns everything that is left when the budget covers the whole curve", () => {
    expect(tokensForBudget(curve, calm, 10n ** 21n)).toBe(curve.realTokenReserves - curve.floor);
  });

  it("buys far fewer tokens for the same budget inside the launch-tax window", () => {
    const budget = 10n ** 16n;
    expect(tokensForBudget(curve, sniped, budget) * 20n).toBeLessThan(tokensForBudget(curve, calm, budget));
  });
});

describe("slippage bounds", () => {
  it("lets a buy cost slightly more than quoted, and adds one wei so a zero slippage still clears the quote", () => {
    expect(maxCostWithSlippage(1_000_000n, 100n)).toBe(1_010_001n);
    expect(maxCostWithSlippage(1n, 0n)).toBeGreaterThan(1n);
  });

  it("lets a sell pay slightly less than quoted", () => {
    expect(minPayoutWithSlippage(1_000_000n, 100n)).toBe(990_000n);
  });
});

describe("progressBps and curveStatus", () => {
  it("is 0 on a fresh curve and 10000 once the sellable supply is gone", () => {
    expect(progressBps(curve)).toBe(0n);
    expect(progressBps({ ...curve, realTokenReserves: curve.floor })).toBe(10_000n);
  });

  it("names the three states", () => {
    expect(curveStatus(curve)).toBe("trading");
    expect(curveStatus({ ...curve, complete: true })).toBe("awaiting-migration");
    expect(curveStatus({ ...curve, complete: true, migrated: true })).toBe("migrated");
  });
});
