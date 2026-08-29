/* Calendar geometry is the kind of code that looks right on the day you wrote
   it and is wrong at the end of a month, across a week boundary, or the moment
   two meetings collide. None of that is visible in a screenshot of a Tuesday,
   so it is checked here instead. */
import { describe, it, expect } from 'vitest';
import { weekDates, monthGrid, rangeOf, step, spanOnDay, layoutDay, taskToSpan } from '../src/calgrid.js';
import { fmtISO } from '../src/core.jsx';

const D = (iso) => new Date(`${iso}T12:00:00`);
const at = (iso, h, m = 0) => new Date(`${iso}T00:00:00`).getTime() + (h * 60 + m) * 60000;

describe('weekDates', () => {
  it('honours a Saturday week start', () => {
    // The default here is 6 (Saturday), which is the week Egypt actually runs
    // on — a Sunday-start grid would put the weekend in the wrong place.
    const w = weekDates(D('2026-09-02'), 6).map(fmtISO);
    expect(w[0]).toBe('2026-08-29');
    expect(w[6]).toBe('2026-09-04');
    expect(new Date(`${w[0]}T00:00`).getDay()).toBe(6);
  });
  it('honours a Monday week start too', () => {
    const w = weekDates(D('2026-09-02'), 1).map(fmtISO);
    expect(new Date(`${w[0]}T00:00`).getDay()).toBe(1);
    expect(w).toHaveLength(7);
  });
});

describe('monthGrid', () => {
  it('is always six rows of seven, so the grid never changes height', () => {
    for (const iso of ['2026-02-01', '2026-08-15', '2027-01-31']) {
      expect(monthGrid(D(iso), 6)).toHaveLength(42);
    }
  });
  it('marks the neighbouring months rather than blanking them', () => {
    const g = monthGrid(D('2026-09-15'), 6);
    expect(g.filter((c) => c.inMonth)).toHaveLength(30);
    expect(g[0].inMonth).toBe(false);
    expect(g.some((c) => c.iso === '2026-09-01' && c.inMonth)).toBe(true);
  });
  it('starts on the chosen weekday whatever the month does', () => {
    const g = monthGrid(D('2026-09-15'), 6);
    expect(new Date(`${g[0].iso}T00:00`).getDay()).toBe(6);
  });
  it('covers every day of the month with no gaps', () => {
    const g = monthGrid(D('2026-02-10'), 6).filter((c) => c.inMonth).map((c) => c.iso);
    expect(g[0]).toBe('2026-02-01');
    expect(g[g.length - 1]).toBe('2026-02-28');
    expect(new Set(g).size).toBe(g.length);
  });
});

describe('step', () => {
  it('pages a day and a week', () => {
    expect(fmtISO(step('day', D('2026-08-31'), 1))).toBe('2026-09-01');
    expect(fmtISO(step('week', D('2026-08-31'), -1))).toBe('2026-08-24');
  });
  it('does not skip February when paging from the 31st', () => {
    // Keeping the day number is the classic way a month pager loses a month:
    // Jan 31 + 1 month lands on March 3rd.
    const feb = step('month', D('2026-01-31'), 1);
    expect(feb.getMonth()).toBe(1);
    expect(feb.getDate()).toBe(1);
    const mar = step('month', feb, 1);
    expect(mar.getMonth()).toBe(2);
  });
  it('rolls across a year boundary', () => {
    const jan = step('month', D('2026-12-10'), 1);
    expect([jan.getFullYear(), jan.getMonth()]).toEqual([2027, 0]);
  });
});

describe('rangeOf', () => {
  it('covers exactly what each grid shows', () => {
    const [ds, de] = rangeOf('day', D('2026-09-02'), 6);
    expect(de - ds).toBe(86400000);

    const [ws, we] = rangeOf('week', D('2026-09-02'), 6);
    expect(we - ws).toBe(7 * 86400000);

    const [ms, me] = rangeOf('month', D('2026-09-02'), 6);
    expect(me - ms).toBe(42 * 86400000);
    expect(fmtISO(new Date(ms))).toBe(monthGrid(D('2026-09-02'), 6)[0].iso);
  });
});

