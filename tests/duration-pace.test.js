/* A duration said outright on a task, and the on-pace verdict Plan and Now
   show for numbered goals. */

import { describe, it, expect } from 'vitest';
import { DEFAULT_TIMINGS, estimateMinutes, structureDay, taskDuration } from '../src/core.jsx';
import { paceStatus } from '../src/quota.js';

const T = DEFAULT_TIMINGS; // Fajr 04:15, Sunrise 05:50, Dhuhr 12:55 …

describe('task duration', () => {
  it('beats the remembered or AI estimate and the heuristic', () => {
    expect(estimateMinutes({ duration: 40, est: 90, subtasks: [1, 2, 3] })).toBe(40);
    expect(estimateMinutes({ est: 90 })).toBe(90);
    expect(estimateMinutes({ subtasks: [] })).toBe(25);
  });

  it('is floored at the ten-minute slot and capped at eight hours', () => {
    expect(estimateMinutes({ duration: 3 })).toBe(10);
    expect(taskDuration({ duration: 9999 })).toBe(480);
  });

  it('reads empty, zero and junk as "not set"', () => {
    expect(taskDuration({})).toBeNull();
    expect(taskDuration({ duration: '' })).toBeNull();
    expect(taskDuration({ duration: 0 })).toBeNull();
    expect(taskDuration({ duration: 'soon' })).toBeNull();
    expect(taskDuration({ duration: '45' })).toBe(45);
  });

  it('sizes the slot Slot the day gives', () => {
    const mk = (id, extra = {}) => ({ id, title: id, block: 'morning', done: false, subtasks: [], ...extra });
    const r = structureDay([mk('a', { duration: 70 }), mk('b')], T, null);
    expect(r.slots.find((s) => s.id === 'a')).toMatchObject({ start: '05:50', end: '07:00' });
    expect(r.slots.find((s) => s.id === 'b')).toMatchObject({ start: '07:00', end: '07:25' });
  });

  it('gives a start-only task its end', () => {
    const r = structureDay([{ id: 'x', title: 'x', block: 'morning', start: '09:00', duration: 50, done: false, subtasks: [] }], T, null);
    expect(r.slots.find((s) => s.id === 'x')).toMatchObject({ start: '09:00', end: '09:50' });
  });
});

describe('paceStatus', () => {
  const p = { target: 100 };
  const pace = (over) => ({ done: 0, expected: 0, onPace: null, notStarted: false, remaining: 100, ...over });

  it('has nothing to say without a numeric target or a line to measure against', () => {
    expect(paceStatus({ target: 0 }, pace({})).key).toBe('unknown');
    expect(paceStatus(p, pace({ onPace: null, expected: null })).key).toBe('unknown');
  });

  it('knows done, waiting, on, ahead', () => {
    expect(paceStatus({ ...p, completedAt: '2026-09-01' }, pace({})).key).toBe('done');
    expect(paceStatus(p, pace({ remaining: 0, done: 100 })).key).toBe('done');
    expect(paceStatus(p, pace({ notStarted: true, onPace: true })).key).toBe('waiting');
    expect(paceStatus(p, pace({ done: 40, expected: 40, onPace: true })).key).toBe('on');
    const ahead = paceStatus(p, pace({ done: 46, expected: 40, onPace: true }));
    expect(ahead).toEqual({ key: 'ahead', gap: 6 });
  });

  it('splits behind from far behind at an eighth of the target', () => {
    expect(paceStatus(p, pace({ done: 30, expected: 40, onPace: false }))).toEqual({ key: 'behind', gap: -10 });
    expect(paceStatus(p, pace({ done: 20, expected: 40, onPace: false })).key).toBe('far');
  });
});
