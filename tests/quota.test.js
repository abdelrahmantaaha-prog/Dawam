/* The number this file computes is the one a person acts on, so the thing most
   worth pinning down is that it divides by the SITTINGS that are left, not the
   calendar days. Getting that wrong understates every quota by exactly the
   factor between them, and does it invisibly. */
import { describe, it, expect } from 'vitest';
import { normalizePlan, worksOn, workDaysBetween, loggedOn, todayQuota, dueProjects, splitShare, sittingsFor, sittingStreak, dueSittings, withSittings } from '../src/quota.js';

const d = (iso) => new Date(`${iso}T00:00:00`);
const proj = (over = {}) => ({
  id: 'p1', name: 'The book', target: 100, unit: 'pages',
  startDate: '2026-09-01', deadline: '2026-09-30', entries: [],
  plan: { on: true, days: [], block: 'morning', start: '' },
  ...over,
});

describe('normalizePlan', () => {
  it('fills in the shape from nothing', () => {
    expect(normalizePlan({})).toEqual({ on: false, days: [], block: 'morning', start: '', perDay: null,
      sittings: [{ block: 'morning', start: '' }] });
  });
  it('drops weekdays outside 0..6 and sorts what is left', () => {
    expect(normalizePlan({ plan: { days: [6, 9, 1, -2, 1] } }).days).toEqual([1, 6]);
  });
});

describe('worksOn', () => {
  it('says no while the reminder is off', () => {
    expect(worksOn(proj({ plan: { on: false, days: [] } }), d('2026-09-10'))).toBe(false);
  });
  it('says no without a number to reach', () => {
    expect(worksOn(proj({ target: 0 }), d('2026-09-10'))).toBe(false);
  });
  it('honours the chosen weekdays', () => {
    const p = proj({ plan: { on: true, days: [2, 4] } });   // Tue, Thu
    expect(worksOn(p, d('2026-09-15'))).toBe(true);          // Tuesday
    expect(worksOn(p, d('2026-09-16'))).toBe(false);         // Wednesday
  });
  it('stays quiet outside the project window', () => {
    const p = proj();
    expect(worksOn(p, d('2026-08-31'))).toBe(false);         // before the start
    expect(worksOn(p, d('2026-10-01'))).toBe(false);         // after the deadline
    expect(worksOn(p, d('2026-09-30'))).toBe(true);          // the deadline itself counts
  });
});

describe('workDaysBetween', () => {
  it('counts inclusively', () => {
    expect(workDaysBetween(d('2026-09-14'), d('2026-09-14'), [])).toBe(1);
    expect(workDaysBetween(d('2026-09-14'), d('2026-09-20'), [])).toBe(7);
  });
  it('counts only the chosen weekdays', () => {
    // Mon 14th → Sun 20th, working Tue and Thu: two sittings.
    expect(workDaysBetween(d('2026-09-14'), d('2026-09-20'), [2, 4])).toBe(2);
  });
  it('is zero when the range runs backwards', () => {
    expect(workDaysBetween(d('2026-09-20'), d('2026-09-14'), [])).toBe(0);
  });
  it('estimates rather than looping forever on an absurd deadline', () => {
    const n = workDaysBetween(d('2026-09-14'), d('2126-09-14'), [1]);
    expect(n).toBeGreaterThan(5000);
    expect(Number.isFinite(n)).toBe(true);
  });
});

describe('todayQuota', () => {
  it('divides the remainder by the sittings that are left, not the days', () => {
    // Tue 15th, working Tue and Thu only, deadline Wed 30th.
    // Sittings from the 15th: 15,17,22,24,29 → 5. 100 pages ÷ 5 = 20.
    const p = proj({ plan: { on: true, days: [2, 4] } });
    expect(todayQuota(p, d('2026-09-15')).need).toBe(20);
    // The same project judged on calendar days would have said 100/16 = 7 —
    // which is the bug this whole module exists to avoid.
  });
  it('counts today as a sitting', () => {
    const p = proj({ deadline: '2026-09-15', plan: { on: true, days: [] } });
    expect(todayQuota(p, d('2026-09-15')).need).toBe(100);   // one day left: all of it
  });
  it('subtracts what is already logged from the total, and reports today separately', () => {
    const p = proj({
      plan: { on: true, days: [] },
      entries: [
        { id: 'e1', date: '2026-09-14', amount: 40 },
        { id: 'e2', date: '2026-09-15', amount: 6 },
      ],
    });
    const q = todayQuota(p, d('2026-09-15'));
    expect(q.total).toBe(46);
    expect(q.remaining).toBe(54);
    expect(q.done).toBe(6);
  });
  it('rounds up, because a third of a page is still a page to open', () => {
    const p = proj({ target: 10, deadline: '2026-09-18', plan: { on: true, days: [] } });
    // 15th→18th is 4 days, 10 ÷ 4 = 2.5
    expect(todayQuota(p, d('2026-09-15')).need).toBe(3);
  });
  it('is met once the day\'s share is logged', () => {
    const p = proj({
      target: 10, deadline: '2026-09-18', plan: { on: true, days: [] },
      entries: [{ id: 'e1', date: '2026-09-15', amount: 3 }],
    });
    expect(todayQuota(p, d('2026-09-15')).met).toBe(true);
  });
  it('asks for nothing once the target is reached', () => {
    const p = proj({ entries: [{ id: 'e1', date: '2026-09-02', amount: 100 }] });
    expect(todayQuota(p, d('2026-09-15')).need).toBe(0);
  });
  it('falls back to a stated daily rate when there is no deadline', () => {
    const p = proj({ deadline: '', plan: { on: true, days: [], perDay: 5 } });
    expect(todayQuota(p, d('2026-09-15')).need).toBe(5);
  });
  it('keeps the day\'s share where it started while the day is logged', () => {
    // 44 pages over 4 days is 11; logging 5 today must not turn it into 39 ÷ 4 = 10.
    const p = proj({ target: 44, deadline: '2026-09-18', entries: [{ date: '2026-09-15', amount: 5 }] });
    expect(todayQuota(p, d('2026-09-15')).need).toBe(11);
  });
  it('has no opinion with neither a deadline nor a rate', () => {
    const p = proj({ deadline: '', plan: { on: true, days: [] } });
    expect(todayQuota(p, d('2026-09-15')).need).toBe(null);
  });
});

