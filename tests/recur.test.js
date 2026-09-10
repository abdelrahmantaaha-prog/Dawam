/* A recurring task that is offered on days it isn't due is a recurring task
   you learn to dismiss without reading, so the schedule has to be exact — and
   the edge cases here (a half-built schedule, the 31st in February) are the
   ones that decide whether the feature helps or quietly loses work. */
import { describe, it, expect } from 'vitest';
import { DAILY, WEEKLY, MONTHLY, EVERY, normalizeRepeat, dueOn, isScheduled, describeRepeat } from '../src/recur.js';

const d = (iso) => new Date(`${iso}T00:00:00`);

describe('normalizeRepeat', () => {
  it('defaults to daily and empty', () => {
    expect(normalizeRepeat(undefined)).toEqual({ every: DAILY, days: [], dates: [] });
    expect(normalizeRepeat(null)).toEqual({ every: DAILY, days: [], dates: [] });
    expect(normalizeRepeat({ every: 'yearly' }).every).toBe(DAILY);
  });
  it('drops values outside the range and de-duplicates', () => {
    const r = normalizeRepeat({ every: WEEKLY, days: [1, 1, 7, -1, 3, 'x'], dates: [0, 1, 32, 31, 31] });
    expect(r.days).toEqual([1, 3]);
    expect(r.dates).toEqual([1, 31]);
  });
  it('sorts, so two schedules with the same meaning compare equal', () => {
    expect(normalizeRepeat({ every: WEEKLY, days: [5, 0, 2] }).days).toEqual([0, 2, 5]);
  });
  it('names every kind it accepts', () => {
    expect(EVERY).toEqual([DAILY, WEEKLY, MONTHLY]);
  });
});

describe('dueOn — weekly', () => {
  it('fires only on the chosen weekdays', () => {
    const r = { every: WEEKLY, days: [1, 3] };          // Mon, Wed
    expect(dueOn(r, d('2026-09-14'))).toBe(true);        // Monday
    expect(dueOn(r, d('2026-09-16'))).toBe(true);        // Wednesday
    expect(dueOn(r, d('2026-09-15'))).toBe(false);       // Tuesday
    expect(dueOn(r, d('2026-09-20'))).toBe(false);       // Sunday
  });
  it('with nothing picked is due every day, not never', () => {
    // Mid-edit is not a silent stop: a recurrence that vanishes is
    // indistinguishable from one that was deleted.
    const r = { every: WEEKLY, days: [] };
    expect(dueOn(r, d('2026-09-14'))).toBe(true);
    expect(dueOn(r, d('2026-09-15'))).toBe(true);
  });
});

describe('dueOn — monthly', () => {
  it('fires on the chosen dates', () => {
    const r = { every: MONTHLY, dates: [1, 15] };
    expect(dueOn(r, d('2026-09-01'))).toBe(true);
    expect(dueOn(r, d('2026-09-15'))).toBe(true);
    expect(dueOn(r, d('2026-09-14'))).toBe(false);
  });
  it('lands the 31st on the last day of a shorter month', () => {
    const r = { every: MONTHLY, dates: [31] };
    expect(dueOn(r, d('2026-09-30'))).toBe(true);        // September has 30
    expect(dueOn(r, d('2026-09-29'))).toBe(false);
    expect(dueOn(r, d('2026-02-28'))).toBe(true);        // February 2026 has 28
    expect(dueOn(r, d('2026-10-31'))).toBe(true);        // and the real 31st still fires
    expect(dueOn(r, d('2026-10-30'))).toBe(false);
  });
  it('handles a leap February', () => {
    const r = { every: MONTHLY, dates: [30] };
    expect(dueOn(r, d('2028-02-29'))).toBe(true);
    expect(dueOn(r, d('2028-02-28'))).toBe(false);
  });
  it('with nothing picked is due every day', () => {
    expect(dueOn({ every: MONTHLY, dates: [] }, d('2026-09-14'))).toBe(true);
  });
});

describe('dueOn — daily and junk', () => {
  it('is always due', () => {
    expect(dueOn({ every: DAILY }, d('2026-09-14'))).toBe(true);
    expect(dueOn(undefined, d('2026-09-14'))).toBe(true);
  });
  it('answers true rather than throwing on a bad date', () => {
    expect(dueOn({ every: WEEKLY, days: [1] }, new Date('nonsense'))).toBe(true);
    expect(dueOn({ every: WEEKLY, days: [1] }, null)).toBe(true);
  });
});

describe('isScheduled', () => {
  it('is false for daily and for nothing at all', () => {
    expect(isScheduled(undefined)).toBe(false);
    expect(isScheduled({ every: DAILY })).toBe(false);
  });
  it('is true once a kind is chosen', () => {
    expect(isScheduled({ every: WEEKLY, days: [1] })).toBe(true);
    expect(isScheduled({ every: MONTHLY, dates: [1] })).toBe(true);
  });
});

describe('describeRepeat', () => {
  it('names the weekdays', () => {
    expect(describeRepeat({ every: WEEKLY, days: [1, 3] })).toBe('Mon, Wed');
  });
  it('names the dates', () => {
    expect(describeRepeat({ every: MONTHLY, dates: [1, 15] })).toBe('day 1, 15');
  });
  it('falls back to every day', () => {
    expect(describeRepeat({ every: WEEKLY, days: [] })).toBe('every day');
    expect(describeRepeat(undefined)).toBe('every day');
  });
});
