import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom has no canvas, so the library itself cannot run here. It is replaced by a recorder so the wiring is tested:
// what the component asks the chart to draw, and that it lets go of the chart afterwards. That the chart really
// draws is checked in the browser test (Task 22), not here.
const setData = vi.fn();
const fitContent = vi.fn();
const remove = vi.fn();
const applyOptions = vi.fn();
const addSeries = vi.fn(() => ({ setData, applyOptions }));
const createChart = vi.fn(() => ({ addSeries, timeScale: () => ({ fitContent }), remove, applyOptions: vi.fn() }));
const CandlestickSeries = Symbol("CandlestickSeries");

vi.mock("lightweight-charts", () => ({ createChart, CandlestickSeries }));

const { PriceChart } = await import("./price-chart");

const series = [
  { time: 60, open: 1e-11, high: 2e-11, low: 5e-12, close: 1.5e-11 },
  { time: 120, open: 1.5e-11, high: 3e-11, low: 1e-11, close: 2e-11 },
];

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("PriceChart", () => {
  it("draws the candles it is given", () => {
    render(<PriceChart candles={series} />);
    expect(createChart).toHaveBeenCalledOnce();
    expect(addSeries).toHaveBeenCalledWith(CandlestickSeries, expect.anything());
    expect(setData).toHaveBeenCalledWith(series);
    expect(fitContent).toHaveBeenCalled();
  });

  // The library's own logo is put in place by a <style> element it creates at run time, which a strict Content Security
  // Policy refuses. Its licence asks for an attribution link instead, and that is ordinary markup.
  it("does not let the chart library inject its own stylesheet, and credits it with a link instead", () => {
    render(<PriceChart candles={series} />);
    const options = (createChart.mock.calls[0] as unknown as [unknown, { layout: { attributionLogo: boolean } }])[1];
    expect(options.layout.attributionLogo).toBe(false);
    const link = screen.getByRole("link", { name: "Charts by TradingView" });
    expect(link).toHaveAttribute("href", "https://www.tradingview.com/");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("writes the time axis and the crosshair in the viewer's own time zone, since the library's own is UTC", () => {
    const zone = process.env.TZ;
    process.env.TZ = "Asia/Ho_Chi_Minh";
    try {
      render(<PriceChart candles={series} />);
      const options = (createChart.mock.calls[0] as unknown as [
        unknown,
        { timeScale: { tickMarkFormatter: (t: number, type: number) => string }; localization: { timeFormatter: (t: number) => string } },
      ])[1];
      const t = Date.UTC(2026, 8, 21, 16, 19) / 1000; // 16:19 UTC
      expect(options.timeScale.tickMarkFormatter(t, 3)).toBe("23:19");
      expect(options.localization.timeFormatter(t)).toBe("21 Sep 23:19");
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  it("formats the price axis for tiny numbers instead of a fixed number of decimals", () => {
    render(<PriceChart candles={series} />);
    const options = (addSeries.mock.calls[0] as unknown as [unknown, { priceFormat: { type: string; formatter: (n: number) => string; minMove: number } }])[1];
    expect(options.priceFormat.type).toBe("custom");
    expect(options.priceFormat.formatter(2.6984976e-11)).toBe("0.000000000026985");
    // A price step below the smallest price, or the scale would round everything to zero.
    expect(options.priceFormat.minMove).toBeLessThan(1e-12);
  });

  it("colours rising candles green and falling ones red, like the buy and sell buttons", () => {
    render(<PriceChart candles={series} />);
    const options = (addSeries.mock.calls[0] as unknown as [unknown, { upColor: string; downColor: string }])[1];
    expect(options.upColor).toBe("#22c55e");
    expect(options.downColor).toBe("#ef4444");
  });

  it("lets go of the chart when it unmounts, so navigating between tokens does not leak charts", () => {
    const { unmount } = render(<PriceChart candles={series} />);
    expect(remove).not.toHaveBeenCalled();
    unmount();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("updates the data in place when the candles change, without rebuilding the chart", () => {
    const { rerender } = render(<PriceChart candles={series} />);
    const next = [...series, { time: 180, open: 2e-11, high: 2.5e-11, low: 1.8e-11, close: 2.2e-11 }];
    rerender(<PriceChart candles={next} />);
    expect(createChart).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    expect(setData).toHaveBeenLastCalledWith(next);
  });

  // fitContent resets the view. Done on every live update it would undo any zoom or pan the user made.
  it("fits the view on the first draw only, so a live update does not undo the user's zoom", () => {
    const { rerender } = render(<PriceChart candles={series} />);
    expect(fitContent).toHaveBeenCalledOnce();
    rerender(<PriceChart candles={[...series, { time: 180, open: 2e-11, high: 2.5e-11, low: 1.8e-11, close: 2.2e-11 }]} />);
    rerender(<PriceChart candles={[...series, { time: 180, open: 2e-11, high: 2.6e-11, low: 1.8e-11, close: 2.4e-11 }]} />);
    expect(fitContent).toHaveBeenCalledOnce();
  });

  it("shows an empty state, and builds no chart, when there are no candles", () => {
    render(<PriceChart candles={[]} />);
    expect(screen.getByTestId("chart-empty")).toHaveTextContent("No trades yet.");
    expect(createChart).not.toHaveBeenCalled();
  });

  it("builds the chart once trades arrive after an empty start, and lets go of it if they vanish again", () => {
    const { rerender } = render(<PriceChart candles={[]} />);
    rerender(<PriceChart candles={series} />);
    expect(createChart).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("chart-empty")).not.toBeInTheDocument();
    rerender(<PriceChart candles={[]} />);
    expect(remove).toHaveBeenCalledOnce();
    expect(screen.getByTestId("chart-empty")).toBeInTheDocument();
  });

  it("exposes the chart to assistive technology and to tests", () => {
    render(<PriceChart candles={series} />);
    expect(screen.getByTestId("price-chart")).toHaveAttribute("role", "img");
    expect(screen.getByTestId("price-chart")).toHaveAttribute("aria-label", "Price chart");
  });
});

describe("PriceChart in dollars", () => {
  const scaled = (k: number) => series.map((c) => ({ ...c, open: c.open * k, high: c.high * k, low: c.low * k, close: c.close * k }));
  const formatter = () => (addSeries.mock.calls[0] as unknown as [unknown, { priceFormat: { formatter: (n: number) => string } }])[1].priceFormat.formatter;

  it("offers no switch, and draws the candles as they are, when there is no dollar price", () => {
    render(<PriceChart candles={series} />);
    expect(screen.queryByRole("button", { name: "USD" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ETH" })).toBeNull();
    expect(setData).toHaveBeenLastCalledWith(series);
  });

  it("draws in dollars by default when there is a price: every price is multiplied by what an ETH is worth", () => {
    render(<PriceChart candles={series} usdPerEth={3_000} />);
    expect(setData).toHaveBeenLastCalledWith(scaled(3_000));
    expect(screen.getByRole("button", { name: "USD" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "ETH" })).toHaveAttribute("aria-pressed", "false");
  });

  it("writes the axis in dollars, with the sign, out in full", () => {
    render(<PriceChart candles={series} usdPerEth={3_000} />);
    expect(formatter()(2.6984976e-11 * 3_000)).toBe("$0.000000080955");
  });

  it("switches to ETH without rebuilding the chart: the same candles as they were, and an axis in ETH", async () => {
    render(<PriceChart candles={series} usdPerEth={3_000} />);
    await userEvent.click(screen.getByRole("button", { name: "ETH" }));
    expect(createChart).toHaveBeenCalledOnce();
    expect(setData).toHaveBeenLastCalledWith(series);
    const applied = applyOptions.mock.calls.at(-1)![0] as { priceFormat: { formatter: (n: number) => string } };
    expect(applied.priceFormat.formatter(2.6984976e-11)).toBe("0.000000000026985");
    expect(screen.getByRole("button", { name: "ETH" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches back to dollars", async () => {
    render(<PriceChart candles={series} usdPerEth={3_000} />);
    await userEvent.click(screen.getByRole("button", { name: "ETH" }));
    await userEvent.click(screen.getByRole("button", { name: "USD" }));
    expect(setData).toHaveBeenLastCalledWith(scaled(3_000));
    expect((applyOptions.mock.calls.at(-1)![0] as { priceFormat: { formatter: (n: number) => string } }).priceFormat.formatter(1e-8)).toBe("$0.00000001");
  });

  it("keeps drawing in dollars as new candles arrive", () => {
    const next = [...series, { time: 180, open: 2e-11, high: 2.5e-11, low: 1.8e-11, close: 2.2e-11 }];
    const { rerender } = render(<PriceChart candles={series} usdPerEth={3_000} />);
    rerender(<PriceChart candles={next} usdPerEth={3_000} />);
    expect(setData).toHaveBeenLastCalledWith(next.map((c) => ({ ...c, open: c.open * 3_000, high: c.high * 3_000, low: c.low * 3_000, close: c.close * 3_000 })));
  });

  it("falls back to ETH, and offers no switch, if the price goes away", () => {
    const { rerender } = render(<PriceChart candles={series} usdPerEth={3_000} />);
    rerender(<PriceChart candles={series} />);
    expect(screen.queryByRole("button", { name: "USD" })).toBeNull();
    expect(setData).toHaveBeenLastCalledWith(series);
  });
});
