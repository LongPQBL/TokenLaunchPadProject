import { formatTokenPrice } from "./format";

/** A price feed's answer: how many USD one whole unit of the quote is worth, as an integer with `decimals` decimals (Chainlink: 8). */
export interface UsdRate {
  answer: bigint;
  decimals: number;
}

/** 10^(quote decimals + feed decimals - 2): what turns "quote raw units times the answer" into whole cents. */
const scale = (rate: UsdRate, quoteDecimals: number) => 10n ** BigInt(quoteDecimals + rate.decimals - 2);

/**
 * How much of the quote (raw units) a number of US cents is worth, cut and never rounded up, so a person who types $2 is never
 * asked for more than $2. A broken price (zero or negative) is worth nothing: no division by it.
 */
export function usdToQuote(cents: bigint, rate: UsdRate, quoteDecimals = 18): bigint {
  if (rate.answer <= 0n || cents <= 0n) return 0n;
  return (cents * scale(rate, quoteDecimals)) / rate.answer;
}

/** What an amount of the quote (raw units) is worth in whole US cents, cut below a cent. Zero for a broken price. */
export function quoteToUsdCents(raw: bigint, rate: UsdRate, quoteDecimals = 18): bigint {
  if (rate.answer <= 0n || raw <= 0n) return 0n;
  return (raw * rate.answer) / scale(rate, quoteDecimals);
}

/** "$1,234.56". In integers, so a big number is not lost to floating point. */
export function formatUsd(cents: bigint): string {
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${whole}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** Dollars typed in, as whole cents: "2", "2.5", "$1,234.56". A third decimal, a sign, text or nothing is not money: undefined. */
export function parseUsd(text: string): bigint | undefined {
  const t = text.trim().replace(/^\$/, "");
  if (!/^(\d{1,3}(,\d{3})+|\d+)?(\.\d{0,2})?$/.test(t) || t === "" || t === ".") return undefined;
  const [whole = "", frac = ""] = t.replace(/,/g, "").split(".");
  return BigInt(whole || "0") * 100n + BigInt(frac.padEnd(2, "0") || "0");
}

/** Cents as they are typed into a box: "3", "2.5", "0.05". The reverse of `parseUsd`. */
export function centsToText(cents: bigint): string {
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, "0").replace(/0$/, "");
  return frac === "" || frac === "0" ? whole.toString() : `${whole}.${frac}`;
}

const COMPACT_UNITS: [bigint, string][] = [
  [10n ** 12n, "T"],
  [10n ** 9n, "B"],
  [10n ** 6n, "M"],
  [10n ** 3n, "K"],
];

/**
 * Dollars for a table cell: "$47.23" up to a thousand, then "$12.3K", "$266.98K", "$13.73M", "$42B". At most two decimals, no trailing
 * zeros, cut and never rounded up (a figure can only understate). In integers, so a huge number is not lost to floating point.
 */
export function formatUsdCompact(cents: bigint): string {
  if (cents < 0n) return `-${formatUsdCompact(-cents)}`;
  const dollars = cents / 100n;
  if (dollars < 1_000n) return formatUsd(cents);
  const [size, suffix] = COMPACT_UNITS.find(([unit]) => dollars >= unit)!;
  const hundredths = (dollars * 100n) / size;
  const frac = (hundredths % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return `$${(hundredths / 100n).toString()}${frac ? `.${frac}` : ""}${suffix}`;
}

/** A quote amount (raw units) as dollars at the feed's price. Worth something but less than a cent reads "<$0.01", never "$0.00". */
export function formatUsdValue(raw: bigint, rate: UsdRate, quoteDecimals = 18, opts: { compact?: boolean } = {}): string {
  const cents = quoteToUsdCents(raw, rate, quoteDecimals);
  if (raw > 0n && cents === 0n) return "<$0.01";
  return opts.compact ? formatUsdCompact(cents) : formatUsd(cents);
}

/** A gain or a loss in dollars, with its sign: "+$30.00", "-$30.00". Nothing is "$0.00"; a sliver keeps its sign: "+<$0.01". */
export function formatSignedUsdValue(raw: bigint, rate: UsdRate, quoteDecimals = 18, opts: { compact?: boolean } = {}): string {
  if (raw === 0n) return "$0.00";
  const magnitude = formatUsdValue(raw < 0n ? -raw : raw, rate, quoteDecimals, opts);
  return magnitude === "$0.00" ? "$0.00" : `${raw < 0n ? "-" : "+"}${magnitude}`;
}

/**
 * A token's price in dollars, out in full with five significant digits, as for a price in the quote: it is a fraction of a cent
 * ("$0.000000046875"), and an exponent is hard to read. `priceRaw` is quote per WHOLE token, in raw quote units.
 */
export function formatUsdPrice(priceRaw: bigint, rate: UsdRate, quoteDecimals = 18): string {
  if (rate.answer <= 0n || priceRaw <= 0n) return "$0";
  return `$${formatTokenPrice(priceRaw * rate.answer, quoteDecimals + rate.decimals)}`;
}
