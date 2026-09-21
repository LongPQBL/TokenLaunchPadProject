"use client";

import { UI } from "@vezta/shared";
import { CandlestickSeries, createChart, type CandlestickData, type IChartApi, type ISeriesApi } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatChartPrice, type ChartCandle } from "@/lib/candles";
import { chartTickLabel, chartTimeLabel, markLabelChars } from "@/lib/chart-time";
import { CHART_INTERVALS, chartIntervalOf } from "@/lib/chart-intervals";
import { CHART_MIN_BARS, CHART_RIGHT_BARS, windowSeries, type ChartPoint } from "@/lib/chart-window";
import { cn } from "@/lib/utils";

// The library draws to a canvas and needs real colours, not CSS variables. They match the design tokens: buy green,
// sell red, and the card and border greys.
const UP = "#22c55e";
const DOWN = "#ef4444";

const formatDollars = (price: number) => (price === 0 || !Number.isFinite(price) ? "$0" : `${price < 0 ? "-" : ""}$${formatChartPrice(Math.abs(price))}`);
const priceFormat = (unit: "usd" | "eth") => ({ type: "custom" as const, formatter: unit === "usd" ? formatDollars : formatChartPrice, minMove: 1e-15 });

/** The current time in unix seconds, moving on as time does, so the chart keeps running up to now while nobody trades. Pinned by `pinned`. */
function useNow(pinned: number | undefined): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (pinned !== undefined) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  }, [pinned]);
  return pinned ?? now;
}

/**
 * A candlestick chart. With `usdPerEth` it draws in dollars (every price multiplied by what an ETH is worth) with a switch to ETH;
 * without it, in ETH. The chart is built when there are candles to draw and torn down when there stop being any, or
 * when the component goes away, so moving between tokens does not leak charts. New data updates the series in place;
 * the view is set only on the first draw, so a live update does not undo a zoom the user made.
 */
