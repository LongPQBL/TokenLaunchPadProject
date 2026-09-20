import { formatUnits } from "viem";

/**
 * A token price in quote per whole token. These are tiny — a 0.05 ETH curve opens around
 * 1.5e-11 ETH — so below a threshold we switch to scientific notation rather than print
 * eleven leading zeros that nobody can compare at a glance.
 *
 * This is display only: the number never goes back into any calculation, so the float is fine.
 */
export function formatTokenPrice(rawQuotePerWholeToken: bigint, quoteDecimals: number): string {
  if (rawQuotePerWholeToken === 0n) return "0";
  const plain = formatUnits(rawQuotePerWholeToken, quoteDecimals);
  const asNumber = Number(plain);
  if (asNumber >= 1e-6) return trimZeros(plain);
  const [mantissa, exponent] = asNumber.toExponential(4).split("e");
  return `${trimZeros(mantissa!)}e${exponent}`;
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
