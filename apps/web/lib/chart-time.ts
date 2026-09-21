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

/** One mark on the time axis. `type` is the library's TickMarkType: what kind of mark it is decides how much of the date it shows. */
export function chartTickLabel(unixSeconds: number, type: number): string {
  const d = new Date(unixSeconds * 1000);
  if (type === YEAR) return String(d.getFullYear());
  if (type === MONTH) return MONTHS[d.getMonth()]!;
  if (type === DAY_OF_MONTH) return String(d.getDate());
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** The time under the crosshair: the day as well, since the axis may show only the hour. */
export function chartTimeLabel(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