export function PriceChart({
  candles,
  usdPerEth,
  interval = 60,
  onIntervalChange,
  now,
}: {
  candles: ChartCandle[];
  usdPerEth?: number;
  /** Seconds in a candle. */
  interval?: number;
  /** Told which candle size was chosen, in seconds. Absent: the sizes are not offered. */
  onIntervalChange?: (seconds: number) => void;
  /** The clock, in unix seconds, for tests; the real time otherwise. */
  now?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const fitted = useRef(false);
  const hasData = candles.length > 0;
  const [chosen, setChosen] = useState<"usd" | "eth">("usd");
  const unit = usdPerEth ? chosen : "eth";
  const unitRef = useRef(unit);
  unitRef.current = unit;
  // The prices are ETH; in dollars each is multiplied by the price of an ETH. The chart is not rebuilt for it, only redrawn.
  const clock = useNow(now);
  // A chart a fixed hour wide, run up to the current minute; the empty minutes are left as they are, and the prices of the rest are dollars or ETH.
  const drawn = useMemo<ChartPoint[]>(() => {
    const points = windowSeries(candles, { interval, now: clock, alignSeconds: chartIntervalOf(interval)?.alignSeconds });
    if (unit !== "usd" || !usdPerEth) return points;
    return points.map((p) => ("open" in p ? { ...p, open: p.open * usdPerEth, high: p.high * usdPerEth, low: p.low * usdPerEth, close: p.close * usdPerEth } : p));
  }, [candles, interval, clock, unit, usdPerEth]);

  useEffect(() => {
    if (!hasData || !container.current) return;
    const chart = createChart(container.current, {
      autoSize: true,
      layout: { attributionLogo: false, background: { color: "transparent" }, textColor: "#8c8c8c", fontFamily: "JetBrains Mono, ui-monospace, monospace" },
      grid: { vertLines: { color: "#1a1a1a" }, horzLines: { color: "#1a1a1a" } },
      rightPriceScale: { borderColor: "#262626" },
      // The library writes times in UTC; these write them in the viewer's own time zone (the times themselves are unix seconds).
      timeScale: { borderColor: "#262626", timeVisible: true, secondsVisible: false, tickMarkFormatter: (time: unknown, type: number) => chartTickLabel(Number(time), type) },
      localization: { timeFormatter: (time: unknown) => chartTimeLabel(Number(time)) },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
      // Prices are around 1e-11. A fixed number of decimals would show two significant digits, so the axis uses a
      // formatter, and the price step is far below the smallest price or the scale would round everything to zero.
      priceFormat: priceFormat(unitRef.current),
    });
    // The library spaces its time marks by label width against candle width, so the label width is kept at what puts the marks of a chart of
    // one-minute candles on the quarter hours (:00 :15 :30 :45), at whatever zoom the chart is at.
    // (Daily candles are left to the library: its marks for them are days and months.)
    const markBars = chartIntervalOf(interval)?.markBars;
    let labelChars: number | undefined;
    const onRange = (range: { from: number; to: number } | null) => {
      if (markBars === undefined || !range || !(range.to > range.from)) return;
      const chars = markLabelChars(chart.timeScale().width() / (range.to - range.from), markBars);
      if (chars === labelChars) return;
      labelChars = chars;
      chart.applyOptions({ timeScale: { tickMarkMaxCharacterLength: chars } });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    chartRef.current = chart;
    seriesRef.current = series;
    fitted.current = false;
    return () => {
      chartRef.current = null;
      seriesRef.current = null;
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.remove();
    };
  }, [hasData, interval]); // (a new candle size is a new chart: its view and its marks are its own)

  useEffect(() => {
    if (!hasData || !seriesRef.current) return;
    seriesRef.current.applyOptions({ priceFormat: priceFormat(unit) });
  }, [unit, hasData]);

  useEffect(() => {
    if (!hasData || !seriesRef.current) return;
    // The times are unix seconds already; the library only wants them branded as such.
    seriesRef.current.setData(drawn as unknown as CandlestickData[]);
    if (!fitted.current) {
      // The last hour, and a few empty minutes to the right of the newest candle: many thin candles, an overview, never a few fat ones
      // filling the chart. (The empty minutes drawn after it are only there to make the marks fall right, and are not all in view.)
      let newest = drawn.length - 1;
      while (newest > 0 && !("open" in drawn[newest]!)) newest--;
      chartRef.current?.timeScale().setVisibleLogicalRange({ from: newest - CHART_MIN_BARS + 0.5, to: newest + CHART_RIGHT_BARS });
      fitted.current = true;
    }
  }, [drawn, hasData]);

  // The candle size and the currency. They stay while there is nothing to draw: a size with no trades in it is a size to go back from.
  const controls =
    onIntervalChange || usdPerEth ? (
      <div className="flex items-center justify-between gap-3 font-mono text-xs">
        {onIntervalChange ? (
          <div role="group" aria-label={UI.token.chartInterval} className="flex gap-1">
            {CHART_INTERVALS.map((i) => (
              <button
                key={i.seconds}
                type="button"
                aria-pressed={interval === i.seconds}
                onClick={() => interval !== i.seconds && onIntervalChange(i.seconds)}
                className={cn("border border-border px-2 py-0.5", interval === i.seconds ? "bg-accent text-primary" : "text-muted-foreground hover:text-foreground")}
              >
                {i.label}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        {usdPerEth ? (
          <div role="group" aria-label="Chart currency" className="flex gap-1">
            {(["usd", "eth"] as const).map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={unit === u}
                onClick={() => setChosen(u)}
                className={cn("border border-border px-2 py-0.5", unit === u ? "bg-accent text-primary" : "text-muted-foreground hover:text-foreground")}
              >
                {u === "usd" ? "USD" : "ETH"}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    ) : null;

  if (!hasData) {
    return (
      <div className="flex flex-col gap-1">
        {controls}
        <p data-testid="chart-empty" className="flex h-80 items-center justify-center border border-border text-muted-foreground">
          {UI.token.noTrades}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {controls}
      <div ref={container} data-testid="price-chart" role="img" aria-label="Price chart" className="h-80 w-full border border-border" />
      {/* The chart library's licence asks for this credit. Its built-in logo is off: it is added by a <style> element created at
          run time, which the page's Content Security Policy refuses. */}
      <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" className="self-end text-xs text-muted-foreground hover:underline">
        Charts by TradingView
      </a>
    </div>
  );
}
