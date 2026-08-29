/* ------------------------------------------------------------------ */
/*  Calendar geometry, with no React in it.                            */
/*                                                                     */
/*  Everything here answers "where does this box go", which is exactly  */
/*  the sort of thing that looks right on the one day you happen to be  */
/*  testing and is wrong across a DST boundary or the end of a month.   */
/*  Kept separate so it can be checked without rendering anything.      */
/* ------------------------------------------------------------------ */
import { addDays, fmtISO, startOfWeek } from './core.jsx';

export const MODES = ['day', 'week', 'month'];

const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/* The seven days of the week `date` falls in, honouring the week start the
   person chose (Saturday here, by default). */
export function weekDates(date, weekStartDay = 6) {
  const ws = startOfWeek(date, weekStartDay);
  return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
}

/* Six rows of seven, always — a fixed grid, so the month view does not change
   height as you page through it and move the thing you were about to click.
   Leading and trailing days belong to the neighbouring months and are marked
   as such rather than left blank, because a week that ends on the 1st is still
   a week you might have something in. */
export function monthGrid(date, weekStartDay = 6) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = startOfWeek(first, weekStartDay);
  const month = date.getMonth();
  return Array.from({ length: 42 }, (_, i) => {
    const d = addDays(start, i);
    return { date: d, iso: fmtISO(d), inMonth: d.getMonth() === month };
  });
}

/* The range a mode covers, as [fromMs, toMs). Used both to fetch and to total
   up project time, so the number under the grid always describes exactly what
   the grid is showing. */
export function rangeOf(mode, date, weekStartDay = 6) {
  if (mode === 'day') {
    const s = midnight(date);
    return [s.getTime(), addDays(s, 1).getTime()];
  }
  if (mode === 'week') {
    const days = weekDates(date, weekStartDay);
    return [midnight(days[0]).getTime(), addDays(midnight(days[6]), 1).getTime()];
  }
  const cells = monthGrid(date, weekStartDay);
  return [midnight(cells[0].date).getTime(), addDays(midnight(cells[41].date), 1).getTime()];
}

/* Stepping forward and back. A month step lands on the 1st rather than keeping
   the day number: stepping from the 31st would otherwise skip February
   entirely, which is the classic way a month pager loses a month. */
export function step(mode, date, delta) {
  if (mode === 'day') return addDays(date, delta);
  if (mode === 'week') return addDays(date, 7 * delta);
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

/* ---- laying timed things out on one day ---- */

export const DAY_MINUTES = 1440;

/* Minutes from the top of `dayStart` — clipped, so an event that began
   yesterday starts at 0 rather than at a negative offset that would render as
   a box climbing out of the grid. */
export function spanOnDay(item, dayStartMs) {
  const dayEndMs = dayStartMs + 86400000;
  const s = Math.max(item.startMs, dayStartMs);
  const e = Math.min(item.endMs, dayEndMs);
  // "e < s", not "e <= s": calendar.js mints zero-length markers for events an
  // exporter gave no end and no duration, and rejecting those made a real
  // entry silently invisible. A start exactly at midnight-tomorrow is a
  // different thing and belongs to the next day.
  if (e < s || s >= dayEndMs) return null;
  const top = Math.round((s - dayStartMs) / 60000);
  // A zero-length or one-minute event still needs to be clickable.
  const height = Math.max(14, Math.round((e - s) / 60000));
  return { top, height, clippedStart: item.startMs < dayStartMs, clippedEnd: item.endMs > dayEndMs };
}

/* Side-by-side columns for things happening at once.
 *
 * Overlapping items are grouped into clusters and each cluster is divided into
 * as many columns as its busiest moment needs. Doing it per cluster rather than
 * per day is what stops one 9am clash from shrinking a 4pm meeting that
 * overlaps nothing — the naive version divides the whole day by the worst case
 * and everything ends up a sliver. */
export function layoutDay(items, dayStartMs) {
  const placed = [];
  for (const it of items || []) {
    const sp = spanOnDay(it, dayStartMs);
    if (sp) placed.push({ item: it, ...sp, end: sp.top + sp.height });
  }
  placed.sort((a, b) => a.top - b.top || b.height - a.height);

  const out = [];
  let cluster = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    // Columns within the cluster: first column whose last item has finished.
    const colEnds = [];
    for (const p of cluster) {
      let col = colEnds.findIndex((e) => e <= p.top);
      if (col < 0) { col = colEnds.length; colEnds.push(0); }
      colEnds[col] = p.end;
      p.col = col;
    }
    const cols = colEnds.length;
    for (const p of cluster) out.push({ ...p, cols, width: 1 / cols, left: p.col / cols });
    cluster = [];
    clusterEnd = -1;
  };

  for (const p of placed) {
    if (cluster.length && p.top >= clusterEnd) flush();
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, p.end);
  }
  flush();
  return out;
}

/* Tasks carry HH:MM strings rather than epoch milliseconds, so they have to be
   lifted onto the day before they can share a grid with calendar events. A
   task with no start is not on the clock and is not drawn here at all. */
export function taskToSpan(task, dayDate, minutesOf, tStartMin, tEndMin) {
  const s = tStartMin(task);
  if (s == null) return null;
  const e = tEndMin(task);
  const base = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate()).getTime();
  const endMin = e == null ? s + 30 : (e <= s ? e + DAY_MINUTES : e); // wrap past midnight
  return { startMs: base + s * 60000, endMs: base + endMin * 60000 };
}
