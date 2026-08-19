/* Unit tests for Rhythm's pure core logic — the functions that carry the
   app's correctness: block resolution, project pace, habit streaks. */
import { describe, it, expect } from 'vitest';
import {
  activeBlockAt, projectPace, habitStreak, habitDoneOn, glowLevel,
  fmtISO, addDays, startOfWeek, DEFAULT_TIMINGS, migrateSettings, inWindow,
  hasVault, vaultWindowed, vaultUnlocked, pushToToday, structureDay, estimateMinutes, taskTextSig, sleepPlan, POINTS, autoWorth, taskWorth,
  shares, subtaskWorth, latePay, habitLevel, habitMultiplier, habitWorth,
} from '../src/core.jsx';

const T = DEFAULT_TIMINGS; // Fajr 04:15, Sunrise 05:50, Dhuhr 12:55, Asr 16:30, Maghrib 19:45, Isha 21:15
const min = (h, m = 0) => h * 60 + m;
const isoOffset = (days) => fmtISO(addDays(new Date(), days));

describe('activeBlockAt — the day skeleton', () => {
  it('maps each period correctly', () => {
    expect(activeBlockAt(T, min(4, 30))).toBe('fajr');
    expect(activeBlockAt(T, min(9))).toBe('morning');
    expect(activeBlockAt(T, min(13, 30))).toBe('dhuhr');
    expect(activeBlockAt(T, min(17))).toBe('asr');
    expect(activeBlockAt(T, min(20))).toBe('maghrib');
    expect(activeBlockAt(T, min(22))).toBe('isha');
  });
  it('after midnight but before Fajr is still (overnight) Isha', () => {
    expect(activeBlockAt(T, min(1, 30))).toBe('isha');
    expect(activeBlockAt(T, min(4, 14))).toBe('isha');
  });
  it('boundaries: block starts exactly at its prayer time', () => {
    expect(activeBlockAt(T, min(4, 15))).toBe('fajr');
    expect(activeBlockAt(T, min(12, 55))).toBe('dhuhr');
    expect(activeBlockAt(T, min(21, 15))).toBe('isha');
  });
  it('degrades to morning when timings are missing', () => {
    expect(activeBlockAt({}, min(10))).toBe('morning');
  });
});

describe('inWindow — handles overnight ranges', () => {
  it('normal window', () => { expect(inWindow(600, 700, 650)).toBe(true); expect(inWindow(600, 700, 750)).toBe(false); });
  it('overnight window wraps past midnight', () => {
    expect(inWindow(1275, 255, 60)).toBe(true);   // 21:15 → 04:15, 01:00 is inside
    expect(inWindow(1275, 255, 600)).toBe(false); // 10:00 is outside
  });
});

describe('projectPace — start-date-aware pace', () => {
  const mk = (startOff, endOff, target, done) => ({
    startDate: isoOffset(startOff), deadline: isoOffset(endOff), target,
    entries: done ? [{ id: 'e', date: isoOffset(-1), amount: done }] : [],
  });
  it('halfway through time with 10% done is behind, expected = 50%', () => {
    const p = projectPace(mk(-30, 30, 100, 10));
    expect(p.onPace).toBe(false);
    expect(Math.round(p.expected)).toBe(50);
  });
  it('ahead of the time-elapsed fraction is on pace', () => {
    const p = projectPace(mk(-10, 30, 100, 30)); // 25% elapsed, 30 done
    expect(p.onPace).toBe(true);
    expect(Math.round(p.expected)).toBe(25);
  });
  it('a future start reads as not started, never behind', () => {
    const p = projectPace(mk(10, 40, 100, 0));
    expect(p.notStarted).toBe(true);
    expect(p.onPace).toBe(true);
    expect(p.expected).toBe(0);
  });
  it('needed daily rate for a future start runs from the start date, not today', () => {
    // starts in 10 days, ends in 40 → the working window is 30 days, so 100 units ≈ 3.33/day (not 100/40 = 2.5)
    const p = projectPace(mk(10, 40, 100, 0));
    expect(p.perDay).toBeGreaterThan(3.2);
    expect(p.perDay).toBeLessThan(3.5);
  });
  it('no numeric target → pace fields stay null (milestone mode)', () => {
    const p = projectPace({ startDate: isoOffset(-10), deadline: isoOffset(20), target: 0, entries: [] });
    expect(p.onPace).toBe(null);
    expect(p.perDay).toBe(null);
    expect(p.daysLeft).toBe(20);
  });
  it('no deadline → pace fields stay null, progress still computed', () => {
    const p = projectPace({ startDate: isoOffset(-5), deadline: '', target: 100, entries: [{ id: 'e', date: isoOffset(-1), amount: 40 }] });
    expect(p.onPace).toBe(null);
    expect(p.done).toBe(40);
    expect(p.pct).toBeCloseTo(0.4);
  });
});

