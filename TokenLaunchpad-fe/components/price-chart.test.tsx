import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markLabelChars } from "@/lib/chart-time";

// jsdom has no canvas, so the library itself cannot run here. It is replaced by a recorder so the wiring is tested:
// what the component asks the chart to draw, and that it lets go of the chart afterwards. That the chart really
// draws is checked in the browser test (Task 22), not here.
const setData = vi.fn();
const setVisibleLogicalRange = vi.fn();
let onRange: ((range: { from: number; to: number } | null) => void) | undefined;
const subscribeVisibleLogicalRangeChange = vi.fn((handler: typeof onRange) => void (onRange = handler));
const unsubscribeVisibleLogicalRangeChange = vi.fn();
const chartApplyOptions = vi.fn();
const remove = vi.fn();
const applyOptions = vi.fn();
const addSeries = vi.fn(() => ({ setData, applyOptions }));
const timeScale = { setVisibleLogicalRange, subscribeVisibleLogicalRangeChange, unsubscribeVisibleLogicalRangeChange, width: () => 650 };
const createChart = vi.fn(() => ({ addSeries, timeScale: () => timeScale, remove, applyOptions: chartApplyOptions }));
const CandlestickSeries = Symbol("CandlestickSeries");

vi.mock("lightweight-charts", () => ({ createChart, CandlestickSeries }));

const { PriceChart } = await import("./price-chart");

const series = [
  { time: 60, open: 1e-11, high: 2e-11, low: 5e-12, close: 1.5e-11 },
  { time: 120, open: 1.5e-11, high: 3e-11, low: 1e-11, close: 2e-11 },
];

