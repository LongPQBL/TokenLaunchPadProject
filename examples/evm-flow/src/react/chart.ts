import { CandlestickSeries, createChart, type UTCTimestamp } from "lightweight-charts";

/** One row of GET /tokens/:address/candles from the indexer API. Prices are raw quote units per whole token. */
export interface ApiCandle {
  time: string; // unix seconds, start of the bucket
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

/**
 * Draws the price chart with Lightweight Charts (Apache-2.0). Prices are converted to a plain number of quote units
 * (e.g. ETH per token). Numbers this small are fine for drawing; keep bigint for anything that moves money.
 */
export function renderCandles(container: HTMLElement, candles: ApiCandle[], quoteDecimals = 18) {
  const chart = createChart(container, { autoSize: true, layout: { attributionLogo: true } });
  const series = chart.addSeries(CandlestickSeries, {
    priceFormat: { type: "price", precision: 12, minMove: 1e-12 }, // token prices are tiny
  });
  const scale = 10 ** quoteDecimals;
  series.setData(
    candles.map((c) => ({
      time: Number(c.time) as UTCTimestamp,
      open: Number(c.open) / scale,
      high: Number(c.high) / scale,
      low: Number(c.low) / scale,
      close: Number(c.close) / scale,
    })),
  );
  chart.timeScale().fitContent();
  return chart; // call chart.remove() when the component unmounts
}
