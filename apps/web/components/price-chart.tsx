"use client";

import { UI } from "@vezta/shared";
import { CandlestickSeries, createChart, type CandlestickData, type IChartApi, type ISeriesApi } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { formatChartPrice, type ChartCandle } from "@/lib/candles";

// The library draws to a canvas and needs real colours, not CSS variables. They match the design tokens: buy green,
// sell red, and the card and border greys.
const UP = "#22c55e";
const DOWN = "#ef4444";

/**
 * A candlestick chart. The chart is built when there are candles to draw and torn down when there stop being any, or
 * when the component goes away, so moving between tokens does not leak charts. New data updates the series in place;
 * the view is fitted only on the first draw, so a live update does not undo a zoom the user made.
 */
export function PriceChart({ candles }: { candles: ChartCandle[] }) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const fitted = useRef(false);
  const hasData = candles.length > 0;

  useEffect(() => {
    if (!hasData || !container.current) return;
    const chart = createChart(container.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#8c8c8c", fontFamily: "JetBrains Mono, ui-monospace, monospace" },
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
      priceFormat: { type: "custom", formatter: formatChartPrice, minMove: 1e-15 },
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
    // The times are unix seconds already; the library only wants them branded as such.
    seriesRef.current.setData(candles as unknown as CandlestickData[]);
    if (!fitted.current) {
      chartRef.current?.timeScale().fitContent();
      fitted.current = true;
    }
  }, [candles, hasData]);

  if (!hasData) {
    return (
      <p data-testid="chart-empty" className="flex h-80 items-center justify-center border border-border text-muted-foreground">
        {UI.token.noTrades}
      </p>
    );
  }
  return <div ref={container} data-testid="price-chart" role="img" aria-label="Price chart" className="h-80 w-full border border-border" />;
}
