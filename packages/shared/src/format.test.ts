import { describe, expect, it } from "vitest";
import { formatCompactTokens, formatQuote, formatQuoteApprox, formatTokenPrice } from "./format.js";

describe("formatTokenPrice", () => {
  it("writes a launch price out in plain decimals, never as 1.5e-11, with five significant digits", () => {
    // 1.5624999e-11 ETH per token: the real opening price of a 0.05 ETH curve.
    expect(formatTokenPrice(15_624_999n, 18)).toBe("0.000000000015625");
    expect(formatTokenPrice(15_625_000n, 18)).toBe("0.000000000015625");
  });

  it("drops trailing zeros", () => {
    expect(formatTokenPrice(15_000_000n, 18)).toBe("0.000000000015");
  });

  it("rounds to the nearest at the fifth significant digit, and carries into the next place when it has to", () => {
    expect(formatTokenPrice(26_984_976n, 18)).toBe("0.000000000026985");
    expect(formatTokenPrice(99_999_999n, 18)).toBe("0.0000000001");
  });

  it("renders a normal-sized price as plain decimal", () => {
    expect(formatTokenPrice(2_500_000_000_000_000n, 18)).toBe("0.0025");
    expect(formatTokenPrice(1_500_000_000_000_000_000n, 18)).toBe("1.5");
  });

  it("keeps a price that already has five digits or fewer exactly as it is", () => {
    expect(formatTokenPrice(12_345n, 18)).toBe("0.000000000000012345");
    expect(formatTokenPrice(1n, 18)).toBe("0.000000000000000001");
  });

  it("never uses an exponent, for any size of price", () => {
    for (const raw of [1n, 7n, 999n, 15_624_999n, 10n ** 17n, 10n ** 18n, 10n ** 30n + 12_345n]) expect(formatTokenPrice(raw, 18), String(raw)).not.toMatch(/e/i);
  });

  it("renders zero as zero", () => {
    expect(formatTokenPrice(0n, 18)).toBe("0");
  });

  it("works for a quote with other decimals (a 6-decimal stablecoin)", () => {
    expect(formatTokenPrice(1_234_567n, 6)).toBe("1.2346");
    expect(formatTokenPrice(15n, 6)).toBe("0.000015");
  });
});

describe("formatQuote", () => {
  it("keeps full precision for small amounts", () => {
    expect(formatQuote(156_396_621_832n, 18)).toBe("0.000000156396621832");
  });

  it("trims trailing zeros", () => {
    expect(formatQuote(50_000_000_000_000_000n, 18)).toBe("0.05");
  });

  it("handles a 6-decimal quote such as USDC", () => {
    expect(formatQuote(1_500_000n, 6)).toBe("1.5");
  });

  it("never turns a whole number into something else", () => {
    expect(formatQuote(10n * 10n ** 18n, 18)).toBe("10");
  });

  it("can cap the fraction digits without rounding up into a wrong figure", () => {
    expect(formatQuote(1_999_999_999_999_999_999n, 18, 4)).toBe("1.9999");
  });
});

// For amounts that are themselves approximate: the graduation target is derived from reserves and lands a wei or two
// either side of a round number. Truncating would print 49999999999999999 wei as 0.0499 instead of 0.05.
describe("formatQuoteApprox", () => {
  it("rounds to the nearest step, so a value a wei short of a round number reads as that round number", () => {
    expect(formatQuoteApprox(49_999_999_999_999_999n, 18, 4)).toBe("0.05");
    expect(formatQuoteApprox(50_000_000_000_000_001n, 18, 4)).toBe("0.05");
    expect(formatQuoteApprox(399_999_999_999_999_998n, 18, 4)).toBe("0.4");
  });

  it("rounds a genuinely fractional amount half up, not down", () => {
    expect(formatQuoteApprox(5_236_139_630_390_145n, 18, 4)).toBe("0.0052");
    expect(formatQuoteApprox(5_250_000_000_000_000n, 18, 3)).toBe("0.005");
    expect(formatQuoteApprox(5_500_000_000_000_000n, 18, 3)).toBe("0.006");
  });

  it("carries across the decimal point when the rounding rolls over", () => {
    expect(formatQuoteApprox(999_960_000_000_000_000n, 18, 4)).toBe("1");
    expect(formatQuoteApprox(1_999_990_000_000_000_000n, 18, 4)).toBe("2");
  });

  it("handles zero, whole numbers and a quote with fewer decimals", () => {
    expect(formatQuoteApprox(0n, 18, 4)).toBe("0");
    expect(formatQuoteApprox(3n * 10n ** 18n, 18, 4)).toBe("3");
    expect(formatQuoteApprox(1_499_999n, 6, 2)).toBe("1.5");
  });

  it("does not pretend to be more precise than the decimals the quote has", () => {
    expect(formatQuoteApprox(1_500_000n, 6, 10)).toBe("1.5");
  });
});

describe("formatCompactTokens", () => {
  it("abbreviates whole tokens", () => {
    expect(formatCompactTokens(799_500_000n * 10n ** 18n)).toBe("799.5M");
    expect(formatCompactTokens(1_000_000_000n * 10n ** 18n)).toBe("1B");
    expect(formatCompactTokens(12_000n * 10n ** 18n)).toBe("12K");
    expect(formatCompactTokens(999n * 10n ** 18n)).toBe("999");
  });

  it("shows zero for a dust amount below one whole token", () => {
    expect(formatCompactTokens(10n ** 17n)).toBe("0");
  });
});
