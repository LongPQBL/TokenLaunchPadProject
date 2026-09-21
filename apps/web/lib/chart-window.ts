import { MAX_FILLED_BUCKETS, type ChartCandle } from "./candles";

/** A place in time on the chart: a candle, or an empty minute (the library's "whitespace": a time with no price). */
export type ChartPoint = ChartCandle | { time: number };

/** How many candles the chart shows at first: 60 of them (an hour of one-minute candles), so it reads as an overview and not as a few fat bars. */
export const CHART_MIN_BARS = 60;

/** Empty candles left to the right of the last one, for the next ones to be drawn into. */
export const CHART_RIGHT_BARS = 5;

/** The quarter hour, in seconds: what a chart of one-minute candles is marked at. */
const QUARTER_HOUR = 900;

/**
 * What is drawn for a token's candles: a chart that is a fixed number of candles wide, however young the token is.
 *  - The last price is carried forward as flat candles up to the current one, as any chart does when nobody trades (a token idle for
 *    more than a chart can fill is left as it is).
 *  - Empty candles are put before the first until there are `minBars` of them, so a token with two candles is two thin candles at the
 *    right of the chart, not two candles that fill it; and a few (`rightBars`) after the last, as room for the next.
 *  - Both ends of what is drawn are moved out to a multiple of `alignSeconds` (a quarter hour for one-minute candles). The chart library
 *    puts a time mark wherever there is room for one, and at an edge with no marked time beside it that is an odd minute ("00:13"); with
 *    a marked time at each edge it is only the marked times that are marked. Not done for a candle that does not divide `alignSeconds`.
 * The series it is given is already free of gaps between candles (see fillGaps) and sorted.
 */
export function windowSeries(
  series: ChartCandle[],
  { interval, now, minBars = CHART_MIN_BARS, rightBars = CHART_RIGHT_BARS, alignSeconds = QUARTER_HOUR }: { interval: number; now: number; minBars?: number; rightBars?: number; alignSeconds?: number },
): ChartPoint[] {
  if (series.length === 0 || !(interval > 0)) return series;
  const points: ChartPoint[] = [...series];

  const last = series[series.length - 1]!;
  const current = Math.floor(now / interval) * interval;
  const ahead = (current - last.time) / interval;
  if (ahead > 0 && series.length + ahead <= MAX_FILLED_BUCKETS) {
    for (let time = last.time + interval; time <= current; time += interval) {
      points.push({ time, open: last.close, high: last.close, low: last.close, close: last.close });
    }
  }

  const aligned = alignSeconds > 0 && alignSeconds % interval === 0;
  const first = points[0]!.time;
  let start = first - Math.max(0, minBars - points.length) * interval;
  // (At most one round of candles: times that are not on the candle's own grid never line up, and that must not loop for ever.)
  for (let step = 0; aligned && start % alignSeconds !== 0 && step < alignSeconds / interval; step++) start -= interval;
  const padding: ChartPoint[] = [];
  for (let time = start; time < first; time += interval) padding.push({ time });

  const lastDrawn = points[points.length - 1]!.time;
  let end = lastDrawn + rightBars * interval;
  for (let step = 0; aligned && end % alignSeconds !== 0 && step < alignSeconds / interval; step++) end += interval;
  const room: ChartPoint[] = [];
  for (let time = lastDrawn + interval; time <= end; time += interval) room.push({ time });

  return [...padding, ...points, ...room];
}
