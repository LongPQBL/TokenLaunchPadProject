/** 0x8509aea4…7744 -> 0x8509…7744. Anything that is not a full address is returned as it is, never mangled. */
export function shortAddress(address: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/**
 * Basis points as a percentage: 7800 -> "78%", 7855 -> "78.6%". Clamped to 0..100%, because the value is derived
 * from reserves and a bad one must not draw a bar wider than its box. Done in whole tenths of a percent so the
 * rounding is exact rather than at the mercy of floating point.
 */
export function formatPercentBps(bps: number): string {
  const tenths = Math.round(Math.min(Math.max(bps, 0), 10_000) / 10);
  return tenths % 10 === 0 ? `${tenths / 10}%` : `${(tenths / 10).toFixed(1)}%`;
}

/** A 20-byte hex address. Used on values that come from the URL or the API before they are put into a link or a query. */
export function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}
