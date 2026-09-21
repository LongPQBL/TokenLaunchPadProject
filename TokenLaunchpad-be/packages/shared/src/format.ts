import { formatUnits } from "viem";

/** How many significant digits a price is shown with. Five is what tells 0.000000000015625 from 0.000000000015 apart at a glance. */
const PRICE_SIGNIFICANT_DIGITS = 5;

/**
 * A token price in quote per whole token, written out in plain decimals. These are tiny (a 0.05 ETH curve opens around
 * 0.000000000015625 ETH) and are shown with all their leading zeros rather than in scientific notation, which is what people
 * expect to see and can compare by eye. Rounded to the nearest at the fifth significant digit, in integers: a price with five
 * digits or fewer is shown exactly as it is. Display only: the number never goes back into any calculation.
 */
export function formatTokenPrice(rawQuotePerWholeToken: bigint, quoteDecimals: number): string {
  if (rawQuotePerWholeToken <= 0n) return "0";
  const digits = rawQuotePerWholeToken.toString().length;
  let shown = rawQuotePerWholeToken;
  if (digits > PRICE_SIGNIFICANT_DIGITS) {
    const unit = 10n ** BigInt(digits - PRICE_SIGNIFICANT_DIGITS);
    shown = ((rawQuotePerWholeToken + unit / 2n) / unit) * unit;
  }
  return trimZeros(formatUnits(shown, quoteDecimals));
}

/**
 * An exact quote amount. No rounding: this is money. With `maxFractionDigits` the fraction is
 * truncated, never rounded up, so a capped figure can only understate an amount, not overstate it.
 */
export function formatQuote(raw: bigint, quoteDecimals: number, maxFractionDigits?: number): string {
  const s = trimZeros(formatUnits(raw, quoteDecimals));
  if (maxFractionDigits === undefined) return s;
  const [whole, frac = ""] = s.split(".");
  return frac.length > maxFractionDigits ? trimZeros(`${whole}.${frac.slice(0, maxFractionDigits)}`) : s;
}

/**
 * A quote amount rounded to the NEAREST step, for values that are themselves approximate. formatQuote truncates, which
 * is right for money that moves: it can only understate. But the graduation target is derived from reserves and lands a
 * wei or two either side of a round number, and truncating would print 49999999999999999 wei as "0.0499" rather than
 * "0.05". Do not use this for an amount a person is about to pay or receive.
 */
export function formatQuoteApprox(raw: bigint, quoteDecimals: number, fractionDigits: number): string {
  const digits = Math.min(fractionDigits, quoteDecimals);
  const step = 10n ** BigInt(quoteDecimals - digits); // one unit at the chosen precision, in raw quote units
  const rounded = ((raw + step / 2n) / step) * step;
  return trimZeros(formatUnits(rounded, quoteDecimals));
}

/** Token amounts are always 18 decimals and always large; show them the way a trader reads them. */
export function formatCompactTokens(raw: bigint): string {
  const whole = raw / 10n ** 18n;
  const units: [bigint, string][] = [
    [1_000_000_000n, "B"],
    [1_000_000n, "M"],
    [1_000n, "K"],
  ];
  for (const [size, suffix] of units) {
    if (whole >= size) {
      const scaled = Number((whole * 10n) / size) / 10;
      return `${trimZeros(scaled.toFixed(1))}${suffix}`;
    }
  }
  return whole.toString();
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}