describe('habitStreak — consecutive days, tolerant of an unchecked today', () => {
  const habit = (log) => ({ log });
  const today = isoOffset(0);
  it('counts a run ending today', () => {
    const h = habit({ [isoOffset(0)]: 1, [isoOffset(-1)]: 1, [isoOffset(-2)]: 1 });
    expect(habitStreak(h, today)).toBe(3);
  });
  it("today unchecked doesn't zero the streak — it runs to yesterday", () => {
    const h = habit({ [isoOffset(-1)]: 1, [isoOffset(-2)]: 1 });
    expect(habitStreak(h, today)).toBe(2);
  });
  it('a gap resets the streak', () => {
    const h = habit({ [isoOffset(0)]: 1, [isoOffset(-2)]: 1, [isoOffset(-3)]: 1 });
    expect(habitStreak(h, today)).toBe(1);
  });
  it('empty log = no streak', () => {
    expect(habitStreak(habit({}), today)).toBe(0);
  });
  it('habitDoneOn reads the log per ISO day', () => {
    const h = habit({ [today]: 1 });
    expect(habitDoneOn(h, today)).toBe(true);
    expect(habitDoneOn(h, isoOffset(-1))).toBe(false);
  });
});

describe('glowLevel — caps at seven', () => {
  it('clamps 0..7', () => {
    expect(glowLevel(0)).toBe(0);
    expect(glowLevel(3)).toBe(3);
    expect(glowLevel(7)).toBe(7);
    expect(glowLevel(45)).toBe(7);
    expect(glowLevel(-2)).toBe(0);
  });
});

describe('migrateSettings — old data is upgraded, never dropped', () => {
  it('fills habits/pin/apiKey defaults on a v1.0-era object', () => {
    const m = migrateSettings({ lang: 'ar', projects: [{ id: 'x' }] });
    expect(m.habits).toEqual([]);
    expect(m.pin).toBe(null);
    expect(m.apiKey).toBe('');
    expect(m.lang).toBe('ar');
  });
  it('null input yields complete defaults', () => {
    const m = migrateSettings(null);
    expect(Array.isArray(m.labels)).toBe(true);
    expect(m.prayer && m.prayer.customTimes).toBeTruthy();
  });
});

describe('date helpers', () => {
  it('startOfWeek respects a Saturday start (Egypt/Gulf)', () => {
    const wed = new Date('2026-07-08T12:00:00'); // a Wednesday
    const ws = startOfWeek(wed, 6);
    expect(ws.getDay()).toBe(6); // Saturday
    expect(ws <= wed).toBe(true);
  });
});

