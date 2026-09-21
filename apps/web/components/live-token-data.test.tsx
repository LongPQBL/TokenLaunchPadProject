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
const drawn = vi.hoisted(() => ({ candles: [] as unknown[], usdPerEth: undefined as number | undefined, interval: undefined as number | undefined }));
vi.mock("./price-chart", () => ({
  PriceChart: ({ candles, usdPerEth, interval, onIntervalChange }: { candles: unknown[]; usdPerEth?: number; interval?: number; onIntervalChange?: (seconds: number) => void }) => {
    drawn.candles = candles;
    drawn.usdPerEth = usdPerEth;
    drawn.interval = interval;
    return (
      <div data-testid="price-chart">
        {candles.length} candles
        {onIntervalChange &&
          ([["1m", 60], ["5m", 300], ["1h", 3_600]] as const).map(([label, seconds]) => (
            <button key={seconds} onClick={() => onIntervalChange(seconds)}>
              {label}
            </button>
          ))}
      </div>
    );
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

describe("LivePriceChart: the candle size", () => {
  const initial = [{ time: 960, open: 2e-11, high: 2e-11, low: 2e-11, close: 2e-11 }];
  const item = (time: number, price: string) => ({ time, open: price, high: price, low: price, close: price, volume: "1" });
  const fiveMinute = { items: [item(900, "20000000"), item(1_200, "30000000")] };
  const show = () => {
    const fake = fakeClient();
    render(<LivePriceChart chain="sepolia" token={TOKEN} initial={initial} interval={60} decimals={18} client={fake.client} />);
    return fake;
  };
  const choose = async (label: string) => {
    await act(async () => screen.getByRole("button", { name: label }).click());
  };

  it("starts at the size the page was rendered with, and offers the others", () => {
    show();
    expect(drawn.interval).toBe(60);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["1m", "5m", "1h"]);
  });

  it("asks for the candles of the size chosen and draws them at that size", async () => {
    api.candles.mockResolvedValue(fiveMinute);
    show();
    await choose("5m");
    expect(api.candles).toHaveBeenCalledWith("sepolia", TOKEN, 300);
    expect(drawn.interval).toBe(300);
    expect(drawn.candles).toHaveLength(2); // 900 and 1200 are next to each other at five minutes: no gap to fill
  });

  it("keeps the size on show, and says why, when the new size cannot be loaded", async () => {
    api.candles.mockRejectedValue(new Error("down"));
    show();
    await choose("5m");
    expect(drawn.interval).toBe(60);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load candles of that size. Please try again.");
  });

  it("clears that message when a size loads", async () => {
    api.candles.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(fiveMinute);
    show();
    await choose("5m");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await choose("5m");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(drawn.interval).toBe(300);
  });

  it("goes with the last size chosen when the answers come back out of order", async () => {
    const late: { resolve?: (v: unknown) => void } = {};
    api.candles.mockImplementation((_c: string, _t: string, size: number) =>
      size === 300 ? new Promise((resolve) => void (late.resolve = resolve)) : Promise.resolve({ items: [item(3_600, "40000000")] }),
    );
    show();
    await choose("5m"); // still on its way
    await choose("1h"); // answered at once
    expect(drawn.interval).toBe(3_600);
    await act(async () => late.resolve!(fiveMinute)); // the answer for 5m, too late
    expect(drawn.interval).toBe(3_600);
  });

  it("does not show the failure of a size that is no longer the one wanted", async () => {
    const late: { reject?: (e: unknown) => void } = {};
    api.candles.mockImplementation((_c: string, _t: string, size: number) =>
      size === 300 ? new Promise((_resolve, reject) => void (late.reject = reject)) : Promise.resolve({ items: [item(3_600, "40000000")] }),
    );
    show();
    await choose("5m"); // on its way
    await choose("1h"); // answered
    await act(async () => late.reject!(new Error("down"))); // the answer for 5m: a failure, but nobody is waiting for it now
    expect(screen.queryByRole("alert")).toBeNull();
    expect(drawn.interval).toBe(3_600);
  });

  it("moves the candles of the size on show for a live trade, in buckets of that size", async () => {
    api.candles.mockResolvedValue(fiveMinute);
    const fake = show();
    await choose("5m");
    act(() => fake.message(`token:sepolia:${TOKEN}`, wire(21, { timestamp: "1300" }))); // inside the 1200..1499 bucket
    // in the five-minute buckets that were fetched (900 and 1200), not new ones of one minute: the trade moved the second
    expect((drawn.candles as { time: number }[]).map((c) => c.time)).toEqual([900, 1_200]);
    expect((drawn.candles[0] as { close: number }).close).toBeCloseTo(2e-11, 20); // 20000000 wei: untouched
    expect((drawn.candles[1] as { close: number }).close).toBeCloseTo(2e-11, 20); // 3e-11 before (30000000 wei), the trade's price now
  });

  it("refetches at the size on show after a reconnect", async () => {
    api.candles.mockResolvedValue(fiveMinute);
    const fake = show();
    await choose("5m");
    api.candles.mockClear();
    await act(async () => fake.reconnect());
    expect(api.candles).toHaveBeenCalledWith("sepolia", TOKEN, 300);
  });

  it("does not ask again for the size that is already on show", async () => {
    show();
    await choose("1m");
    expect(api.candles).not.toHaveBeenCalled();
  });
});
