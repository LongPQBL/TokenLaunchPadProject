import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveClient, LiveMessage } from "@/lib/ws/client";
import type { Trade } from "@/lib/types";
import { fakeChain } from "@/test/fake-chain";
import { renderWithWallet, TEST_DEPLOYMENT } from "@/test/wallet";
import { LivePriceChart, LiveTradesTable } from "./live-token-data";

const TOKEN = "0x00000000000000000000000000000000000000b2";
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

const api = vi.hoisted(() => ({ trades: vi.fn(), candles: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), api }));

// The chart itself needs a canvas; what it is asked to draw is what matters here.
const drawn = vi.hoisted(() => ({ candles: [] as unknown[], usdPerEth: undefined as number | undefined }));
vi.mock("./price-chart", () => ({
  PriceChart: ({ candles, usdPerEth }: { candles: unknown[]; usdPerEth?: number }) => {
    drawn.candles = candles;
    drawn.usdPerEth = usdPerEth;
    return <div data-testid="price-chart">{candles.length} candles</div>;
  },
}));

function fakeClient() {
  const listeners = new Map<string, Set<(m: LiveMessage) => void>>();
  const reconnect = new Set<() => void>();
  const state = { connected: true };
  const client = {
    subscribe: (room: string, fn: (m: LiveMessage) => void) => {
      if (!listeners.has(room)) listeners.set(room, new Set());
      listeners.get(room)!.add(fn);
      return () => void listeners.get(room)!.delete(fn);
    },
    onStatus: () => () => {},
    onReconnect: (fn: () => void) => (reconnect.add(fn), () => void reconnect.delete(fn)),
    isConnected: () => state.connected,
    close: () => {},
  } as unknown as LiveClient;
  return { client, message: (room: string, m: LiveMessage) => listeners.get(room)?.forEach((fn) => fn(m)), reconnect: () => reconnect.forEach((fn) => fn()), state };
}

const wire = (n: number, over: Record<string, unknown> = {}) => ({
  type: "trade", id: `${tx(n)}-0`, chain: "sepolia", token: TOKEN, trader: "0x00000000000000000000000000000000000000a1", isBuy: true,
  quoteAmount: "1000000000000000", tokenAmount: "5000000000000000000000000", fee: "10", launchTax: "0",
  virtualQuoteReserves: "20000000000000000", virtualTokenReserves: "1000000000000000000000000000",
  timestamp: "1000", blockNumber: "50", txHash: tx(n), logIndex: 0, ...over,
});
const rest = (n: number): Trade => ({
  id: `11155111-${tx(n)}-0`, trader: "0x00000000000000000000000000000000000000a2", isBuy: false, quoteAmount: 1n, tokenAmount: 10n ** 18n, fee: 0n, launchTax: 0n,
  virtualQuoteReserves: 1n, virtualTokenReserves: 1n, timestamp: 900n, blockNumber: 40n, logIndex: 0,
});