/* The time vault: readable only inside its own start–end window. */
describe('time vault', () => {
  const vault = (start, end, secret = 'hunter2') => ({ start, end, secret });
  const at = (h, m = 0) => h * 60 + m;

  it('needs a non-empty secret to be a vault at all', () => {
    expect(hasVault(vault('19:00', '20:00'))).toBe(true);
    expect(hasVault({ start: '19:00', end: '20:00' })).toBe(false);
    expect(hasVault({ start: '19:00', end: '20:00', secret: '' })).toBe(false);
  });

  it('needs BOTH ends of a window, or it could never re-lock', () => {
    expect(vaultWindowed(vault('19:00', '20:00'))).toBe(true);
    expect(vaultWindowed(vault('19:00', ''))).toBe(false);   // open-ended = never re-locks
    expect(vaultWindowed(vault('', ''))).toBe(false);
  });

  it('unlocks only inside the window', () => {
    const v = vault('19:00', '20:00');
    expect(vaultUnlocked(v, at(18, 59))).toBe(false);
    expect(vaultUnlocked(v, at(19, 0))).toBe(true);   // inclusive start
    expect(vaultUnlocked(v, at(19, 30))).toBe(true);
    expect(vaultUnlocked(v, at(20, 0))).toBe(false);  // exclusive end
    expect(vaultUnlocked(v, at(23, 0))).toBe(false);
    expect(vaultUnlocked(v, at(3, 0))).toBe(false);
  });

  it('handles a window that wraps past midnight', () => {
    const v = vault('23:00', '01:00');
    expect(vaultUnlocked(v, at(23, 30))).toBe(true);
    expect(vaultUnlocked(v, at(0, 30))).toBe(true);
    expect(vaultUnlocked(v, at(1, 0))).toBe(false);
    expect(vaultUnlocked(v, at(12, 0))).toBe(false);
  });

  it('a secret with no window never unlocks', () => {
    expect(vaultUnlocked(vault('19:00', ''), at(19, 30))).toBe(false);
  });
});

/* The vault's window is fixed once set: times may only be changed while the
   window is open, so they are effectively chosen at creation. This mirrors
   TaskEditor's `vaultLocksTime`. */
describe('time vault — window is fixed once set', () => {
  const locksTime = (t, curMin) => hasVault(t) && vaultWindowed(t) && !vaultUnlocked(t, curMin);
  const v = { start: '22:00', end: '22:30', secret: 's' };
  const at = (h, m = 0) => h * 60 + m;

  it('locks the times while shut', () => {
    expect(locksTime(v, at(15))).toBe(true);
    expect(locksTime(v, at(21, 59))).toBe(true);
  });

  it('frees the times only inside the window', () => {
    expect(locksTime(v, at(22, 0))).toBe(false);
    expect(locksTime(v, at(22, 15))).toBe(false);
    expect(locksTime(v, at(22, 30))).toBe(true); // window closed again
  });

  it('a task with no secret is never time-locked', () => {
    expect(locksTime({ start: '22:00', end: '22:30' }, at(15))).toBe(false);
  });

  it('a secret with no window stays editable, or it could never be given one', () => {
    // The trap this guards: lock on hasVault alone and a secret saved before
    // any times were set can never get a window, so it can never unlock.
    expect(locksTime({ secret: 's', start: '', end: '' }, at(15))).toBe(false);
    expect(locksTime({ secret: 's', start: '22:00', end: '' }, at(15))).toBe(false);
  });
});

