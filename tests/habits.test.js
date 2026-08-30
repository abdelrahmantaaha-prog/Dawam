/* A streak alone fails in exactly the moment that matters: miss one day after
   twenty-nine and it reads zero, which is both false and the worst thing to
   tell someone deciding whether to bother today. These pin the numbers that
   survive a slip, and the one state worth shouting about. */
import { describe, it, expect } from 'vitest';
import { FULL, TINY, consistency, bestStreak, riskState, habitStats, nextMark, doneOn, wasTiny, stackOrder, wouldCycle, stackShape, MAX_STACK_DEPTH } from '../src/habits.js';
import { fmtISO } from '../src/core.jsx';

const TODAY = '2026-08-29';
/* fmtISO, not toISOString: this machine runs at UTC+3, so toISOString shifts
   midnight back into the previous day and every fixture lands one day early. */
const back = (n) => {
  const d = new Date('2026-08-29T00:00:00');
  d.setDate(d.getDate() - n);
  return fmtISO(d);
};
/* `days` is a list of offsets back from today, or [offset, mark] pairs. */
const habit = (days, over = {}) => ({
  id: 'h', name: 'Read', createdAt: '2026-01-01',
  log: Object.fromEntries(days.map((d) => (Array.isArray(d) ? [back(d[0]), d[1]] : [back(d), FULL]))),
  ...over,
});

describe('consistency', () => {
  it('counts kept days out of the window', () => {
    const h = habit([0, 1, 2, 5, 9]);
    const c = consistency(h, TODAY, 30);
    expect(c).toMatchObject({ kept: 5, of: 30 });
    expect(c.pct).toBe(17);
  });

  it('survives a slip, which is the whole point', () => {
    // 29 of the last 30 kept, today missed. The streak is 0; this is not.
    const h = habit(Array.from({ length: 29 }, (_, i) => i + 1));
    expect(consistency(h, TODAY, 30).pct).toBe(97);
  });

  it('only judges days the habit has existed for', () => {
    // Counting the weeks before it was created as misses would open every new
    // habit at 3%.
    const h = habit([0, 1], { createdAt: back(2) });
    const c = consistency(h, TODAY, 30);
    expect(c.of).toBe(3);
    expect(c.pct).toBe(67);
  });

  it('is 0 with no window rather than NaN', () => {
    expect(consistency({ log: {} }, TODAY, 30).pct).toBe(0);
    expect(consistency({ log: {} }, 'not a date', 30)).toMatchObject({ pct: 0 });
  });

  it('counts a tiny day as kept', () => {
    // Showing up is the habit. A two-minute version still counts.
    const h = habit([[0, TINY], [1, FULL]]);
    expect(consistency(h, TODAY, 30).kept).toBe(2);
  });
});

describe('bestStreak', () => {
  it('finds the longest chain, not the current one', () => {
    // Broken streaks should read as a record kept, not an achievement lost.
    const h = habit([10, 11, 12, 13, 14, 0]);
    expect(bestStreak(h)).toBe(5);
  });
  it('is 0 for an empty log and 1 for a single day', () => {
    expect(bestStreak({ log: {} })).toBe(0);
    expect(bestStreak(habit([3]))).toBe(1);
  });
  it('does not join days that are not adjacent', () => {
    expect(bestStreak(habit([0, 2, 4]))).toBe(1);
  });
});

describe('riskState — never miss twice', () => {
  it('is safe once today is kept', () => {
    expect(riskState(habit([0]), TODAY)).toBe('safe');
    expect(riskState(habit([[0, TINY]]), TODAY)).toBe('safe');
  });

  it('is an ordinary open day when yesterday was kept', () => {
    expect(riskState(habit([1]), TODAY)).toBe('open');
  });

  it('is at risk when yesterday was missed — the moment that decides it', () => {
    // The first miss is an accident. The second is the start of a different
    // habit, and this is the only state the app should make loud.
    expect(riskState(habit([2]), TODAY)).toBe('atRisk');
  });

  it('is broken once two in a row are gone', () => {
    // The chain is already lost; today is a restart, not a rescue, and saying
    // "never miss twice" here would be a lie.
    expect(riskState(habit([3]), TODAY)).toBe('broken');
  });

  it('never accuses a habit created today of missing yesterday', () => {
    expect(riskState(habit([], { createdAt: TODAY }), TODAY)).toBe('open');
    expect(riskState(habit([], { createdAt: back(1) }), TODAY)).toBe('atRisk');
  });
});

