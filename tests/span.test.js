/* A multi-day task exists to NOT be overdue while its span is still running.
   That single rule is what makes it different from a task with a bad date, so
   it is the one these tests guard hardest. */
import { describe, it, expect } from 'vitest';
import {
  taskUntil, spans, spanLength, spanDayIndex, spanCovers,
  focusTargetMin, focusSpent, focusMet, addFocusMinutes,
  slotPassed, DEFAULT_TIMINGS, minutesOf,
} from '../src/core.jsx';

const d = (iso) => new Date(`${iso}T00:00:00`);
const T = DEFAULT_TIMINGS;

describe('taskUntil', () => {
  it('reads a real ISO date and nothing else', () => {
    expect(taskUntil({ until: '2026-09-18' })).toBe('2026-09-18');
    expect(taskUntil({ until: '18/09/2026' })).toBe(null);
    expect(taskUntil({ until: '' })).toBe(null);
    expect(taskUntil({})).toBe(null);
    expect(taskUntil(null)).toBe(null);
  });
  it('tells a spanning task from an ordinary one', () => {
    expect(spans({ until: '2026-09-18' })).toBe(true);
    expect(spans({ title: 'x' })).toBe(false);
  });
});

describe('spanLength', () => {
  it('counts both ends', () => {
    expect(spanLength({ until: '2026-09-18' }, d('2026-09-15'))).toBe(4);
    expect(spanLength({ until: '2026-09-15' }, d('2026-09-15'))).toBe(1);
  });
  it('reads a backwards range as one day rather than a negative span', () => {
    // The date picker will happily let someone set an end before the start.
    expect(spanLength({ until: '2026-09-10' }, d('2026-09-15'))).toBe(1);
  });
  it('is one day for a task with no span at all', () => {
    expect(spanLength({}, d('2026-09-15'))).toBe(1);
  });
});

describe('spanDayIndex / spanCovers', () => {
  const t = { until: '2026-09-18' };
  const start = d('2026-09-15');
  it('numbers the days from one', () => {
    expect(spanDayIndex(t, start, d('2026-09-15'))).toBe(1);
    expect(spanDayIndex(t, start, d('2026-09-17'))).toBe(3);
    expect(spanDayIndex(t, start, d('2026-09-18'))).toBe(4);
  });
  it('is zero outside the span, in both directions', () => {
    expect(spanDayIndex(t, start, d('2026-09-14'))).toBe(0);
    expect(spanDayIndex(t, start, d('2026-09-19'))).toBe(0);
  });
  it('covers exactly the days it numbers', () => {
    expect(spanCovers(t, start, d('2026-09-16'))).toBe(true);
    expect(spanCovers(t, start, d('2026-09-19'))).toBe(false);
  });
});

describe('slotPassed with a span', () => {
  // The clock context every caller builds: minutes measured from Fajr.
  const ctx = (curMin) => {
    const fajrM = minutesOf(T.Fajr);
    const sinceFajr = (m) => (((m - fajrM) % 1440) + 1440) % 1440;
    return { timings: T, sinceFajr, curSinceFajr: sinceFajr(curMin) };
  };
  const task = { block: 'morning', until: '2026-09-18' };

  it('is not overdue on any day before the last', () => {
    // Today is the 16th; the task began on the 15th and runs to the 18th.
    expect(slotPassed(task, d('2026-09-15'), d('2026-09-16'), ctx(23 * 60))).toBe(false);
  });
  it('is not overdue on the last day until that day\'s block ends', () => {
    // Morning ends at Dhuhr (12:55). At 09:00 on the 18th there is time left.
    expect(slotPassed(task, d('2026-09-15'), d('2026-09-18'), ctx(9 * 60))).toBe(false);
    expect(slotPassed(task, d('2026-09-15'), d('2026-09-18'), ctx(14 * 60))).toBe(true);
  });
  it('is overdue once the span is behind us', () => {
    expect(slotPassed(task, d('2026-09-15'), d('2026-09-19'), ctx(9 * 60))).toBe(true);
  });
  it('leaves a task with no span exactly as it was', () => {
    const plain = { block: 'morning' };
    expect(slotPassed(plain, d('2026-09-15'), d('2026-09-16'), ctx(9 * 60))).toBe(true);
    expect(slotPassed(plain, d('2026-09-17'), d('2026-09-16'), ctx(9 * 60))).toBe(false);
  });
});

describe('focus targets', () => {
  it('reads a target only when it is a real number of minutes', () => {
    expect(focusTargetMin({ focusTarget: 45 })).toBe(45);
    expect(focusTargetMin({ focusTarget: '60' })).toBe(60);
    expect(focusTargetMin({ focusTarget: 0 })).toBe(null);
    expect(focusTargetMin({ focusTarget: -5 })).toBe(null);
    expect(focusTargetMin({})).toBe(null);
  });
  it('counts minutes per day, not in total', () => {
    const t = { focusTarget: 45, focusLog: { '2026-09-15': 50, '2026-09-16': 10 } };
    expect(focusSpent(t, '2026-09-15')).toBe(50);
    expect(focusSpent(t, '2026-09-16')).toBe(10);
    expect(focusSpent(t, '2026-09-17')).toBe(0);
    expect(focusMet(t, '2026-09-15')).toBe(true);
    expect(focusMet(t, '2026-09-16')).toBe(false);
  });
  it('is never met without a target — no target means nothing to fulfil', () => {
    expect(focusMet({ focusLog: { '2026-09-15': 500 } }, '2026-09-15')).toBe(false);
  });
  it('accumulates rather than replacing, and never mutates the task', () => {
    const t = { focusTarget: 45, focusLog: { '2026-09-15': 20 } };
    const next = addFocusMinutes(t, '2026-09-15', 25);
    expect(next.focusLog['2026-09-15']).toBe(45);
    expect(t.focusLog['2026-09-15']).toBe(20);
    expect(focusMet(next, '2026-09-15')).toBe(true);
  });
  it('ignores a round that measured nothing', () => {
    const t = { focusLog: {} };
    expect(addFocusMinutes(t, '2026-09-15', 0)).toBe(t);
    expect(addFocusMinutes(t, '2026-09-15', -3)).toBe(t);
  });
});