describe('pushToToday — where an overdue task lands', () => {
  // Fajr 04:15. The scan measures the day from Fajr, so these tests speak the
  // same language: minutes since Fajr, wrapping past midnight.
  const fajr = min(4, 15);
  const sinceFajr = (m) => (((m - fajr) % 1440) + 1440) % 1440;
  const ctx = (activeBlock, curMin) => ({ activeBlock, curSinceFajr: sinceFajr(curMin), sinceFajr });

  it('drags a block that has already passed up to the one in progress', () => {
    const t = { block: 'fajr', title: 'x' };
    expect(pushToToday(t, ctx('asr', min(17))).block).toBe('asr');
  });

  it('leaves a block that is still ahead alone', () => {
    // The plan for tonight is still the plan — only the date was wrong.
    expect(pushToToday({ block: 'isha' }, ctx('asr', min(17))).block).toBe('isha');
    expect(pushToToday({ block: 'asr' }, ctx('asr', min(17))).block).toBe('asr');
  });

  it('clears a start/end window that today has already gone past', () => {
    const out = pushToToday({ block: 'morning', start: '09:00', end: '10:00' }, ctx('asr', min(17)));
    expect(out.start).toBe('');
    expect(out.end).toBe('');
    expect(out.time).toBe('');
    expect(out.block).toBe('asr');
  });

  it('keeps a window that is still to come today', () => {
    const out = pushToToday({ block: 'isha', start: '22:00', end: '23:00' }, ctx('asr', min(17)));
    expect(out.start).toBe('22:00');
    expect(out.end).toBe('23:00');
  });

  it('clears a passed start-only time too', () => {
    expect(pushToToday({ block: 'morning', start: '09:00' }, ctx('asr', min(17))).start).toBe('');
  });

  it('also clears a passed window written in the old free-text field', () => {
    expect(pushToToday({ block: 'morning', time: '9:00-10:00am' }, ctx('asr', min(17))).time).toBe('');
  });

  it('never strips a vault window, however long past it is', () => {
    // Clearing it would leave the secret readable at any hour, which is the
    // one thing the vault exists to prevent.
    const v = { block: 'maghrib', start: '19:00', end: '20:00', secret: 'hunter2' };
    const out = pushToToday(v, ctx('fajr', min(5)));
    expect(out.start).toBe('19:00');
    expect(out.end).toBe('20:00');
    expect(out.secret).toBe('hunter2');
  });

  it('treats the pre-dawn hours as the end of the day that is finishing', () => {
    // 01:00 is Isha on the Fajr-anchored clock — nearly 21 hours in, not 1.
    const out = pushToToday({ block: 'morning', start: '09:00', end: '10:00' }, ctx('isha', min(1)));
    expect(out.start).toBe('');
    expect(out.block).toBe('isha');
  });

  it('does not mutate the task it is given', () => {
    const t = { block: 'fajr', start: '09:00', end: '10:00' };
    pushToToday(t, ctx('asr', min(17)));
    expect(t).toEqual({ block: 'fajr', start: '09:00', end: '10:00' });
  });
});

describe('points — what a task is worth', () => {
  it('a bare task is base plus the untimed allowance', () => {
    expect(autoWorth({ title: 'x' })).toBe(POINTS.base + POINTS.untimed);
  });

  it('reads size off a real start/end window', () => {
    // 90 minutes = 6 quarter hours.
    expect(autoWorth({ start: '09:00', end: '10:30' })).toBe(POINTS.base + 6);
  });

  it('caps size so an all-day block cannot dominate', () => {
    expect(autoWorth({ start: '06:00', end: '22:00' })).toBe(POINTS.base + POINTS.sizeCap);
  });

  it('measures a window that crosses midnight the short way round', () => {
    expect(autoWorth({ start: '23:00', end: '00:30' })).toBe(POINTS.base + 6);
  });

  it('pays for decomposition, up to a cap', () => {
    const subs = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: 's' }));
    expect(autoWorth({ subtasks: subs(3) })).toBe(POINTS.base + POINTS.untimed + 15);
    expect(autoWorth({ subtasks: subs(99) })).toBe(POINTS.base + POINTS.untimed + POINTS.subtaskCap);
  });

  it('pays more for a task you keep pushing, up to a cap', () => {
    const at = (n) => autoWorth({ pushes: n });
    expect(at(0)).toBe(POINTS.base + POINTS.untimed);
    expect(at(2)).toBe(POINTS.base + POINTS.untimed + 10);
    expect(at(50)).toBe(POINTS.base + POINTS.untimed + POINTS.pushCap);
  });

  it('ignores a nonsense push count instead of paying out for it', () => {
    expect(autoWorth({ pushes: -5 })).toBe(POINTS.base + POINTS.untimed);
    expect(autoWorth({ pushes: 'lots' })).toBe(POINTS.base + POINTS.untimed);
  });

  it('an explicit worth overrides the reading, and a bad one does not', () => {
    expect(taskWorth({ worth: 250, pushes: 0 })).toBe(250);
    expect(taskWorth({ worth: 0 })).toBe(0);
    expect(taskWorth({ worth: -3 })).toBe(autoWorth({ worth: -3 }));
    expect(taskWorth({ worth: '' })).toBe(autoWorth({}));
    expect(taskWorth({ worth: 'free' })).toBe(autoWorth({}));
  });
});

