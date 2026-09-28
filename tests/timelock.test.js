/* The time lock: a task with a window is the only thing you can focus on
   while its window is open, and nothing can be focused on it outside it. */
import { describe, it, expect } from 'vitest';
import { timeLockOn, taskWindow, liveTasks, focusVerdict, timeLockDue } from '../src/timelock.js';

const at = (h, m = 0) => h * 60 + m;
const nine = { id: 'a', title: 'Write intro', start: '09:00', end: '10:00' };
const late = { id: 'b', title: 'Night shift', start: '23:00', end: '01:00' };
const loose = { id: 'c', title: 'Tidy desk' };
const startOnly = { id: 'd', title: 'Call', start: '14:00' };

describe('timeLockOn', () => {
  it('is on unless switched off', () => {
    expect(timeLockOn({})).toBe(true);
    expect(timeLockOn(undefined)).toBe(true);
    expect(timeLockOn({ timeLock: false })).toBe(false);
  });
});

describe('taskWindow', () => {
  it('needs both a start and an end', () => {
    expect(taskWindow(nine)).toEqual({ st: at(9), en: at(10) });
    expect(taskWindow(loose)).toBe(null);
    expect(taskWindow(startOnly)).toBe(null);
    expect(taskWindow({ id: 'e', time: '9:00-10:30' })).toEqual({ st: at(9), en: at(10, 30) });
  });
});

describe('liveTasks', () => {
  it('holds the timed, unfinished tasks whose window is open', () => {
    const list = [nine, late, loose, startOnly, { ...nine, id: 'x', done: true }];
    expect(liveTasks(list, at(9, 30)).map((t) => t.id)).toEqual(['a']);
    expect(liveTasks(list, at(10)).map((t) => t.id)).toEqual([]);   // the end is exclusive
    expect(liveTasks(list, at(0, 30)).map((t) => t.id)).toEqual(['b']);   // across midnight
  });
});

describe('focusVerdict', () => {
  const v = (task, curMin, opts = {}) => focusVerdict({
    settings: {}, task, isToday: true, live: liveTasks([nine, late], curMin), curMin, ...opts,
  });

  it('lets the task whose time it is be focused', () => {
    expect(v(nine, at(9, 15))).toEqual({ ok: true });
  });
  it('refuses a timed task before or after its window', () => {
    expect(v(nine, at(8, 59))).toMatchObject({ ok: false, reason: 'outside' });
    expect(v(nine, at(11))).toMatchObject({ ok: false, reason: 'outside' });
  });
  it('refuses a timed task planned for another day, even at the right hour', () => {
    expect(focusVerdict({ settings: {}, task: nine, isToday: false, live: [], curMin: at(9, 15) }))
      .toMatchObject({ ok: false, reason: 'outside' });
  });
  it('while a window is open, nothing else can be focused — untimed, habit or meeting', () => {
    for (const t of [loose, startOnly, { id: 'habit1' }, { id: 'cal:x' }]) {
      const r = v(t, at(9, 30));
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('live');
      expect(r.task.id).toBe('a');
    }
  });
  it('leaves untimed work free when nothing timed is running', () => {
    expect(v(loose, at(12))).toEqual({ ok: true });
    expect(v(startOnly, at(12))).toEqual({ ok: true });
  });
  it('does nothing when switched off', () => {
    expect(v(nine, at(12), { settings: { timeLock: false } })).toEqual({ ok: true });
    expect(v(loose, at(9, 30), { settings: { timeLock: false } })).toEqual({ ok: true });
  });
});

describe('timeLockDue', () => {
  const live = [nine];
  it('covers the app while a task is live and nothing is being focused on', () => {
    expect(timeLockDue({ settings: {}, live, roundTaskIds: [] })).toBe(true);
    expect(timeLockDue({ settings: {}, live, roundTaskIds: [null, undefined] })).toBe(true);
  });
  it('lifts only for a round on the live task', () => {
    expect(timeLockDue({ settings: {}, live, roundTaskIds: ['a'] })).toBe(false);
    expect(timeLockDue({ settings: {}, live, roundTaskIds: ['c'] })).toBe(true);
  });
  it('never covers a day with nothing live, or when switched off', () => {
    expect(timeLockDue({ settings: {}, live: [], roundTaskIds: [] })).toBe(false);
    expect(timeLockDue({ settings: { timeLock: false }, live, roundTaskIds: [] })).toBe(false);
  });
});
