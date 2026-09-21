"use client";

import { UI } from "@vezta/shared";
import { CandlestickSeries, createChart, type CandlestickData, type IChartApi, type ISeriesApi } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatChartPrice, type ChartCandle } from "@/lib/candles";
import { cn } from "@/lib/utils";

// The library draws to a canvas and needs real colours, not CSS variables. They match the design tokens: buy green,
// sell red, and the card and border greys.
const UP = "#22c55e";
const DOWN = "#ef4444";

const formatDollars = (price: number) => (price === 0 || !Number.isFinite(price) ? "$0" : `${price < 0 ? "-" : ""}$${formatChartPrice(Math.abs(price))}`);
const priceFormat = (unit: "usd" | "eth") => ({ type: "custom" as const, formatter: unit === "usd" ? formatDollars : formatChartPrice, minMove: 1e-15 });

/**
 * A candlestick chart. With `usdPerEth` it draws in dollars (every price multiplied by what an ETH is worth) with a switch to ETH;
 * without it, in ETH. The chart is built when there are candles to draw and torn down when there stop being any, or
 * when the component goes away, so moving between tokens does not leak charts. New data updates the series in place;
 * the view is fitted only on the first draw, so a live update does not undo a zoom the user made.
 */
export function PriceChart({ candles, usdPerEth }: { candles: ChartCandle[]; usdPerEth?: number }) {
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
  const drawn = useMemo(() => {
    if (unit !== "usd" || !usdPerEth) return candles;
    return candles.map((c) => ({ ...c, open: c.open * usdPerEth, high: c.high * usdPerEth, low: c.low * usdPerEth, close: c.close * usdPerEth }));
  }, [candles, unit, usdPerEth]);

  useEffect(() => {
    if (!hasData || !container.current) return;
    const chart = createChart(container.current, {
      autoSize: true,
      layout: { attributionLogo: false, background: { color: "transparent" }, textColor: "#8c8c8c", fontFamily: "JetBrains Mono, ui-monospace, monospace" },
      grid: { vertLines: { color: "#1a1a1a" }, horzLines: { color: "#1a1a1a" } },
      rightPriceScale: { borderColor: "#262626" },
      timeScale: { borderColor: "#262626", timeVisible: true, secondsVisible: false },
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
    chartRef.current = chart;
    seriesRef.current = series;
    fitted.current = false;
    return () => {
      chartRef.current = null;
      seriesRef.current = null;
      chart.remove();
    };
  }, [hasData]);

  useEffect(() => {
    if (!hasData || !seriesRef.current) return;
    seriesRef.current.applyOptions({ priceFormat: priceFormat(unit) });
  }, [unit, hasData]);

  useEffect(() => {
    if (!hasData || !seriesRef.current) return;
    // The times are unix seconds already; the library only wants them branded as such.
    seriesRef.current.setData(drawn as unknown as CandlestickData[]);
    if (!fitted.current) {
      chartRef.current?.timeScale().fitContent();
      fitted.current = true;
    }
  }, [drawn, hasData]);

  if (!hasData) {
    return (
      <p data-testid="chart-empty" className="flex h-80 items-center justify-center border border-border text-muted-foreground">
        {UI.token.noTrades}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {usdPerEth ? (
        <div role="group" aria-label="Chart currency" className="flex gap-1 self-end font-mono text-xs">
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
      <div ref={container} data-testid="price-chart" role="img" aria-label="Price chart" className="h-80 w-full border border-border" />
      {/* The chart library's licence asks for this credit. Its built-in logo is off: it is added by a <style> element created at
          run time, which the page's Content Security Policy refuses. */}
      <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" className="self-end text-xs text-muted-foreground hover:underline">
        Charts by TradingView
      </a>
    </div>
  );
}