beforeEach(() => {
  api.trades.mockReset();
  api.candles.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("LiveTradesTable", () => {
  it("shows the trades it was given, and puts a live one on top without a reload", () => {
    const fake = fakeClient();
    render(<LiveTradesTable chain="sepolia" token={TOKEN} initial={[rest(1)]} now={2_000} client={fake.client} />);
    expect(screen.getAllByTestId("trade-row")).toHaveLength(1);
    act(() => fake.message(`token:sepolia:${TOKEN}`, wire(2)));
    const rows = screen.getAllByTestId("trade-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Buy")).toBeInTheDocument(); // the new one, newest first
  });

  it("shows a trade once when the socket delivers it twice", () => {
    const fake = fakeClient();
    render(<LiveTradesTable chain="sepolia" token={TOKEN} initial={[]} now={2_000} client={fake.client} />);
    act(() => fake.message(`token:sepolia:${TOKEN}`, wire(2)));
    act(() => fake.message(`token:sepolia:${TOKEN}`, wire(2)));
    expect(screen.getAllByTestId("trade-row")).toHaveLength(1);
  });

  it("shows a trade once when it came from the page and then again over the socket, whose ids differ", () => {
    const fake = fakeClient();
    render(<LiveTradesTable chain="sepolia" token={TOKEN} initial={[rest(1)]} now={2_000} client={fake.client} />);
    act(() => fake.message(`token:sepolia:${TOKEN}`, wire(1, { blockNumber: "40" })));
    expect(screen.getAllByTestId("trade-row")).toHaveLength(1);
  });

  it("ignores a message that is not a well-formed trade instead of drawing it", () => {
    const fake = fakeClient();
    render(<LiveTradesTable chain="sepolia" token={TOKEN} initial={[]} now={2_000} client={fake.client} />);
    act(() => fake.message(`token:sepolia:${TOKEN}`, wire(3, { quoteAmount: "<script>" })));
    act(() => fake.message(`token:sepolia:${TOKEN}`, { type: "trade", token: TOKEN }));
    expect(screen.queryAllByTestId("trade-row")).toHaveLength(0);
  });

  it("refetches the feed after a reconnect and shows what it missed", async () => {
    const fake = fakeClient();
    api.trades.mockResolvedValue({ items: [rest(5), rest(1)] });
    render(<LiveTradesTable chain="sepolia" token={TOKEN} initial={[rest(1)]} now={2_000} client={fake.client} />);
    await act(async () => fake.reconnect());
    expect(api.trades).toHaveBeenCalledWith("sepolia", TOKEN, expect.objectContaining({ limit: 30 }));
    expect(screen.getAllByTestId("trade-row")).toHaveLength(2);
  });

  it("ages the times while the page stays open: '1m ago' does not stay '1m ago' for an hour", () => {
    vi.useFakeTimers();
    const fake = fakeClient();
    render(<LiveTradesTable chain="sepolia" token={TOKEN} initial={[rest(1)]} now={960} client={fake.client} />);
    expect(screen.getByText("1m ago")).toBeInTheDocument(); // the trade is at 900, the server's clock said 960
    vi.setSystemTime(1_500_000); // 1500 s
    act(() => void vi.advanceTimersByTime(5_000));
    expect(screen.getByText("10m ago")).toBeInTheDocument();
  });

  it("does not show a message for another token", () => {
    const fake = fakeClient();
    render(<LiveTradesTable chain="sepolia" token={TOKEN} initial={[]} now={2_000} client={fake.client} />);
    act(() => fake.message(`token:sepolia:${TOKEN}`, wire(4, { token: "0x00000000000000000000000000000000000000c9" })));
    expect(screen.queryAllByTestId("trade-row")).toHaveLength(0);
  });
});

describe("LivePriceChart", () => {
  const initial = [{ time: 960, open: 2e-11, high: 2e-11, low: 2e-11, close: 2e-11 }];

  it("gives the chart what an ETH is worth, once the chain's price feed says, so it can draw in dollars", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
    const fake = fakeClient();
    const chain = fakeChain({ usd: { answer: 3_000n * 10n ** 8n } });
    renderWithWallet(<LivePriceChart chain="sepolia" token={TOKEN} initial={initial} interval={60} decimals={18} client={fake.client} />, undefined, chain.transport);
    expect(drawn.usdPerEth).toBeUndefined(); // until the feed has answered
    await vi.waitFor(() => expect(drawn.usdPerEth).toBe(3_000));
    vi.unstubAllEnvs();
  });

  it("gives it nothing (so it draws in ETH) when there is no wallet layer to ask through", () => {
    const fake = fakeClient();
    render(<LivePriceChart chain="sepolia" token={TOKEN} initial={initial} interval={60} decimals={18} client={fake.client} />);
    expect(drawn.usdPerEth).toBeUndefined();
  });

  it("draws the candles it was given", () => {
    const fake = fakeClient();
    render(<LivePriceChart chain="sepolia" token={TOKEN} initial={initial} interval={60} decimals={18} client={fake.client} />);
    expect(drawn.candles).toHaveLength(1);
  });

  it("moves the last candle for a live trade in its bucket", () => {
    const fake = fakeClient();
    render(<LivePriceChart chain="sepolia" token={TOKEN} initial={initial} interval={60} decimals={18} client={fake.client} />);
    act(() => fake.message(`token:sepolia:${TOKEN}`, wire(7, { timestamp: "990" })));
    expect(drawn.candles).toHaveLength(1);
    expect((drawn.candles[0] as { close: number }).close).toBeCloseTo(2e-11, 20); // price = 0.02 / 1e9 tokens
  });

  it("adds a candle when the trade crosses into a new bucket, filling any gap so the line does not jump", () => {
    const fake = fakeClient();
    render(<LivePriceChart chain="sepolia" token={TOKEN} initial={initial} interval={60} decimals={18} client={fake.client} />);
    act(() => fake.message(`token:sepolia:${TOKEN}`, wire(8, { timestamp: "1140" }))); // 3 buckets later
    expect(drawn.candles.length).toBe(4);
  });

  it("counts a trade once when it is delivered twice", () => {
    const fake = fakeClient();
    render(<LivePriceChart chain="sepolia" token={TOKEN} initial={initial} interval={60} decimals={18} client={fake.client} />);
    act(() => fake.message(`token:sepolia:${TOKEN}`, wire(9, { timestamp: "1020" })));
    act(() => fake.message(`token:sepolia:${TOKEN}`, wire(9, { timestamp: "1020" })));
    expect(drawn.candles).toHaveLength(2);
  });

  it("refetches the candles after a reconnect, rather than resuming blind, and draws what it gets", async () => {
    const fake = fakeClient();
    api.candles.mockResolvedValue({ items: [
      { time: 960, open: "20000000", high: "20000000", low: "20000000", close: "20000000", volume: "1" },
      { time: 1020, open: "30000000", high: "30000000", low: "30000000", close: "30000000", volume: "1" },
    ] });
    render(<LivePriceChart chain="sepolia" token={TOKEN} initial={initial} interval={60} decimals={18} client={fake.client} />);
    await act(async () => fake.reconnect());
    expect(api.candles).toHaveBeenCalledWith("sepolia", TOKEN, 60);
    expect(drawn.candles).toHaveLength(2);
  });
});
