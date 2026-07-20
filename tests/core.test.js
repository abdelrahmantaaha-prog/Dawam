/* Unit tests for Rhythm's pure core logic — the functions that carry the
   app's correctness: block resolution, project pace, habit streaks. */
import { describe, it, expect } from 'vitest';
import {
  activeBlockAt, projectPace, habitStreak, habitDoneOn, glowLevel,
  fmtISO, addDays, startOfWeek, DEFAULT_TIMINGS, migrateSettings, inWindow,
  hasVault, vaultWindowed, vaultUnlocked,
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
