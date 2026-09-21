import { describe, expect, it } from "vitest";
import { centsToText, formatSignedUsdValue, formatUsd, formatUsdCompact, formatUsdPrice, formatUsdValue, parseUsd, quoteToUsdCents, usdToQuote, type UsdRate } from "./usd.js";

/** $3,000 per ETH, as a Chainlink feed says it: eight decimals. */
const RATE: UsdRate = { answer: 3_000n * 10n ** 8n, decimals: 8 };
const ETH = 10n ** 18n;

describe("usdToQuote", () => {
  it("turns dollars into wei at the feed's price", () => {
    expect(usdToQuote(300_000n, RATE)).toBe(ETH); // $3,000
    expect(usdToQuote(150_000n, RATE)).toBe(ETH / 2n);
    expect(usdToQuote(200n, RATE)).toBe(666_666_666_666_666n); // $2, cut (never rounded up)
  });

  it("is zero for nothing, and for a broken price rather than a division by zero", () => {
    expect(usdToQuote(0n, RATE)).toBe(0n);
    expect(usdToQuote(200n, { answer: 0n, decimals: 8 })).toBe(0n);
    expect(usdToQuote(200n, { answer: -5n, decimals: 8 })).toBe(0n);
  });

  it("follows the feed's own decimals, not an assumed eight", () => {
    expect(usdToQuote(300_000n, { answer: 3_000n * 10n ** 18n, decimals: 18 })).toBe(ETH);
  });

  it("follows the quote's decimals (a 6-decimal stablecoin quote)", () => {
    expect(usdToQuote(1_000n, { answer: 10n ** 8n, decimals: 8 }, 6)).toBe(10_000_000n); // $10 at $1 = 10 units
  });
});

describe("quoteToUsdCents", () => {
  it("turns wei into whole cents at the feed's price, cutting below a cent", () => {
    expect(quoteToUsdCents(ETH, RATE)).toBe(300_000n);
    expect(quoteToUsdCents(ETH / 3n, RATE)).toBe(99_999n); // $999.99, not $1,000.00
    expect(quoteToUsdCents(1n, RATE)).toBe(0n);
  });

  it("is zero for a broken price", () => {
    expect(quoteToUsdCents(ETH, { answer: 0n, decimals: 8 })).toBe(0n);
  });

  it("is the reverse of usdToQuote, to within a cent", () => {
    for (const cents of [1n, 199n, 200n, 12_345n, 99_999_999n]) {
      const back = quoteToUsdCents(usdToQuote(cents, RATE), RATE);
      expect(back <= cents && cents - back <= 1n, String(cents)).toBe(true);
    }
  });
});

describe("formatUsd", () => {
  it("writes dollars with two decimals and thousands separators", () => {
    expect(formatUsd(0n)).toBe("$0.00");
    expect(formatUsd(5n)).toBe("$0.05");
    expect(formatUsd(200n)).toBe("$2.00");
    expect(formatUsd(123_456_789n)).toBe("$1,234,567.89");
  });

  it("does not lose a big number to floating point", () => {
    expect(formatUsd(10n ** 20n + 1n)).toBe("$1,000,000,000,000,000,000.01");
  });
});

describe("parseUsd", () => {
  it("reads dollars typed in, with or without a dollar sign, a comma, or cents", () => {
    expect(parseUsd("2")).toBe(200n);
    expect(parseUsd("2.5")).toBe(250n);
    expect(parseUsd("0.05")).toBe(5n);
    expect(parseUsd(".5")).toBe(50n);
    expect(parseUsd("$1,234.56")).toBe(123_456n);
    expect(parseUsd("  7  ")).toBe(700n);
  });

  it("refuses what is not money: a third decimal, a minus, text, or nothing", () => {
    for (const bad of ["", "abc", "1.234", "-5", "1e3", "1.2.3", "$", ".", "1,2,3x"]) expect(parseUsd(bad), bad).toBeUndefined();
  });
});

describe("centsToText", () => {
  it("writes cents the way they are typed: no dollar sign, no separators, no trailing zeros", () => {
    expect(centsToText(0n)).toBe("0");
    expect(centsToText(300n)).toBe("3");
    expect(centsToText(250n)).toBe("2.5");
    expect(centsToText(205n)).toBe("2.05");
    expect(centsToText(5n)).toBe("0.05");
    expect(centsToText(123_456_789n)).toBe("1234567.89");
  });

  it("reads back through parseUsd to the same cents", () => {
    for (const cents of [0n, 1n, 5n, 99n, 100n, 250n, 123_456_789n]) expect(parseUsd(centsToText(cents)), String(cents)).toBe(cents);
  });
});