describe('loggedOn', () => {
  it('sums only that date', () => {
    const p = proj({ entries: [
      { date: '2026-09-15', amount: 3 },
      { date: '2026-09-15', amount: 4 },
      { date: '2026-09-16', amount: 9 },
    ] });
    expect(loggedOn(p, '2026-09-15')).toBe(7);
  });
});

describe('dueProjects', () => {
  it('drops the ones that have nothing to say today', () => {
    const asking = proj({ id: 'a', plan: { on: true, days: [] } });
    const off = proj({ id: 'b', plan: { on: false, days: [] } });
    const finished = proj({ id: 'c', plan: { on: true, days: [] }, entries: [{ date: '2026-09-02', amount: 100 }] });
    const list = dueProjects([asking, off, finished], d('2026-09-15'));
    expect(list.map((x) => x.project.id)).toEqual(['a']);
  });
  it('skips a completed project even when its plan is on', () => {
    const p = proj({ completedAt: Date.now(), plan: { on: true, days: [] } });
    expect(dueProjects([p], d('2026-09-15'))).toEqual([]);
  });
  it('orders by the block the work is meant to happen in', () => {
    const evening = proj({ id: 'e', plan: { on: true, days: [], block: 'isha' } });
    const morning = proj({ id: 'm', plan: { on: true, days: [], block: 'fajr' } });
    const order = (b) => ['fajr', 'morning', 'dhuhr', 'asr', 'maghrib', 'isha'].indexOf(b);
    const list = dueProjects([evening, morning], d('2026-09-15'), { blockOrder: order });
    expect(list.map((x) => x.project.id)).toEqual(['m', 'e']);
  });
});

/* Sittings cut the day's share into chunks. What matters: the pieces add up
   to the share exactly, they are judged against the running total, and a
   missed piece rolls forward instead of vanishing. */
describe('splitShare', () => {
  it('front-loads the remainder and always adds up', () => {
    expect(splitShare(11, 3)).toEqual([4, 4, 3]);
    expect(splitShare(12, 3)).toEqual([4, 4, 4]);
    expect(splitShare(2, 3)).toEqual([1, 1, 0]);
    expect(splitShare(7, 1)).toEqual([7]);
  });
  it('rounds a fractional share up first', () => {
    expect(splitShare(2.5, 2)).toEqual([2, 1]);
  });
});

