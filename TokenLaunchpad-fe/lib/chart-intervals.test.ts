import { describe, expect, it } from "vitest";
import { CHART_INTERVALS, DEFAULT_CHART_INTERVAL, chartIntervalOf } from "./chart-intervals";

describe("the chart's candle sizes", () => {
  it("are 1m, 5m, 1h, 4h and 1d, smallest first, with the size of each in seconds", () => {
    expect(CHART_INTERVALS.map((i) => [i.label, i.seconds])).toEqual([["1m", 60], ["5m", 300], ["1h", 3_600], ["4h", 14_400], ["1d", 86_400]]);
  });

  it("start at one minute, which is what the page is rendered with", () => {
    expect(DEFAULT_CHART_INTERVAL).toBe(60);
  });

  it("are all sizes the API will answer for: whole seconds, at most a week", () => {
    for (const i of CHART_INTERVALS) {
      expect(Number.isInteger(i.seconds)).toBe(true);
      expect(i.seconds).toBeGreaterThan(0);
      expect(i.seconds).toBeLessThanOrEqual(604_800);
    }
  });

  it("line the ends of the chart up on a time its marks fall on, which the candle divides evenly (or none)", () => {
    for (const i of CHART_INTERVALS) if (i.alignSeconds !== undefined) expect(i.alignSeconds % i.seconds, i.label).toBe(0);
  });

  it("are found by their size in seconds, and an unknown size gets no special treatment rather than an error", () => {
    expect(chartIntervalOf(300)?.label).toBe("5m");
    expect(chartIntervalOf(90)).toBeUndefined();
  });
});
