/** Every token has exactly one billion tokens with 18 decimals (contract reference, "Units"). */
export const SUPPLY = 10n ** 27n;
const WHOLE_TOKEN = 10n ** 18n;
const WHOLE_TOKENS_IN_SUPPLY = 1_000_000_000n;

/**
 * The quote a curve graduates at, worked out from its reserves alone.
 *
 * The curve is constant-product over the VIRTUAL reserves, and fees never enter it, so vQ * vT is the same at every
 * point along it. It starts at vQ0 = G/3 and vT0 = 16/15 of the supply, so the product is (G/3)(16/15)S at all
 * times, which gives G = 45 * vQ * vT / (16 * S) from wherever the curve happens to be. That is what lets the app
 * show "0.039 / 0.05 collected" without the API having to store or serve the target.
 *
 * Checked against a live deployment: it reproduces the contract's own value to within a few wei out of 5e16.
 * The last few units are integer-division rounding in the contract's own maths.
 */
export function graduationAmountFromReserves(virtualQuote: bigint, virtualToken: bigint): bigint {
  if (virtualQuote <= 0n || virtualToken <= 0n) return 0n;
  return (45n * virtualQuote * virtualToken) / (16n * SUPPLY);
}

/**
 * The quote the curve has collected so far: the virtual quote less its starting value (G/3). It equals the
 * contract's realQuoteReserves while the token is trading. Clamped to 0..target so bad reserves cannot draw a
 * negative or an overfull figure.
 */
export function collectedQuote(virtualQuote: bigint, virtualToken: bigint): bigint {
  const target = graduationAmountFromReserves(virtualQuote, virtualToken);
  const collected = virtualQuote - target / 3n;
  if (collected < 0n) return 0n;
  return collected > target ? target : collected;
}

/** The current price: quote per whole token, in the quote's raw units. Zero, not a division by zero, with no reserve. */
export function spotPrice(virtualQuote: bigint, virtualToken: bigint): bigint {
  return virtualToken <= 0n ? 0n : (virtualQuote * WHOLE_TOKEN) / virtualToken;
}

/** Fully diluted market cap in the quote's raw units: the spot price of every one of the billion tokens. */
export function marketCap(virtualQuote: bigint, virtualToken: bigint): bigint {
  return spotPrice(virtualQuote, virtualToken) * WHOLE_TOKENS_IN_SUPPLY;
}
