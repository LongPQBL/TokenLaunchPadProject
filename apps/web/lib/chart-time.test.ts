import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chartTickLabel, chartTimeLabel } from "./chart-time";

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
