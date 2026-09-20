import { describe, expect, it } from "vitest";
import { formatCompactTokens, formatQuote, formatTokenPrice } from "./format.js";

describe("formatTokenPrice", () => {
  it("renders a launch price in scientific notation rather than a wall of zeros", () => {
    // 1.5624999e-11 ETH per token: the real opening price of a 0.05 ETH curve.
    expect(formatTokenPrice(15_624_999n, 18)).toBe("1.5625e-11");
  });

  it("drops trailing zeros from the mantissa", () => {
    expect(formatTokenPrice(15_000_000n, 18)).toBe("1.5e-11");
  });

  it("renders a normal-sized price as plain decimal", () => {
    expect(formatTokenPrice(2_500_000_000_000_000n, 18)).toBe("0.0025");
  });

  it("renders zero without notation", () => {
    expect(formatTokenPrice(0n, 18)).toBe("0");
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