describe('sittings', () => {
  // 15th→18th is 4 days; 44 pages ÷ 4 = 11 today.
  const SITS = [{ block: 'isha' }, { block: 'fajr', start: '05:00' }, { block: 'dhuhr' }];
  const split = (over = {}) => proj({
    target: 44, deadline: '2026-09-18',
    plan: { on: true, days: [], sittings: SITS },
    ...over,
  });
  const on15 = (p) => sittingsFor(p, todayQuota(p, d('2026-09-15')));
  const log = (amount, sitting, date = '2026-09-15') => ({ id: `${date}-${sitting || 'free'}-${amount}`, date, amount, ...(sitting ? { sitting } : {}) });

  it('keeps the old single-period shape when none are given', () => {
    expect(normalizePlan(proj({ plan: { on: true, block: 'asr', start: '16:00' } })).sittings)
      .toEqual([{ block: 'asr', start: '16:00' }]);
  });
  it('sorts sittings by period and mirrors the first into block/start', () => {
    const pl = normalizePlan(split());
    expect(pl.sittings.map((s) => s.block)).toEqual(['fajr', 'dhuhr', 'isha']);
    expect(pl.block).toBe('fajr');
    expect(pl.start).toBe('05:00');
    const stored = withSittings({ on: true }, [{ block: 'isha', start: '' }, { block: 'morning', start: '09:00' }]);
    expect(stored.block).toBe('morning');
    expect(stored.start).toBe('09:00');
  });
  it('gives each sitting its piece and a stable key', () => {
    const s = on15(split());
    expect(s.map((x) => x.amount)).toEqual([4, 4, 3]);
    expect(s.map((x) => x.key)).toEqual(['fajr@05:00', 'dhuhr@', 'isha@']);
    expect(s.every((x) => !x.met && !x.ticked)).toBe(true);
  });
  it('a tick keeps its own sitting, not the first one — like ticking one habit', () => {
    const s = on15(split({ entries: [log(4, 'dhuhr@')] }));
    expect(s.map((x) => x.met)).toEqual([false, true, false]);
    expect(s[1].ticked).toBe(true);
  });
  it('progress logged by hand fills the sittings in order', () => {
    const s = on15(split({ entries: [log(5)] }));
    expect(s.map((x) => x.got)).toEqual([4, 1, 0]);
    expect(s.map((x) => x.met)).toEqual([true, false, false]);
    expect(s[0].ticked).toBe(false);   // kept, but there is no tick to undo
  });
  it('a sitting ticked past its piece passes the rest on', () => {
    const s = on15(split({ entries: [log(9, 'isha@')] }));
    expect(s.map((x) => x.got)).toEqual([4, 2, 3]);
  });
  it('the day\'s pieces do not move as they are ticked', () => {
    const s = on15(split({ entries: [log(4, 'fajr@05:00'), log(4, 'dhuhr@')] }));
    expect(s.map((x) => x.amount)).toEqual([4, 4, 3]);
    expect(s.map((x) => x.met)).toEqual([true, true, false]);
  });
  it('lists what a date asks for, one line per sitting with a piece', () => {
    const list = dueSittings([split(), split({ id: 'p2', target: 8 })], d('2026-09-15'));
    // The second project asks 2 pages over three sittings: 1, 1, and nothing at Isha.
    expect(list.map((x) => `${x.project.id}:${x.sitting.key}:${x.sitting.amount}`))
      .toEqual(['p1:fajr@05:00:4', 'p1:dhuhr@:4', 'p1:isha@:3', 'p2:fajr@05:00:1', 'p2:dhuhr@:1']);
  });
  it('leaves projects with no number to divide out of the habit lines', () => {
    expect(dueSittings([split({ deadline: '' })], d('2026-09-15'))).toEqual([]);
  });
});

describe('sittingStreak', () => {
  // A page a day from `start` to the 30th, one sitting. Falling behind raises
  // the next day's piece, so each kept day has to meet the piece it was given.
  const daily = (entries, start) => proj({
    target: 31 - Number(start.slice(8)), startDate: start, deadline: '2026-09-30', entries,
    plan: { on: true, days: [], sittings: [{ block: 'fajr' }] },
  });
  const kept = (date, amount = 1) => ({ id: date, date, amount, sitting: 'fajr@' });
  it('counts the days in a row the sitting was kept', () => {
    const p = daily([kept('2026-09-12'), kept('2026-09-13'), kept('2026-09-14'), kept('2026-09-15')], '2026-09-12');
    expect(sittingStreak(p, 'fajr@', d('2026-09-15'))).toBe(4);
  });
  it('does not break on an open today — the chain is judged from yesterday', () => {
    const p = daily([kept('2026-09-13'), kept('2026-09-14')], '2026-09-13');
    expect(sittingStreak(p, 'fajr@', d('2026-09-15'))).toBe(2);
  });
  it('a missed day ends the chain', () => {
    // The 13th is missed, so the 14th asks for two.
    const p = daily([kept('2026-09-11'), kept('2026-09-12'), kept('2026-09-14', 2)], '2026-09-11');
    expect(sittingStreak(p, 'fajr@', d('2026-09-15'))).toBe(1);
  });
  it('steps over the days the project is not worked on', () => {
    // Worked Tue and Thu: Thu 10th, Tue 15th — the Wed and the weekend between
    // are not misses. 30 pages over the six sittings from the 10th is 5 each.
    const p = proj({
      target: 30, startDate: '2026-09-01', deadline: '2026-09-30',
      entries: [{ id: 'a', date: '2026-09-10', amount: 5, sitting: 'fajr@' }, { id: 'b', date: '2026-09-15', amount: 5, sitting: 'fajr@' }],
      plan: { on: true, days: [2, 4], sittings: [{ block: 'fajr' }] },
    });
    expect(sittingStreak(p, 'fajr@', d('2026-09-15'))).toBe(2);
  });
});
