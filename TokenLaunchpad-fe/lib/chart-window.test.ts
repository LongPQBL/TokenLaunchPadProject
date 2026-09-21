import { describe, expect, it } from "vitest";
import { fillGaps, MAX_FILLED_BUCKETS, type ChartCandle } from "./candles";
import { windowSeries } from "./chart-window";

const candle = (time: number, close = 1): ChartCandle => ({ time, open: close, high: close, low: close, close });
const T0 = 9_000; // a quarter hour (10 * 900 s), so the times below are easy to reason about
const isCandle = (p: { time: number }): p is ChartCandle => "open" in p;
const lastCandleIndex = (points: { time: number }[]) => points.map(isCandle).lastIndexOf(true);

describe("windowSeries", () => {
  it("draws nothing for a token with no candles: the page says there are no trades", () => {
    expect(windowSeries([], { interval: 60, now: T0, minBars: 10 })).toEqual([]);
  });

  it("carries the last price forward as flat candles up to the current minute, as a chart does when nobody trades", () => {
    const out = windowSeries([candle(T0, 5)], { interval: 60, now: T0 + 5 * 60 + 20, minBars: 1 });
    const candles = out.filter(isCandle);
    expect(candles.map((c) => c.time)).toEqual([T0, T0 + 60, T0 + 120, T0 + 180, T0 + 240, T0 + 300]);
    for (const c of candles.slice(1)) expect(c).toEqual({ time: c.time, open: 5, high: 5, low: 5, close: 5 });
  });

  it("adds nothing when the last candle is already this minute's", () => {
    const out = windowSeries([candle(T0)], { interval: 60, now: T0 + 30, minBars: 1 });
    expect(out.filter(isCandle)).toHaveLength(1);
  });

  it("pads the left with empty minutes so a young token is a few thin candles on the right, not a few fat ones filling the chart", () => {
    const out = windowSeries([candle(T0), candle(T0 + 60)], { interval: 60, now: T0 + 60, minBars: 10 });
    const firstCandle = out.findIndex(isCandle);
    expect(firstCandle).toBeGreaterThanOrEqual(8); // at least 10 minutes up to the last candle
    for (const p of out.slice(0, firstCandle)) expect(isCandle(p)).toBe(false); // whitespace: a place in time with no price
  });

  it("does not pad the left of a token that already has enough minutes", () => {
    const series = Array.from({ length: 12 }, (_, i) => candle(T0 + i * 60));
    const out = windowSeries(series, { interval: 60, now: T0 + 11 * 60, minBars: 10 });
    expect(out.findIndex(isCandle)).toBe(0);
    expect(out.filter(isCandle)).toEqual(series);
  });

  // The chart library puts a time mark wherever there is room for one, and at the edge of the data there is room where there is no
  // quarter hour beside it: the first and last minutes drawn are quarter hours, so it is the quarter hours that are marked.
  it("starts and ends on a quarter hour, so no odd minute is marked at either edge", () => {
    for (const now of [T0 + 60, T0 + 4 * 60 + 5, T0 + 14 * 60, T0 + 29 * 60 + 59]) {
      const out = windowSeries([candle(T0)], { interval: 60, now, minBars: 10 });
      expect(out[0]!.time % 900, `first, now ${now - T0}`).toBe(0);
      expect(out.at(-1)!.time % 900, `last, now ${now - T0}`).toBe(0);
    }
  });

  it("leaves empty minutes after the last candle, as room for the next ones", () => {
    const out = windowSeries([candle(T0)], { interval: 60, now: T0, minBars: 10, rightBars: 5 });
    const lastCandle = lastCandleIndex(out);
    expect(out.length - 1 - lastCandle).toBeGreaterThanOrEqual(5);
    for (const p of out.slice(lastCandle + 1)) expect(isCandle(p)).toBe(false); // no invented candles in the future
  });

  it("terminates, and still draws, when the times are not on the candle's own grid: it cannot line them up, and does not try forever", () => {
    // 100 s past a whole minute: no number of minutes back from it is a quarter hour.
    const out = windowSeries([candle(9_100), candle(9_160)], { interval: 60, now: 9_160, minBars: 10 });
    expect(out.filter(isCandle)).toHaveLength(2);
    expect(out.length).toBeGreaterThanOrEqual(10);
  });

  it("does not try to line up on quarter hours a candle that does not divide one", () => {
    const out = windowSeries([candle(T0, 2)], { interval: 3600, now: T0, minBars: 3 });
    expect(out.filter(isCandle)).toHaveLength(1);
    expect(out.findIndex(isCandle)).toBe(2); // just the two empty hours it was asked for
  });

  it("keeps time ascending, whole and without repeats, whatever it added", () => {
    const out = windowSeries(fillGaps([candle(T0), candle(T0 + 180)], 60), { interval: 60, now: T0 + 600, minBars: 30 });
    const times = out.map((p) => p.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
    for (const t of times) expect(Number.isInteger(t)).toBe(true);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBe(60);
  });

  it("does not carry a price forward across more minutes than a chart can fill: a token idle for days is left as it is", () => {
    const out = windowSeries([candle(T0)], { interval: 60, now: T0 + (MAX_FILLED_BUCKETS + 5) * 60, minBars: 1 });
    expect(out.filter(isCandle)).toHaveLength(1);
  });

  it("does not put candles in the future when the clock is behind the last trade", () => {
    const out = windowSeries([candle(T0 + 300)], { interval: 60, now: T0, minBars: 1 });
    expect(out.filter(isCandle).map((c) => c.time)).toEqual([T0 + 300]);
  });
});
