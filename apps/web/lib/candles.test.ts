import { describe, expect, it } from "vitest";
import { fillGaps, formatChartPrice, MAX_FILLED_BUCKETS, toChartSeries } from "./candles";
import type { Candle } from "./types";

const candle = (time: number, o: Partial<Candle> = {}): Candle => ({
  time,
  open: "15654338.125289299030",
  high: "16000000.5",
  low: "15000000",
  close: "15900000.25",
  volume: 50n,
  ...o,
});
const flat = (time: number, price: number) => ({ time, open: price, high: price, low: price, close: price });

describe("toChartSeries", () => {
  // The API sends prices as raw quote units per whole token; a chart wants whole quote units.
  it("divides raw quote units by 10^decimals, exactly enough to keep the digits that matter", () => {
    const [c] = toChartSeries([candle(60)], 18);
    expect(c!.open / 1.5654338125289e-11).toBeCloseTo(1, 12);
    expect(c!.close / 1.590000025e-11).toBeCloseTo(1, 12);
    expect(c!.high / 1.60000005e-11).toBeCloseTo(1, 12);
    expect(c!.low / 1.5e-11).toBeCloseTo(1, 12);
  });

  it("respects a quote with fewer decimals, such as a 6-decimal stablecoin", () => {
    const [c] = toChartSeries([candle(60, { open: "1500000", high: "2000000", low: "1000000", close: "1750000" })], 6);
    expect(c).toMatchObject({ open: 1.5, high: 2, low: 1, close: 1.75 });
  });

  it("keeps the bucket time and drops the volume, which this chart does not draw", () => {
    const [c] = toChartSeries([candle(1_700_000_040)], 18);
    expect(c!.time).toBe(1_700_000_040);
    expect(c).not.toHaveProperty("volume");
  });

  it("keeps the order it was given", () => {
    expect(toChartSeries([candle(60), candle(120), candle(180)], 18).map((c) => c.time)).toEqual([60, 120, 180]);
  });

  it("returns an empty series for no candles", () => {
    expect(toChartSeries([], 18)).toEqual([]);
  });

  it("never produces NaN or Infinity from a well-formed price", () => {
    for (const price of ["0", "0.000000000001", "123456789012345678901234567890", "1"]) {
      const [c] = toChartSeries([candle(60, { open: price, high: price, low: price, close: price })], 18);
      expect(Number.isFinite(c!.open), price).toBe(true);
    }
  });
});

describe("fillGaps", () => {
  it("fills buckets with no trades using a flat candle at the previous close", () => {
    const out = fillGaps([flat(0, 5), flat(60, 6), flat(240, 7)], 60);
    expect(out.map((c) => c.time)).toEqual([0, 60, 120, 180, 240]);
    expect(out[2]).toEqual(flat(120, 6)); // the close of the 60 candle, not of the 240 one
    expect(out[3]).toEqual(flat(180, 6));
  });

  it("leaves a series with no gaps as it is", () => {
    const series = [flat(0, 5), flat(60, 6), flat(120, 7)];
    expect(fillGaps(series, 60)).toEqual(series);
  });

  it("copes with no candles and with one", () => {
    expect(fillGaps([], 60)).toEqual([]);
    expect(fillGaps([flat(0, 5)], 60)).toEqual([flat(0, 5)]);
  });

  it("does not disturb the real candles", () => {
    const real = { time: 60, open: 1, high: 3, low: 0.5, close: 2 };
    expect(fillGaps([flat(0, 5), real, flat(180, 9)], 60)).toContainEqual(real);
  });

  // A token whose trades are a day apart, drawn at one-second candles, would be tens of thousands of flat candles.
  it("does not fill when doing so would create an unreasonable number of candles", () => {
    const series = [flat(0, 5), flat((MAX_FILLED_BUCKETS + 10) * 60, 6)];
    expect(fillGaps(series, 60)).toEqual(series);
  });

  it("still fills right up to the limit", () => {
    const series = [flat(0, 5), flat((MAX_FILLED_BUCKETS - 1) * 60, 6)];
    expect(fillGaps(series, 60)).toHaveLength(MAX_FILLED_BUCKETS);
  });

  it("sorts its input first, since a chart cannot draw time going backwards", () => {
    expect(fillGaps([flat(120, 7), flat(0, 5)], 60).map((c) => c.time)).toEqual([0, 60, 120]);
  });

  it("does not loop forever on a zero or negative interval", () => {
    const series = [flat(0, 5), flat(600, 6)];
    expect(fillGaps(series, 0)).toEqual(series);
    expect(fillGaps(series, -60)).toEqual(series);
  });
});

describe("formatChartPrice", () => {
  // A launch price is around 1e-11: fixed decimals would show two significant digits, so small prices go exponential.
  it("shows a tiny price with four significant digits, in scientific notation", () => {
    expect(formatChartPrice(2.6984976e-11)).toBe("2.698e-11");
    expect(formatChartPrice(1.5e-11)).toBe("1.5e-11");
  });

  it("shows an ordinary price in plain decimals, without trailing zeros", () => {
    expect(formatChartPrice(0.026984976)).toBe("0.02698");
    expect(formatChartPrice(1.5)).toBe("1.5");
    expect(formatChartPrice(12)).toBe("12");
  });

  it("shows zero as zero", () => {
    expect(formatChartPrice(0)).toBe("0");
  });
});