describe('points — splitting across steps', () => {
  it('the parts always sum to the whole', () => {
    for (const total of [10, 35, 37, 75, 1]) {
      for (const n of [1, 2, 3, 4, 7]) {
        expect(shares(total, n).reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });

  it('gives the remainder to the last steps, so finishing pays slightly more', () => {
    expect(shares(10, 3)).toEqual([3, 3, 4]);
  });

  it('subtaskWorth picks the right slice, and nothing for a stranger', () => {
    const t = { subtasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }; // worth 10+5+15 = 30
    expect(taskWorth(t)).toBe(30);
    expect([0, 1, 2].map((i) => subtaskWorth(t, 'abc'[i]))).toEqual([10, 10, 10]);
    expect(subtaskWorth(t, 'nope')).toBe(0);
  });

  it('late pays half, and never rounds a real reward down to nothing', () => {
    expect(latePay(30)).toBe(15);
    expect(latePay(1)).toBe(1);
    expect(latePay(0)).toBe(0);
  });
});

describe('points — habit streak multiplier', () => {
  const habit = (isos) => ({ id: 'h', createdAt: isoOffset(-40), log: Object.fromEntries(isos.map((i) => [i, 1])) });
  const day = (n) => isoOffset(n);

  it('a brand-new habit pays flat', () => {
    expect(habitLevel(habit([]), day(0))).toBe(0);
    expect(habitMultiplier(0)).toBe(1);
  });

  it('climbs one step per kept day and caps at 2x', () => {
    const kept = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => day(-n));
    expect(habitLevel(habit(kept), day(0))).toBe(5);
    expect(habitMultiplier(5)).toBe(2);
    expect(habitMultiplier(99)).toBe(2);       // cap holds however long the run
  });

  it('a missed day costs ONE step, not the whole streak', () => {
    // This is the whole point of the rule: four kept days then one miss should
    // leave you where day three was, not back at the start.
    const kept = [day(-5), day(-4), day(-3), day(-2)]; // yesterday missed
    expect(habitLevel(habit(kept), day(0))).toBe(3);
  });

  it('never goes below zero however long you have been away', () => {
    expect(habitLevel(habit([]), day(0))).toBe(0);
  });

  it('does not count the day being awarded towards its own multiplier', () => {
    const today = day(0);
    expect(habitLevel(habit([today]), today)).toBe(0);
  });

  it('worth follows the level', () => {
    const kept = [1, 2, 3, 4, 5].map((n) => day(-n));
    expect(habitWorth(habit([]), day(0))).toBe(POINTS.habit);
    expect(habitWorth(habit(kept), day(0))).toBe(POINTS.habit * 2);
  });
});

describe('structureDay — strict slots from what is logged', () => {
  // DEFAULT_TIMINGS: Fajr 04:15, Sunrise 05:50, Dhuhr 12:55, Asr 16:30,
  // Maghrib 19:45, Isha 21:15.
  const mk = (id, block, extra = {}) => ({ id, title: id, block, done: false, subtasks: [], ...extra });
  const slotOf = (r, id) => r.slots.find((s) => s.id === id);

  it('packs untimed tasks back to back from the start of their block', () => {
    const r = structureDay([mk('a', 'morning'), mk('b', 'morning')], T, null);
    expect(slotOf(r, 'a')).toMatchObject({ start: '05:50', end: '06:15' }); // 25 min base
    expect(slotOf(r, 'b')).toMatchObject({ start: '06:15', end: '06:40' });
    expect(r.unplaced).toEqual([]);
  });

  it('starts from NOW inside the current block, not from its beginning', () => {
    const r = structureDay([mk('a', 'morning')], T, min(9, 0));
    expect(slotOf(r, 'a')).toMatchObject({ start: '09:00', end: '09:25' });
  });

  it('skips blocks that are already over — those tasks belong to Overdue', () => {
    const r = structureDay([mk('a', 'fajr')], T, min(9, 0));
    expect(r.slots).toEqual([]);
  });

  it('sizes a slot from the subtask count, capped', () => {
    const subs = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}` }));
    const r = structureDay([mk('a', 'morning', { subtasks: subs(3) })], T, null);
    expect(slotOf(r, 'a')).toMatchObject({ start: '05:50', end: '06:45' }); // 25+30
    const big = structureDay([mk('b', 'morning', { subtasks: subs(20) })], T, null);
    expect(slotOf(big, 'b')).toMatchObject({ end: '07:20' }); // capped at 90
  });

  it('flows around a manually timed task instead of double-booking it', () => {
    const fixed = mk('fixed', 'morning', { start: '06:00', end: '07:00' });
    const r = structureDay([mk('a', 'morning'), fixed, mk('b', 'morning')], T, null);
    expect(slotOf(r, 'fixed')).toBeUndefined(); // manual times are not touched
    // 05:50–06:00 is only ten minutes — not enough for a full slot, so both
    // land after the fixed hour instead of squeezing before it.
    expect(slotOf(r, 'a')).toMatchObject({ start: '07:00', end: '07:25' });
    expect(slotOf(r, 'b')).toMatchObject({ start: '07:25', end: '07:50' });
    // nothing overlaps the fixed hour
    for (const s of r.slots) {
      const st = min(...s.start.split(':').map(Number)), en = min(...s.end.split(':').map(Number));
      expect(en <= min(6, 0) || st >= min(7, 0)).toBe(true);
    }
  });

  it('keeps a start-only task at its own start and assigns just the end', () => {
    const r = structureDay([mk('pin', 'morning', { start: '08:00' })], T, null);
    expect(slotOf(r, 'pin')).toMatchObject({ start: '08:00', end: '08:25', pinned: true });
  });

  it('shrinks every slot proportionally when the block is oversubscribed', () => {
    // Fajr block is 04:15→05:50 = 95 minutes; four 25-minute tasks want 100.
    const r = structureDay([mk('a', 'fajr'), mk('b', 'fajr'), mk('c', 'fajr'), mk('d', 'fajr')], T, null);
    expect(r.slots).toHaveLength(4);
    expect(r.unplaced).toEqual([]);
    expect(slotOf(r, 'a').start).toBe('04:15');
    // every slot shrank a little; none was silently dropped
    for (const s of r.slots) {
      const dur = min(...s.end.split(':').map(Number)) - min(...s.start.split(':').map(Number));
      expect(dur).toBeGreaterThanOrEqual(10);
      expect(dur).toBeLessThan(25);
    }
  });

  it('reports what genuinely cannot fit rather than slotting a lie', () => {
    // 95-minute Fajr block, twelve tasks: even at the 10-minute floor only
    // nine fit.
    const many = Array.from({ length: 12 }, (_, i) => mk(`t${i}`, 'fajr'));
    const r = structureDay(many, T, null);
    expect(r.slots.length + r.unplaced.length).toBe(12);
    expect(r.unplaced.length).toBeGreaterThan(0);
  });

  it('slots Isha across midnight on the Fajr clock', () => {
    // 23:30, Isha. The window runs to next Fajr; a slot placed now ends past
    // midnight in real clock time.
    const r = structureDay([mk('late', 'isha', { subtasks: [{ id: 's1' }, { id: 's2' }] })], T, min(23, 30));
    expect(slotOf(r, 'late')).toMatchObject({ start: '23:30', end: '00:15' }); // 45 min, wraps
  });

  it('never touches a vault task, and flows around its window', () => {
    const vault = mk('v', 'maghrib', { start: '19:50', end: '20:20', secret: 'x' });
    const r = structureDay([vault, mk('a', 'maghrib')], T, null);
    expect(slotOf(r, 'v')).toBeUndefined();
    expect(slotOf(r, 'a')).toMatchObject({ start: '20:20' }); // 19:45–19:50 is under 25min
  });

  it('ignores done tasks entirely', () => {
    const r = structureDay([mk('d', 'morning', { done: true }), mk('a', 'morning')], T, null);
    expect(slotOf(r, 'd')).toBeUndefined();
    expect(slotOf(r, 'a')).toMatchObject({ start: '05:50' });
  });
});

describe('sleepPlan — cycles counted back from Fajr', () => {
  const FAJR = min(4, 15);

  it('at 21:30, only the bedtimes still ahead survive', () => {
    const p = sleepPlan(min(21, 30), FAJR);
    expect(p.untilFajr).toBe(min(4, 15) + 1440 - min(21, 30));
    // 6 cycles means bed by 19:00 and 5 means 20:30 — both already behind at
    // 21:30, so showing them would be advice about the past.
    expect(p.bedtimes.map((b) => b.cycles)).toEqual([4, 3]);
    expect(p.bedtimes[0].at).toBe(min(22, 0)); // 04:15 − 15m − 6h
    expect(p.bedtimes[1].at).toBe(min(23, 30));
  });

  it('sleeping now: whole cycles only, wake at the boundary', () => {
    const p = sleepPlan(min(23, 0), FAJR);
    // 23:00→04:15 = 315m; minus 15 latency = 300 = 3 cycles + 30m spare.
    expect(p.cyclesIfNow).toBe(3);
    expect(p.alignedWake).toBe(min(3, 45)); // 23:00+15m+270m
  });

  it('pre-dawn: less than a cycle left reads as zero, not a negative', () => {
    const p = sleepPlan(min(3, 30), FAJR);
    expect(p.cyclesIfNow).toBe(0);
    expect(p.alignedWake).toBe(null);
  });

  it('returns null rather than guessing when Fajr is unknown', () => {
    expect(sleepPlan(min(23, 0), null)).toBe(null);
  });
});

describe('estimateMinutes — memory and AI beat the heuristic', () => {
  it('a stored estimate wins over the subtask heuristic', () => {
    expect(estimateMinutes({ title: 'x', est: 40 })).toBe(40);
    expect(estimateMinutes({ title: 'x', est: 40, subtasks: [{}, {}, {}] })).toBe(40);
  });
  it('a person-set long duration round-trips uncut', () => {
    expect(estimateMinutes({ est: 240 })).toBe(240);
  });
  it('junk estimates fall back to the heuristic', () => {
    expect(estimateMinutes({ est: 0 })).toBe(25);      // heuristic base, no subtasks
    expect(estimateMinutes({ est: -5 })).toBe(25);
    expect(estimateMinutes({ est: 'soon' })).toBe(25);
  });
  it('taskTextSig changes when the text changes, and only then', () => {
    const a = taskTextSig({ title: 'Write report', subtasks: [{ title: 'draft' }] });
    expect(taskTextSig({ title: 'Write report', subtasks: [{ title: 'draft' }] })).toBe(a);
    expect(taskTextSig({ title: 'Write REPORT', subtasks: [{ title: 'draft' }] })).not.toBe(a);
    expect(taskTextSig({ title: 'Write report', subtasks: [{ title: 'edit' }] })).not.toBe(a);
  });
  it('structureDay sizes a slot from t.est when present', () => {
    const r = structureDay([{ id: 'a', title: 'a', block: 'morning', done: false, subtasks: [], est: 40 }], T, null);
    expect(r.slots[0]).toMatchObject({ start: '05:50', end: '06:30' });
  });
});

describe('migrateSettings — the Anthropic path is gone', () => {
  it('clears a stranded sk-ant key instead of letting every AI call 401 forever', () => {
    const m = migrateSettings({ apiKey: 'sk-ant-abc123', aiProvider: 'anthropic' });
    expect(m.apiKey).toBe('');
    expect(m.aiProvider).toBeUndefined();
  });
  it('keeps a Gemini key even when the old toggle pointed at Anthropic', () => {
    // The trap this migration heals: right key, wrong toggle, dead features.
    const m = migrateSettings({ apiKey: 'AIzaSyExample', aiProvider: 'anthropic' });
    expect(m.apiKey).toBe('AIzaSyExample');
  });
  it('defaults groqKey and preserves a stored one', () => {
    expect(migrateSettings({}).groqKey).toBe('');
    expect(migrateSettings({ groqKey: 'gsk_x' }).groqKey).toBe('gsk_x');
  });
});
