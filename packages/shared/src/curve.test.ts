import { describe, expect, it } from "vitest";
import { collectedQuote, graduationAmountFromReserves, marketCap, spotPrice, SUPPLY } from "./curve";

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const abs = (n: bigint) => (n < 0n ? -n : n);

// Captured from a live launchpad on a local Sepolia fork: a token part-way along its curve, read with getCurve().
// Its graduation amount is 0.05 ETH, so the contract's own initial virtual quote is a third of that.
const LIVE = {
  vt: 811_666_666_666_666_666_666_666_666n,
  vq: 21_902_806_297_056_811n,
  q0: 16_666_666_666_666_666n,
  realQuote: 5_236_139_630_390_145n,
};

describe("graduationAmountFromReserves", () => {
  it("recovers a live token's graduation amount from its reserves alone", () => {
    const truth = LIVE.q0 * 3n; // the contract sets Q0 = G / 3
    expect(abs(graduationAmountFromReserves(LIVE.vq, LIVE.vt) - truth)).toBeLessThanOrEqual(10n);
  });

  // The curve is constant-product with fees kept off it, so the product of the virtual reserves never moves. That is
  // what lets the target be read off any point on the curve without the API having to store it.
  it("gives the same answer at every point along the curve, for different graduation amounts", () => {
    for (const graduation of [50_000_000_000_000_000n, 400_000_000_000_000_000n]) {
      const q0 = graduation / 3n;
      const t0 = (SUPPLY * 16n) / 15n;
      const k = q0 * t0;
      for (const sold of [0n, 1n, SUPPLY / 100n, SUPPLY / 4n, SUPPLY / 2n, (SUPPLY * 4n) / 5n]) {
        const vt = t0 - sold;
        const vq = ceilDiv(k, vt);
        expect(abs(graduationAmountFromReserves(vq, vt) - graduation), `${graduation} at ${sold}`).toBeLessThanOrEqual(20n);
      }
    }
  });

  it("is zero rather than an error when a reserve is zero", () => {
    expect(graduationAmountFromReserves(0n, 1n)).toBe(0n);
    expect(graduationAmountFromReserves(1n, 0n)).toBe(0n);
  });
});

describe("collectedQuote", () => {
  it("matches the quote a live curve has really collected, to within a few wei", () => {
    expect(abs(collectedQuote(LIVE.vq, LIVE.vt) - LIVE.realQuote)).toBeLessThanOrEqual(10n);
  });

  it("is (almost) nothing at launch", () => {
    const t0 = (SUPPLY * 16n) / 15n;
    const q0 = 16_666_666_666_666_666n;
    expect(collectedQuote(q0, t0)).toBeLessThanOrEqual(10n);
  });

  it("never goes negative or past the target, whatever the reserves say", () => {
    // More virtual tokens than a curve ever launches with (16/15 of the supply): no real state, so it must clamp to 0.
    expect(collectedQuote(10n ** 16n, SUPPLY * 2n)).toBe(0n);
    // Fewer virtual tokens than the curve's floor, i.e. past graduation: what is collected is capped at the target
    // of those same reserves rather than overshooting it.
    const vq = 50_000_000_000_000_000n;
    const vt = SUPPLY / 10n;
    expect(collectedQuote(vq, vt)).toBe(graduationAmountFromReserves(vq, vt));
  });

  it("is zero when a reserve is zero", () => {
    expect(collectedQuote(0n, 0n)).toBe(0n);
  });
});

describe("spotPrice and marketCap", () => {
  it("is quote per whole token in raw units: the price the live chart's last candle showed", () => {
    expect(spotPrice(LIVE.vq, LIVE.vt)).toBe(26_984_976n);
  });

  it("is zero, not a division by zero, with no token reserve", () => {
    expect(spotPrice(5n, 0n)).toBe(0n);
    expect(marketCap(5n, 0n)).toBe(0n);
  });

  it("values the fully diluted supply of one billion tokens", () => {
    expect(marketCap(LIVE.vq, LIVE.vt)).toBe(spotPrice(LIVE.vq, LIVE.vt) * 1_000_000_000n);
  });
});