describe("formatUsdCompact", () => {
  it("writes small amounts in full and big ones with K, M, B and T, at most two decimals, no trailing zeros, cut and never rounded up", () => {
    expect(formatUsdCompact(0n)).toBe("$0.00");
    expect(formatUsdCompact(4_723n)).toBe("$47.23");
    expect(formatUsdCompact(99_999n)).toBe("$999.99");
    expect(formatUsdCompact(100_000n)).toBe("$1K");
    expect(formatUsdCompact(1_230_000n)).toBe("$12.3K");
    expect(formatUsdCompact(26_698_000n)).toBe("$266.98K");
    expect(formatUsdCompact(26_698_999n)).toBe("$266.98K");
    expect(formatUsdCompact(38_700_000n)).toBe("$387K");
    expect(formatUsdCompact(1_373_000_000n)).toBe("$13.73M");
    expect(formatUsdCompact(4_200_000_000_000n)).toBe("$42B");
    expect(formatUsdCompact(5_000_000_000_000_00n)).toBe("$5T");
  });

  it("keeps a sign on a negative amount", () => {
    expect(formatUsdCompact(-4_723n)).toBe("-$47.23");
    expect(formatUsdCompact(-1_230_000n)).toBe("-$12.3K");
  });

  it("does not lose a huge number to floating point", () => {
    expect(formatUsdCompact(10n ** 30n)).toBe("$10000000000000000T");
  });
});

describe("formatUsdValue", () => {
  it("turns wei into dollars at the feed's price, exact or compact", () => {
    expect(formatUsdValue(ETH / 100n, RATE)).toBe("$30.00");
    expect(formatUsdValue(ETH * 1_000n, RATE, 18, { compact: true })).toBe("$3M");
    expect(formatUsdValue(ETH / 100n, RATE, 18, { compact: true })).toBe("$30.00");
  });

  it("says less than a cent, rather than $0.00, for something that is worth something but not a cent", () => {
    expect(formatUsdValue(1_000_000n, RATE)).toBe("<$0.01");
    expect(formatUsdValue(0n, RATE)).toBe("$0.00");
  });
});

describe("formatSignedUsdValue", () => {
  it("shows a gain with a plus and a loss with a minus", () => {
    expect(formatSignedUsdValue(ETH / 100n, RATE)).toBe("+$30.00");
    expect(formatSignedUsdValue(-ETH / 100n, RATE)).toBe("-$30.00");
    expect(formatSignedUsdValue(ETH * 1_000n, RATE, 18, { compact: true })).toBe("+$3M");
  });

  it("shows nothing as a plain $0.00 with no sign, and a sliver as less than a cent with its sign", () => {
    expect(formatSignedUsdValue(0n, RATE)).toBe("$0.00");
    expect(formatSignedUsdValue(1_000_000n, RATE)).toBe("+<$0.01");
    expect(formatSignedUsdValue(-1_000_000n, RATE)).toBe("-<$0.01");
  });
});

describe("formatUsdPrice", () => {
  it("writes a token's price in dollars out in full, with five significant digits: it is a fraction of a cent", () => {
    // 15,625,000 wei per token = 1.5625e-11 ETH, at $3,000 a coin = $0.000000046875
    expect(formatUsdPrice(15_625_000n, RATE)).toBe("$0.000000046875");
  });

  it("writes an ordinary price plainly", () => {
    expect(formatUsdPrice(ETH / 1_000n, RATE)).toBe("$3");
    expect(formatUsdPrice(ETH / 7n, RATE)).toBe("$428.57");
  });

  it("is $0 for no price, and never uses an exponent", () => {
    expect(formatUsdPrice(0n, RATE)).toBe("$0");
    for (const raw of [1n, 999n, 15_625_000n, 10n ** 30n]) expect(formatUsdPrice(raw, RATE), String(raw)).not.toMatch(/e/i);
  });

  it("is $0 for a broken price rather than dividing by it", () => {
    expect(formatUsdPrice(15_625_000n, { answer: 0n, decimals: 8 })).toBe("$0");
  });
});
