import type { Candle } from "./types";

export interface ChartCandle {
  /** Start of the bucket, unix seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Filling gaps stops at this many candles: past it the chart is mostly flat lines and the extra work buys nothing. */
export const MAX_FILLED_BUCKETS = 2000;

/**
 * The API sends prices as raw quote units per whole token, as decimal strings. A chart wants whole quote units as
 * numbers. Writing the shift as an exponent ("15654338.12e-18") lets JavaScript do the decimal-to-double conversion
 * once and correctly, instead of dividing a double that has already been rounded.
 */
export function toChartSeries(candles: Candle[], quoteDecimals: number): ChartCandle[] {
  const whole = (raw: string) => Number(`${raw}e-${quoteDecimals}`);
  return candles.map((c) => ({ time: c.time, open: whole(c.open), high: whole(c.high), low: whole(c.low), close: whole(c.close) }));
}

/**
 * Buckets with no trades have no candle, which leaves the line jumping across the hole. This fills each one with a
 * flat candle at the previous close, which is what the price really did: nothing. Input is sorted first, since a
 * chart cannot draw time going backwards, and a series that would need more than MAX_FILLED_BUCKETS candles is left
 * alone.
 */
export function fillGaps(series: ChartCandle[], intervalSeconds: number): ChartCandle[] {
  if (series.length < 2 || !(intervalSeconds > 0)) return series;

  const sorted = [...series].sort((a, b) => a.time - b.time);
  const buckets = (sorted[sorted.length - 1]!.time - sorted[0]!.time) / intervalSeconds + 1;
  if (buckets > MAX_FILLED_BUCKETS) return series;

  const out: ChartCandle[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const current = sorted[i]!;
    for (let time = prev.time + intervalSeconds; time < current.time; time += intervalSeconds) {
      out.push({ time, open: prev.close, high: prev.close, low: prev.close, close: prev.close });
    }
    out.push(current);
  }
  return out;
}

/**
 * A price for the chart's axis. Launch prices are around 1e-11, where fixed decimals would show two significant
 * digits, so small prices are written in scientific notation with four; ordinary ones stay plain.
 */
export function formatChartPrice(price: number): string {
  if (price === 0) return "0";
  if (Math.abs(price) >= 1e-3) return String(Number(price.toPrecision(4)));
  return price.toExponential(3).replace(/\.?0+e/, "e");
}
