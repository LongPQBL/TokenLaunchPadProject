/**
 * The chart library takes unix seconds and writes them in UTC, so a person in Vietnam sees 16:19 at 23:19. These write the same
 * instants in the viewer's own time zone, and are handed to the library as its tick and crosshair formatters.
 */

// The library's TickMarkType, by value: it is an enum, and importing it would tie this file (and its test) to the library.
const YEAR = 0;
const MONTH = 1;
const DAY_OF_MONTH = 2;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");

/**
 * One mark on the time axis. `type` is the library's TickMarkType: what kind of mark it is decides how much of the date it shows. It is
 * never null: a mark with no label is written by the library in UTC instead, which is the mistake this file exists to avoid.
 */
export function chartTickLabel(unixSeconds: number, type: number): string {
  const d = new Date(unixSeconds * 1000);
  if (type === YEAR) return String(d.getFullYear());
  if (type === MONTH) return MONTHS[d.getMonth()]!;
  if (type === DAY_OF_MONTH) return String(d.getDate());
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** What the library takes as the width of a character when it spaces the time marks: (font size 12 + 4) * 5 / 8 pixels. */
const LABEL_PX_PER_CHAR = 10;
const MIN_LABEL_CHARS = 5; // "23:15": a label is never given less room than it needs

/**
 * The label width (in characters, for the library's `tickMarkMaxCharacterLength`) that makes a time mark's label `markBars` candles wide
 * at `barSpacing` pixels a candle. The library keeps its marks at least ceil(label width / candle width) candles apart and places the
 * heaviest kind of mark first (a day, then an hour, ...), so that distance decides which marks are drawn: see ChartInterval.markBars for
 * the values that put each candle size's marks on the quarter hours, hours, days. Zoomed so far out that a label of "23:15" needs more
 * than that, it keeps the room it needs and the marks are fewer instead.
 */
export function markLabelChars(barSpacing: number, markBars: number): number {
  if (!Number.isFinite(barSpacing) || barSpacing <= 0) return MIN_LABEL_CHARS;
  return Math.max(MIN_LABEL_CHARS, Math.round((markBars * barSpacing) / LABEL_PX_PER_CHAR));
}

/** The time under the crosshair: the day as well, since the axis may show only the hour. */
export function chartTimeLabel(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