// The clock is pinned to the last candle's minute, so nothing is carried forward and only the empty minutes before the first are added.
const NOW = 120;
/** What was last drawn, without the empty minutes: the candles themselves. */
const candlesDrawn = () => (setData.mock.lastCall![0] as { time: number; open?: number }[]).filter((p) => "open" in p);
const pointsDrawn = () => setData.mock.lastCall![0] as { time: number; open?: number }[];
/** Where the newest candle is among the points (the empty minutes after it do not count). */
const lastCandleIndex = (points: { open?: number }[]) => points.map((p) => "open" in p).lastIndexOf(true);

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("PriceChart", () => {
  it("draws the candles it is given", () => {
    render(<PriceChart candles={series} now={NOW} />);
    expect(createChart).toHaveBeenCalledOnce();
    expect(addSeries).toHaveBeenCalledWith(CandlestickSeries, expect.anything());
    expect(candlesDrawn()).toEqual(series);
    expect(setVisibleLogicalRange).toHaveBeenCalled();
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
      const quarter = Date.UTC(2026, 8, 21, 16, 15) / 1000;
      expect(options.timeScale.tickMarkFormatter(quarter, 3)).toBe("23:15");
      expect(options.timeScale.tickMarkFormatter(t, 3)).toBe("23:19"); // never none: the library would write a mark with no label in UTC
      expect(options.localization.timeFormatter(t)).toBe("21 Sep 23:19"); // the crosshair says the minute
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
    const { rerender } = render(<PriceChart candles={series} now={NOW} />);
    const next = [...series, { time: 180, open: 2e-11, high: 2.5e-11, low: 1.8e-11, close: 2.2e-11 }];
    rerender(<PriceChart candles={next} now={180} />);
    expect(createChart).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    expect(candlesDrawn()).toEqual(next);
  });

  // Setting the range resets the view. Done on every live update it would undo any zoom or pan the user made.
  it("sets the view on the first draw only, so a live update does not undo the user's zoom", () => {
    const { rerender } = render(<PriceChart candles={series} now={NOW} />);
    expect(setVisibleLogicalRange).toHaveBeenCalledOnce();
    rerender(<PriceChart candles={[...series, { time: 180, open: 2e-11, high: 2.5e-11, low: 1.8e-11, close: 2.2e-11 }]} now={180} />);
    rerender(<PriceChart candles={[...series, { time: 180, open: 2e-11, high: 2.6e-11, low: 1.8e-11, close: 2.4e-11 }]} now={180} />);
    expect(setVisibleLogicalRange).toHaveBeenCalledOnce();
  });

  it("shows an hour of one-minute candles at first, however young the token: thin candles at the right, not fat ones filling the chart", () => {
    render(<PriceChart candles={series} now={NOW} />);
    const points = pointsDrawn();
    const lastCandle = lastCandleIndex(points);
    const range = setVisibleLogicalRange.mock.calls[0]![0] as { from: number; to: number };
    expect(points.findIndex((p) => "open" in p)).toBeGreaterThanOrEqual(58); // the empty minutes before the two candles fill the hour
    expect(range.from).toBe(lastCandle - 60 + 0.5); // 60 candles wide, the last of them the newest
    expect(range.to).toBe(lastCandle + 5); // with room to the right of it for the next ones
    expect(points.length - 1).toBeGreaterThanOrEqual(range.to); // and that room is there to be drawn into
  });

  // The library spaces its time marks by how wide a label is against how wide a candle is; the label width is what is set, so that at any
  // zoom the marks of a chart of one-minute candles fall on the quarter hours (see quarterHourLabelChars).
  it("keeps the marks on the quarter hours: it sets the label width for the zoom the chart is at, and again when the zoom changes", () => {
    render(<PriceChart candles={series} now={NOW} />);
    expect(subscribeVisibleLogicalRangeChange).toHaveBeenCalledOnce();
    onRange!({ from: -0.5, to: 64 }); // 65 bars over 650 px: 10 px a candle
    expect(chartApplyOptions).toHaveBeenLastCalledWith({ timeScale: { tickMarkMaxCharacterLength: markLabelChars(10, 12.5) } });
    chartApplyOptions.mockClear();
    onRange!({ from: -0.5, to: 64 }); // the same zoom: nothing to say again
    expect(chartApplyOptions).not.toHaveBeenCalled();
    onRange!({ from: 0, to: 26 }); // zoomed in to 26 bars: 25 px a candle
    expect(chartApplyOptions).toHaveBeenLastCalledWith({ timeScale: { tickMarkMaxCharacterLength: markLabelChars(25, 12.5) } });
    expect(markLabelChars(25, 12.5)).not.toBe(markLabelChars(10, 12.5));
  });

  it("does nothing about the marks while the chart has no range to measure", () => {
    render(<PriceChart candles={series} now={NOW} />);
    onRange!(null);
    expect(chartApplyOptions).not.toHaveBeenCalled();
  });

  it("stops listening when the chart is let go", () => {
    const { unmount } = render(<PriceChart candles={series} now={NOW} />);
    unmount();
    expect(unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledWith(onRange);
  });

  it("shows only the last hour of a token that has a longer history, which can be scrolled back to", () => {
    const long = Array.from({ length: 200 }, (_, i) => ({ time: 900 * 10 + 60 * i, open: 1e-11, high: 1e-11, low: 1e-11, close: 1e-11 }));
    render(<PriceChart candles={long} now={900 * 10 + 199 * 60} />);
    const range = setVisibleLogicalRange.mock.calls[0]![0] as { from: number; to: number };
    const lastCandle = lastCandleIndex(pointsDrawn());
    expect(lastCandle).toBe(199);
    expect(range.from).toBe(199 - 60 + 0.5);
  });

  it("draws the minutes since the last trade as flat candles, so the chart runs up to now", () => {
    render(<PriceChart candles={series} now={120 + 3 * 60 + 10} />);
    const drawn = candlesDrawn();
    expect(drawn.map((c) => c.time)).toEqual([60, 120, 180, 240, 300]);
    expect(drawn[4]).toEqual({ time: 300, open: 2e-11, high: 2e-11, low: 2e-11, close: 2e-11 });
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

describe("PriceChart: the candle size", () => {
  const five = Array.from({ length: 30 }, (_, i) => ({ time: 3_600 * 5 + 300 * i, open: 1e-11, high: 2e-11, low: 5e-12, close: 1.5e-11 }));

  it("offers 1m, 5m, 1h, 4h and 1d when it is told what to do with a choice, and marks the one that is drawn", () => {
    render(<PriceChart candles={series} now={NOW} interval={300} onIntervalChange={() => {}} />);
    const group = screen.getByRole("group", { name: "Candle size" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["1m", "5m", "1h", "4h", "1d"]);
    expect(within(group).getByRole("button", { name: "5m" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "1m" })).toHaveAttribute("aria-pressed", "false");
  });

  it("tells which size was chosen, in seconds, and not the one already drawn", async () => {
    const onIntervalChange = vi.fn();
    render(<PriceChart candles={series} now={NOW} interval={60} onIntervalChange={onIntervalChange} />);
    await userEvent.click(screen.getByRole("button", { name: "1h" }));
    expect(onIntervalChange).toHaveBeenCalledExactlyOnceWith(3_600);
    onIntervalChange.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "1m" }));
    expect(onIntervalChange).not.toHaveBeenCalled(); // it is what is drawn already
  });

  it("offers no choice when nothing listens for it", () => {
    render(<PriceChart candles={series} now={NOW} />);
    expect(screen.queryByRole("group", { name: "Candle size" })).toBeNull();
  });

  it("keeps offering the choice while there are no candles: a size with no trades in it is a size to go back from", () => {
    render(<PriceChart candles={[]} interval={300} onIntervalChange={() => {}} />);
    expect(screen.getByRole("group", { name: "Candle size" })).toBeInTheDocument();
    expect(screen.getByTestId("chart-empty")).toBeInTheDocument();
  });

  it("spaces the time marks for the size: five-minute candles get the label width that marks the hours", () => {
    render(<PriceChart candles={five} now={3_600 * 5 + 300 * 29} interval={300} />);
    onRange!({ from: -0.5, to: 64 });
    expect(chartApplyOptions).toHaveBeenLastCalledWith({ timeScale: { tickMarkMaxCharacterLength: markLabelChars(10, 9.5) } });
  });

  it("leaves the library's own spacing for daily candles, whose marks are days and months", () => {
    render(<PriceChart candles={five} now={3_600 * 5 + 300 * 29} interval={86_400} />);
    onRange!({ from: -0.5, to: 64 });
    expect(chartApplyOptions).not.toHaveBeenCalled();
  });

  it("puts the two ends of five-minute candles on the hour, as one-minute ones are put on the quarter hour", () => {
    render(<PriceChart candles={five} now={3_600 * 5 + 300 * 29} interval={300} />);
    const points = pointsDrawn();
    expect(points[0]!.time % 3_600).toBe(0);
    expect(points.at(-1)!.time % 3_600).toBe(0);
  });
});

describe("PriceChart in dollars", () => {
  const scaled = (k: number) => series.map((c) => ({ ...c, open: c.open * k, high: c.high * k, low: c.low * k, close: c.close * k }));
  const formatter = () => (addSeries.mock.calls[0] as unknown as [unknown, { priceFormat: { formatter: (n: number) => string } }])[1].priceFormat.formatter;

  it("draws the candles as they are when there is no dollar price: there is no switch to offer one", () => {
    render(<PriceChart candles={series} now={NOW} />);
    expect(screen.queryByRole("button", { name: "USD" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ETH" })).toBeNull();
    expect(candlesDrawn()).toEqual(series);
  });

  it("draws in dollars, unswitchably, whenever there is a price: every price is multiplied by what an ETH is worth", () => {
    render(<PriceChart candles={series} usdPerEth={3_000} now={NOW} />);
    expect(candlesDrawn()).toEqual(scaled(3_000));
    expect(pointsDrawn().filter((p) => !("open" in p)).every((p) => Object.keys(p).join() === "time")).toBe(true); // empty minutes stay empty
    expect(screen.queryByRole("button", { name: "USD" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ETH" })).toBeNull();
  });

  it("writes the axis in dollars, with the sign, out in full", () => {
    render(<PriceChart candles={series} usdPerEth={3_000} />);
    expect(formatter()(2.6984976e-11 * 3_000)).toBe("$0.000000080955");
  });

  it("keeps drawing in dollars as new candles arrive", () => {
    const next = [...series, { time: 180, open: 2e-11, high: 2.5e-11, low: 1.8e-11, close: 2.2e-11 }];
    const { rerender } = render(<PriceChart candles={series} usdPerEth={3_000} now={NOW} />);
    rerender(<PriceChart candles={next} usdPerEth={3_000} now={180} />);
    expect(candlesDrawn()).toEqual(next.map((c) => ({ ...c, open: c.open * 3_000, high: c.high * 3_000, low: c.low * 3_000, close: c.close * 3_000 })));
  });

  it("falls back to ETH if the price goes away: still no switch to offer", () => {
    const { rerender } = render(<PriceChart candles={series} usdPerEth={3_000} now={NOW} />);
    rerender(<PriceChart candles={series} now={NOW} />);
    expect(screen.queryByRole("button", { name: "USD" })).toBeNull();
    expect(candlesDrawn()).toEqual(series);
  });
});

describe("PriceChart: market cap", () => {
  it("shows nothing where the currency switch used to be, when there is no market cap to show", () => {
    render(<PriceChart candles={series} now={NOW} interval={60} onIntervalChange={() => {}} />);
    expect(screen.queryByTestId("market-cap")).toBeNull();
  });

  it("shows the market cap where the currency switch used to be, larger than the rest of the chart's own text", () => {
    render(<PriceChart candles={series} now={NOW} marketCap={<span>$48,270.11</span>} />);
    const cap = screen.getByTestId("market-cap");
    expect(cap).toHaveTextContent("$48,270.11");
    expect(cap.className).toMatch(/text-2xl/);
  });

  it("draws whatever it is given: the caller decides dollars, ETH, or nothing, not this component", () => {
    render(<PriceChart candles={series} now={NOW} marketCap="16.09 ETH" />);
    expect(screen.getByTestId("market-cap")).toHaveTextContent("16.09 ETH");
  });

  it("keeps the row when there is a market cap but no candle-size switch", () => {
    render(<PriceChart candles={series} now={NOW} marketCap="$1" />);
    expect(screen.getByTestId("market-cap")).toBeInTheDocument();
  });
});
