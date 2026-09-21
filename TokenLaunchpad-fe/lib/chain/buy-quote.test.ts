import { previewBuyLocal } from "@vezta/shared";
import { describe, expect, it } from "vitest";
import { freshCurve } from "@/test/fake-chain";
import { computeBuyQuote } from "./buy-quote";

const curve = freshCurve();

describe("computeBuyQuote", () => {
  it("turns a budget into the tokens it buys, itemised, and never asks for more than the budget", () => {
    const budget = 10n ** 16n;
    const q = computeBuyQuote(curve, 100n, 0n, budget);
    expect(q.total).toBeLessThanOrEqual(budget);
    expect(q.total).toBe(q.quoteCost + q.baseFee + q.launchTax);
    expect(q.amount).toBeGreaterThan(0n);
    expect(q.launchTax).toBe(0n);
    expect(q.taxMultiplier).toBe(1);
  });

  it("separates the launch tax from the ordinary fee", () => {
    const q = computeBuyQuote(curve, 100n, 9800n, 10n ** 16n);
    expect(q.baseFee).toBe((q.quoteCost * 100n) / 10_000n);
    expect(q.launchTax).toBeGreaterThan(q.quoteCost * 40n);
  });

  it("states the multiplier a buyer pays over the price: about 50x at 98% tax", () => {
    const q = computeBuyQuote(curve, 100n, 9800n, 10n ** 16n);
    expect(q.taxMultiplier).toBeGreaterThan(49);
    expect(q.taxMultiplier).toBeLessThan(51);
  });

  it("agrees with the contract replica for the tokens it chose", () => {
    const q = computeBuyQuote(curve, 100n, 300n, 10n ** 16n);
    const replica = previewBuyLocal(curve, { feeBps: 100n, taxBps: 300n }, q.amount);
    expect(q.total).toBe(replica.total);
    expect(q.quoteCost).toBe(replica.quoteCost);
  });

  it("is all zeros for a zero budget, with no division by zero", () => {
    const q = computeBuyQuote(curve, 100n, 9800n, 0n);
    expect(q).toMatchObject({ amount: 0n, quoteCost: 0n, baseFee: 0n, launchTax: 0n, total: 0n, taxMultiplier: 1 });
  });

  it("clips at the end of the curve: a huge budget buys what is left, and the total is what that costs", () => {
    const q = computeBuyQuote(curve, 100n, 0n, 10n ** 21n);
    expect(q.amount).toBe(curve.realTokenReserves - curve.floor);
    expect(q.total).toBeLessThan(10n ** 21n);
  });
});
