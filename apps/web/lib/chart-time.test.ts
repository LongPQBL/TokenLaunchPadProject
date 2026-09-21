import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chartTickLabel, chartTimeLabel, markLabelChars } from "./chart-time";

// 2026-09-21 16:19:00 UTC, the minute on the chart that showed 16:19 to a person for whom it was 23:19.
const T = Date.UTC(2026, 8, 21, 16, 19) / 1000;

const TIME = 3;
const DAY = 2;
const MONTH = 1;
const YEAR = 0;

let zone: string | undefined;
beforeEach(() => {
  zone = process.env.TZ;
});
afterEach(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

describe("the chart's times", () => {
  it("are in the viewer's own time zone, not UTC: 16:19 UTC is 23:19 in Vietnam", () => {
    process.env.TZ = "Asia/Ho_Chi_Minh";
    expect(chartTickLabel(T, TIME)).toBe("23:19");
    expect(chartTimeLabel(T)).toBe("21 Sep 23:19");
  });

  it("follow the zone: the same instant is 12:19 in New York", () => {
    process.env.TZ = "America/New_York";
    expect(chartTickLabel(T, TIME)).toBe("12:19");
    expect(chartTimeLabel(T)).toBe("21 Sep 12:19");
  });

  it("always give a label in the viewer's zone, never none: the library writes a mark with no label in UTC instead", () => {
    process.env.TZ = "Asia/Ho_Chi_Minh";
    expect(chartTickLabel(T, TIME)).toBe("23:19");
    expect(chartTickLabel(Date.UTC(2026, 8, 21, 16, 10) / 1000, TIME)).toBe("23:10");
  });

  it("put the date where the local day is not the UTC day", () => {
    process.env.TZ = "Asia/Ho_Chi_Minh";
    const lateUtc = Date.UTC(2026, 8, 21, 20, 30) / 1000; // 03:30 on the 22nd there
    expect(chartTimeLabel(lateUtc)).toBe("22 Sep 03:30");
    expect(chartTickLabel(lateUtc, DAY)).toBe("22");
  });

  it("label the axis by what each mark is: time of day, day, month, year", () => {
    process.env.TZ = "UTC";
    expect(chartTickLabel(T, TIME)).toBe("16:19");
    expect(chartTickLabel(T, DAY)).toBe("21");
    expect(chartTickLabel(T, MONTH)).toBe("Sep");
    expect(chartTickLabel(T, YEAR)).toBe("2026");
  });
});

// The chart library keeps its time marks at least `ceil(width of a label / width of a candle)` candles apart and places the heaviest
// marks (a day, an hour) first. So a label made `markBars` candles wide keeps the marks where the next lighter kind of mark is too close
// to be added: for one-minute candles at 12.5, marks 11 to 15 candles apart are the quarter hours; for five-minute candles at 9.5, 7 to 12
// apart are the hours; at 5, 4 to 6 apart are every sixth hour of hourly candles and every day of four-hour ones.
describe("markLabelChars", () => {
  const PX_PER_CHAR = 10; // the library's, at its default font size
  const apart = (barSpacing: number, markBars: number) => Math.ceil((markLabelChars(barSpacing, markBars) * PX_PER_CHAR) / barSpacing);

  it.each([4, 5, 6, 8.5, 9.3, 12, 20, 40])("keeps one-minute candles' marks 11 to 15 candles apart at %s px a candle: the quarter hours", (bs) => {
    expect(apart(bs, 12.5)).toBeGreaterThanOrEqual(11);
    expect(apart(bs, 12.5)).toBeLessThanOrEqual(15);
  });

  it.each([5, 6, 8.5, 9.3, 12, 20, 40])("keeps five-minute candles' marks 7 to 12 candles apart at %s px a candle: the hours", (bs) => {
    expect(apart(bs, 9.5)).toBeGreaterThanOrEqual(7);
    expect(apart(bs, 9.5)).toBeLessThanOrEqual(12);
  });

  it.each([8.4, 9.3, 12, 20, 40])("keeps hourly and four-hourly candles' marks 4 to 6 candles apart at %s px a candle", (bs) => {
    expect(apart(bs, 5)).toBeGreaterThanOrEqual(4);
    expect(apart(bs, 5)).toBeLessThanOrEqual(6);
  });

  it("does not shrink a label below what one needs to be read, so a chart zoomed far out shows fewer marks, not overlapping ones", () => {
    expect(markLabelChars(1, 12.5)).toBeGreaterThanOrEqual(5);
    expect(markLabelChars(0.2, 5)).toBeGreaterThanOrEqual(5);
  });

  it("copes with a chart that has no width yet", () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) expect(markLabelChars(bad, 12.5), String(bad)).toBeGreaterThanOrEqual(5);
  });
});
