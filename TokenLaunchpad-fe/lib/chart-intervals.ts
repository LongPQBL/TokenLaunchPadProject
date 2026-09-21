/** One candle size the chart can be drawn in. */
export interface ChartInterval {
  /** What the button says. */
  label: string;
  /** How many seconds a candle covers: what the API is asked for. */
  seconds: number;
  /**
   * The chart's two ends are moved out to a multiple of this many seconds, a time its marks fall on, so no odd time is marked at an edge
   * (see windowSeries). Absent: not done.
   */
  alignSeconds?: number;
  /**
   * How many candles wide a time mark's label is made, to keep the marks where they read well (see markLabelChars): 12.5 candles puts
   * one-minute candles' marks on the quarter hours, 9.5 puts five-minute candles' on the hours, 5 puts hourly candles' on every sixth hour
   * and four-hour candles' on every day. Absent: the library's own spacing (days and months, for daily candles).
   */
  markBars?: number;
}

export const CHART_INTERVALS: readonly ChartInterval[] = [
  { label: "1m", seconds: 60, alignSeconds: 900, markBars: 12.5 },
  { label: "5m", seconds: 300, alignSeconds: 3_600, markBars: 9.5 },
  { label: "1h", seconds: 3_600, alignSeconds: 21_600, markBars: 5 },
  { label: "4h", seconds: 14_400, alignSeconds: 86_400, markBars: 5 },
  { label: "1d", seconds: 86_400 },
];

/** The size the page is drawn with to begin with, and the one its server-rendered candles are for. */
export const DEFAULT_CHART_INTERVAL = 60;

export const chartIntervalOf = (seconds: number): ChartInterval | undefined => CHART_INTERVALS.find((i) => i.seconds === seconds);
