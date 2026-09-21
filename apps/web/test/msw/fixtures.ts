/**
 * The API's JSON exactly as it goes over the wire: every amount a decimal STRING, because uint256 does not fit a
 * JavaScript number. The client's job is to turn these into bigint once, at the boundary; tests build responses from
 * here so they exercise that boundary.
 */
export const ADDR = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

export const wireToken = (o: Record<string, unknown> = {}) => ({
  address: ADDR(0xa1),
  creator: ADDR(0xc0ffee),
  name: "Demo Token",
  ticker: "DEMO",
  description: "A token used in tests",
  progressBps: 7800,
  volumeQuote: "1000000000000000000",
  tradeCount: 12,
  complete: false,
  migrated: false,
  createdAt: "1700000000",
  ...o,
});

export const wireDetail = (o: Record<string, unknown> = {}) => ({
  ...wireToken(),
  quoteToken: ADDR(0xfff),
  antiSniperWindow: 60,
  virtualQuoteReserves: "16666666666666666",
  virtualTokenReserves: "1066666666666666666666666666",
  metadataStatus: "ok",
  socials: { website: "https://example.com" },
  ...o,
});

export const wireTrade = (o: Record<string, unknown> = {}) => ({
  id: "11155111-0xabc-3",
  trader: ADDR(0xbeef),
  isBuy: true,
  quoteAmount: "1000000000000000",
  tokenAmount: "5000000000000000000000000",
  fee: "10000000000000",
  launchTax: "0",
  virtualQuoteReserves: "16666666666666666",
  virtualTokenReserves: "1066666666666666666666666666",
  timestamp: "1700000000",
  blockNumber: "11743550",
  logIndex: 3,
  ...o,
});

export const wireHolder = (o: Record<string, unknown> = {}) => ({ holder: ADDR(0xd00d), amount: "40000000000000000000000000", spent: "0", received: "0", value: "0", pnl: "0", ...o });

export const wireCandle = (o: Record<string, unknown> = {}) => ({
  time: 1_700_000_040,
  open: "15654338.125289299030",
  high: "16000000.5",
  low: "15000000",
  close: "15900000.25",
  volume: "50015646996713005",
  ...o,
});

export const wireComment = (o: Record<string, unknown> = {}) => ({
  id: "10",
  author: ADDR(0xc0de),
  body: "gm",
  createdAt: "1700000000",
  ...o,
});
