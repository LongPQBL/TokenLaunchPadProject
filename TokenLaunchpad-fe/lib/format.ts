import { formatQuote, SUPPLY } from "@vezta/shared";

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

/**
 * "2s ago", "5m ago", "3h ago", "2d ago". A trade's time is the chain's and "now" is this server's; they differ by
 * seconds, so a trade can look like it is from the future. That, and a corrupt timestamp, both read as "just now"
 * rather than "-3s ago".
 */
export function formatRelativeTime(timestamp: bigint, nowSeconds: number): string {
  const elapsed = nowSeconds - Number(timestamp);
  if (!Number.isFinite(elapsed) || elapsed < 1) return "just now";
  if (elapsed < 60) return `${Math.floor(elapsed)}s ago`;
  if (elapsed < 3_600) return `${Math.floor(elapsed / 60)}m ago`;
  if (elapsed < 86_400) return `${Math.floor(elapsed / 3_600)}h ago`;
  return `${Math.floor(elapsed / 86_400)}d ago`;
}

/**
 * A holder's share of the supply with two decimals. Holders are usually a tiny fraction of a billion tokens, so
 * anything above zero but under 0.01% is shown as "<0.01%" rather than rounded down to a "0%" that hides who is who.
 */
export function formatShareOfSupply(amount: bigint, supply: bigint = SUPPLY): string {
  if (amount <= 0n || supply <= 0n) return "0%";
  const bps = amount >= supply ? 10_000n : (amount * 10_000n) / supply;
  return bps === 0n ? "<0.01%" : `${(Number(bps) / 100).toFixed(2)}%`;
}

/** A countdown as m:ss, or h:mm:ss from an hour up. The longest launch-tax window is 98 minutes. */
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** A multiplier to one decimal place, without the sign: 50.2 -> "50.2". */
export const formatMultiplier = (multiplier: number): string => multiplier.toFixed(1);

/**
 * A typed ETH amount -> wei, or undefined for anything that is not a plain positive decimal. Strict on purpose: no
 * sign, no exponent, at most 18 decimals, so what is typed is exactly what is spent. Zero is valid here; the caller
 * decides that buying nothing is not an action.
 */
export function parseAmount(text: string, decimals = 18): bigint | undefined {
  const t = text.trim();
  const m = /^(\d+)(?:\.(\d*))?$|^\.(\d+)$/.exec(t);
  if (!m) return undefined;
  const whole = m[1] ?? "0";
  const frac = m[2] ?? m[3] ?? "";
  if (frac.length > decimals) return undefined;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** How old a token is, in the biggest whole unit, for a column: 45s, 12m, 3h, 5d. Clock skew into the future reads as 0s. */
export function formatAge(createdAt: bigint, nowSeconds: number): string {
  const seconds = BigInt(nowSeconds) - createdAt;
  if (seconds <= 0n) return "0s";
  if (seconds < 60n) return `${seconds}s`;
  if (seconds < 3_600n) return `${seconds / 60n}m`;
  if (seconds < 86_400n) return `${seconds / 3_600n}h`;
  return `${seconds / 86_400n}d`;
}

/** A change in price, from basis points, as text without a sign plus which way it went (the arrow and colour are the caller's). */
export function formatChangeBps(bps: number): { text: string; direction: "up" | "down" | "flat" } {
  if (!Number.isFinite(bps)) return { text: "0.0%", direction: "flat" };
  const text = `${(Math.abs(bps) / 100).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  // What rounds to 0.0% is not a move: no arrow, no colour.
  if (Math.abs(bps) < 5) return { text: "0.0%", direction: "flat" };
  return { text, direction: bps > 0 ? "up" : "down" };
}

/**
 * A gain or a loss in the quote's units, with its sign: "+1.5", "-0.125", "0". Cut, never rounded up, at `fractionDigits`; a
 * gain or loss that is real but too small for that is shown as the smallest amount that can be shown, so it is never a plain 0.
 */
export function formatSignedQuote(raw: bigint, quoteDecimals: number, fractionDigits: number): string {
  if (raw === 0n) return "0";
  const abs = raw < 0n ? -raw : raw;
  const shown = formatQuote(abs, quoteDecimals, fractionDigits);
  const text = shown === "0" ? `0.${"0".repeat(Math.max(fractionDigits - 1, 0))}1` : shown;
  return `${raw < 0n ? "-" : "+"}${text}`;
}

/** A profit or loss in basis points, as a signed percent, and which way it went. No percentage at all is a dash, not 0%. */
export function formatPnlBps(bps: number | null): { text: string; direction: "up" | "down" | "flat" } {
  if (bps === null || !Number.isFinite(bps)) return { text: "—", direction: "flat" };
  // What rounds to 0.0% is not a move: no sign, no colour.
  if (Math.abs(bps) < 5) return { text: "0.0%", direction: "flat" };
  const percent = (Math.abs(bps) / 100).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return { text: `${bps > 0 ? "+" : "-"}${percent}%`, direction: bps > 0 ? "up" : "down" };
}

/** An amount of the quote rounded to the NEAREST at `fractionDigits` decimals, for figures that are themselves a wei or two off a round number. */
export function roundQuote(raw: bigint, quoteDecimals: number, fractionDigits: number): bigint {
  if (quoteDecimals <= fractionDigits) return raw;
  const unit = 10n ** BigInt(quoteDecimals - fractionDigits);
  return ((raw + unit / 2n) / unit) * unit;
}