describe('nextMark', () => {
  it('cycles nothing -> full -> tiny -> nothing when there is a tiny version', () => {
    expect(nextMark(undefined, { hasTiny: true })).toBe(FULL);
    expect(nextMark(FULL, { hasTiny: true })).toBe(TINY);
    expect(nextMark(TINY, { hasTiny: true })).toBe(undefined);
  });
  it('is a plain on/off without one', () => {
    expect(nextMark(undefined, { hasTiny: false })).toBe(FULL);
    expect(nextMark(FULL, { hasTiny: false })).toBe(undefined);
  });
});

describe('habitStats', () => {
  it('answers everything a card asks in one pass', () => {
    const s = habitStats(habit([[0, TINY], 1, 2]), TODAY);
    expect(s.doneToday).toBe(true);
    expect(s.tinyToday).toBe(true);
    expect(s.risk).toBe('safe');
    expect(s.best).toBe(3);
    expect(s.consistency.kept).toBe(3);
  });
});

describe('the log stays honest about which kind of day it was', () => {
  it('tells a tiny day from a full one', () => {
    const h = habit([[0, TINY], [1, FULL]]);
    expect(doneOn(h, back(0))).toBe(true);
    expect(wasTiny(h, back(0))).toBe(true);
    expect(wasTiny(h, back(1))).toBe(false);
  });
});

/* Habit stacking: "After [CURRENT HABIT], I will [NEW HABIT]".

   Order carries the meaning here — a stacked habit listed above its own anchor
   is a stack nobody can follow — so these are as much about sequence as about
   the label. The cycle cases are not hypothetical: two habits can be set to
   follow each other in two taps. */
describe('stackOrder', () => {
  const h = (id, after) => ({ id, name: id, after: after || null, log: {} });

  it('puts a habit after its anchor', () => {
    const out = stackOrder([h('b', 'a'), h('a')]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('follows a chain of three', () => {
    const out = stackOrder([h('c', 'b'), h('a'), h('b', 'a')]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('leaves unanchored habits in their own order', () => {
    expect(stackOrder([h('a'), h('b'), h('c')]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('treats a prayer anchor as already satisfied', () => {
    // The five prayers are the one thing here that happens every day at a
    // known moment, which is exactly what an anchor is supposed to be.
    expect(stackOrder([h('a', 'prayer:fajr')]).map((x) => x.id)).toEqual(['a']);
  });

  it('survives a cycle instead of recursing forever', () => {
    const out = stackOrder([h('a', 'b'), h('b', 'a')]);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });

  it('loses nothing when an anchor was deleted', () => {
    const out = stackOrder([h('a', 'ghost'), h('b')]);
    expect(out.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });
});

describe('wouldCycle', () => {
  const h = (id, after) => ({ id, name: id, after: after || null });
  it('refuses a habit anchored to itself', () => {
    expect(wouldCycle([h('a')], 'a', 'a')).toBe(true);
  });
  it('refuses a choice that would close a loop', () => {
    expect(wouldCycle([h('a'), h('b', 'a')], 'a', 'b')).toBe(true);
  });
  it('allows an ordinary anchor', () => {
    expect(wouldCycle([h('a'), h('b')], 'b', 'a')).toBe(false);
    expect(wouldCycle([h('a')], 'a', 'prayer:fajr')).toBe(false);
    expect(wouldCycle([h('a')], 'a', null)).toBe(false);
  });
});

/* Stacking has to be visible, not only ordered — "After X" in words is a
   label; a connector you can see is the feature. */
describe('stackShape', () => {
  const h = (id, after) => ({ id, name: id, after: after || null, log: {} });

  it('gives each habit its depth in the chain', () => {
    const out = stackShape([h('c', 'b'), h('a'), h('b', 'a')]);
    expect(out.map((x) => [x.habit.id, x.depth])).toEqual([['a', 0], ['b', 1], ['c', 2]]);
  });

  it('marks which habits are anchors, so a connector knows where to stop', () => {
    const out = stackShape([h('a'), h('b', 'a')]);
    expect(out.find((x) => x.habit.id === 'a').anchorsOthers).toBe(true);
    expect(out.find((x) => x.habit.id === 'b').anchorsOthers).toBe(false);
  });

  it('treats a prayer anchor as depth 1 — anchored, but to nothing on screen', () => {
    const out = stackShape([h('a', 'prayer:fajr')]);
    expect(out[0]).toMatchObject({ depth: 1, hasAnchor: true });
  });

  it('caps depth so a long chain cannot indent a card off the screen', () => {
    const chain = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i, arr) => h(id, i ? arr[i - 1] : null));
    expect(Math.max(...stackShape(chain).map((x) => x.depth))).toBeLessThanOrEqual(MAX_STACK_DEPTH);
  });

  it('survives a cycle rather than recursing forever', () => {
    const out = stackShape([h('a', 'b'), h('b', 'a')]);
    expect(out).toHaveLength(2);
    expect(out.every((x) => Number.isFinite(x.depth))).toBe(true);
  });
});
