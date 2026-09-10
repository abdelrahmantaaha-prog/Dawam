/* A lock that fires on an empty day is punishing someone for being finished,
   and a lock that only a big task can clear is a lock that gets solved by
   force-quitting the app. Those two are the ones worth pinning. */
import { describe, it, expect } from 'vitest';
import { DEFAULT_EVERY_MIN, lockEvery, lockOn, lockDue, minutesToLock } from '../src/nowlock.js';

const MIN = 60000;
const T0 = 1_700_000_000_000;
const on = (everyMin = 15) => ({ nowLock: { on: true, everyMin } });

describe('lockEvery', () => {
  it('defaults to fifteen', () => {
    expect(lockEvery({})).toBe(DEFAULT_EVERY_MIN);
    expect(lockEvery(undefined)).toBe(15);
    expect(lockEvery({ nowLock: { on: true } })).toBe(15);
  });
  it('clamps an interval that would fire on every tick, or never', () => {
    expect(lockEvery(on(0))).toBe(15);
    expect(lockEvery(on(-5))).toBe(1);
    expect(lockEvery(on(9999))).toBe(240);
  });
});

describe('lockOn', () => {
  it('is off unless it was asked for', () => {
    expect(lockOn(undefined)).toBe(false);
    expect(lockOn({})).toBe(false);
    expect(lockOn({ nowLock: { on: false, everyMin: 15 } })).toBe(false);
    expect(lockOn(on())).toBe(true);
  });
});

describe('lockDue', () => {
  it('fires once the interval has passed with nothing finished', () => {
    expect(lockDue({ settings: on(15), since: T0, now: T0 + 14 * MIN, pending: 3 })).toBe(false);
    expect(lockDue({ settings: on(15), since: T0, now: T0 + 15 * MIN, pending: 3 })).toBe(true);
    expect(lockDue({ settings: on(15), since: T0, now: T0 + 90 * MIN, pending: 3 })).toBe(true);
  });
  it('never fires while the switch is off', () => {
    expect(lockDue({ settings: { nowLock: { on: false, everyMin: 15 } }, since: T0, now: T0 + 99 * MIN, pending: 3 })).toBe(false);
  });
  it('never fires on a day with nothing left to do', () => {
    // Locking someone out of a finished day is punishing them for finishing it.
    expect(lockDue({ settings: on(15), since: T0, now: T0 + 99 * MIN, pending: 0 })).toBe(false);
  });
  it('runs from the last completion, so a productive stretch is never cut into', () => {
    const since = T0 + 40 * MIN;                    // something was finished at +40
    expect(lockDue({ settings: on(15), since, now: T0 + 50 * MIN, pending: 2 })).toBe(false);
    expect(lockDue({ settings: on(15), since, now: T0 + 56 * MIN, pending: 2 })).toBe(true);
  });
  it('answers false rather than throwing on missing clocks', () => {
    expect(lockDue({ settings: on(15), since: null, now: T0, pending: 3 })).toBe(false);
    expect(lockDue({ settings: on(15), since: T0, now: undefined, pending: 3 })).toBe(false);
  });
});

describe('minutesToLock', () => {
  it('counts down in whole minutes', () => {
    expect(minutesToLock({ settings: on(15), since: T0, now: T0, pending: 2 })).toBe(15);
    expect(minutesToLock({ settings: on(15), since: T0, now: T0 + 10 * MIN, pending: 2 })).toBe(5);
    expect(minutesToLock({ settings: on(15), since: T0, now: T0 + 14.5 * MIN, pending: 2 })).toBe(1);
  });
  it('says nothing when it is off, already due, or the day is clear', () => {
    expect(minutesToLock({ settings: on(15), since: T0, now: T0 + 15 * MIN, pending: 2 })).toBe(null);
    expect(minutesToLock({ settings: on(15), since: T0, now: T0, pending: 0 })).toBe(null);
    expect(minutesToLock({ settings: {}, since: T0, now: T0, pending: 2 })).toBe(null);
  });
});