describe('spanOnDay', () => {
  const day = new Date('2026-09-02T00:00:00').getTime();

  it('places a normal meeting', () => {
    const s = spanOnDay({ startMs: at('2026-09-02', 9), endMs: at('2026-09-02', 10, 30) }, day);
    expect(s).toMatchObject({ top: 540, height: 90, clippedStart: false, clippedEnd: false });
  });

  it('clips something that began yesterday instead of drawing it off the top', () => {
    const s = spanOnDay({ startMs: at('2026-09-01', 22), endMs: at('2026-09-02', 1) }, day);
    expect(s.top).toBe(0);
    expect(s.height).toBe(60);
    expect(s.clippedStart).toBe(true);
  });

  it('clips something running into tomorrow', () => {
    const s = spanOnDay({ startMs: at('2026-09-02', 23), endMs: at('2026-09-03', 2) }, day);
    expect(s.top).toBe(1380);
    expect(s.height).toBe(60);
    expect(s.clippedEnd).toBe(true);
  });

  it('gives a zero-length event enough height to be clickable', () => {
    const s = spanOnDay({ startMs: at('2026-09-02', 9), endMs: at('2026-09-02', 9) }, day);
    expect(s.height).toBeGreaterThanOrEqual(14);
  });

  it('returns nothing for an event on another day', () => {
    expect(spanOnDay({ startMs: at('2026-09-05', 9), endMs: at('2026-09-05', 10) }, day)).toBe(null);
  });
});

describe('layoutDay', () => {
  const day = new Date('2026-09-02T00:00:00').getTime();
  const ev = (h1, m1, h2, m2) => ({ startMs: at('2026-09-02', h1, m1), endMs: at('2026-09-02', h2, m2) });

  it('gives a lone meeting the full width', () => {
    const [a] = layoutDay([ev(9, 0, 10, 0)], day);
    expect(a.width).toBe(1);
    expect(a.left).toBe(0);
  });

  it('splits two that clash', () => {
    const out = layoutDay([ev(9, 0, 10, 0), ev(9, 30, 10, 30)], day);
    expect(out.map((o) => o.width)).toEqual([0.5, 0.5]);
    expect(out.map((o) => o.left).sort()).toEqual([0, 0.5]);
  });

  it('does not let one clash shrink an unrelated meeting later', () => {
    // The naive version divides the whole day by its worst moment, and a 9am
    // three-way pile-up turns a lone 4pm meeting into a sliver.
    const out = layoutDay([ev(9, 0, 10, 0), ev(9, 0, 10, 0), ev(9, 0, 10, 0), ev(16, 0, 17, 0)], day);
    const late = out.find((o) => o.top === 960);
    expect(late.width).toBe(1);
    expect(out.filter((o) => o.top === 540).every((o) => o.width === 1 / 3)).toBe(true);
  });

  it('reuses a column once its meeting has finished', () => {
    // 9-10 and 10-11 do not overlap, so the second belongs in the first's
    // column rather than opening a new one.
    const out = layoutDay([ev(9, 0, 10, 0), ev(9, 30, 11, 0), ev(10, 0, 10, 30)], day);
    expect(Math.max(...out.map((o) => o.cols))).toBe(2);
  });

  it('drops anything not on this day', () => {
    expect(layoutDay([{ startMs: at('2026-09-09', 9), endMs: at('2026-09-09', 10) }], day)).toEqual([]);
  });
});

describe('taskToSpan', () => {
  const minutesOf = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
  const tStartMin = (t) => (t.start ? minutesOf(t.start) : null);
  const tEndMin = (t) => (t.end ? minutesOf(t.end) : null);
  const day = D('2026-09-02');

  it('lifts an HH:MM task onto the day', () => {
    const s = taskToSpan({ start: '09:00', end: '10:30' }, day, minutesOf, tStartMin, tEndMin);
    expect(s.startMs).toBe(at('2026-09-02', 9));
    expect(s.endMs).toBe(at('2026-09-02', 10, 30));
  });

  it('gives a start-only task a visible half hour', () => {
    const s = taskToSpan({ start: '09:00' }, day, minutesOf, tStartMin, tEndMin);
    expect(s.endMs - s.startMs).toBe(30 * 60000);
  });

  it('carries an overnight task past midnight rather than backwards', () => {
    const s = taskToSpan({ start: '23:00', end: '01:00' }, day, minutesOf, tStartMin, tEndMin);
    expect(s.endMs).toBeGreaterThan(s.startMs);
    expect(s.endMs).toBe(at('2026-09-03', 1));
  });

  it('ignores a task that is not on the clock', () => {
    expect(taskToSpan({ title: 'someday' }, day, minutesOf, tStartMin, tEndMin)).toBe(null);
  });
});
