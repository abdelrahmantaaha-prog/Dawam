/* Habits are dragged into order inside their own day period only. */
import { describe, it, expect } from 'vitest';
import { moveHabit } from '../src/habits.js';

const H = (id, block) => ({ id, name: id, block });
const list = [H('a', 'morning'), H('b', 'morning'), H('x', 'night'), H('c', 'morning')];
const ids = (l) => l.map((h) => h.id).join('');

describe('moveHabit', () => {
  it('moves before a habit in the same period', () => {
    expect(ids(moveHabit(list, 'c', 'a'))).toBe('cabx');
  });
  it('moves after a habit in the same period', () => {
    expect(ids(moveHabit(list, 'a', 'c', true))).toBe('bxca');
    expect(ids(moveHabit(list, 'a', 'b', true))).toBe('baxc');
  });
  it('refuses a drop on another period', () => {
    expect(moveHabit(list, 'a', 'x')).toBe(list);
  });
  it('treats a missing period as morning', () => {
    const l = [{ id: 'p' }, H('q', 'morning')];
    expect(ids(moveHabit(l, 'q', 'p'))).toBe('qp');
  });
  it('ignores unknown ids and dropping on itself', () => {
    expect(moveHabit(list, 'zz', 'a')).toBe(list);
    expect(moveHabit(list, 'a', 'zz')).toBe(list);
    expect(moveHabit(list, 'a', 'a')).toBe(list);
  });
});

import { mergeHabits, dropInMerged, applyHabitOrder } from '../src/habits.js';
const T = (id) => ({ id, title: id });
const show = (rows) => rows.map((r) => (r.kind === 'habit' ? r.h.id.toUpperCase() : r.t.id)).join('');

describe('habits among tasks on the Plan', () => {
  const tasks = [T('a'), T('b'), T('c')];
  it('puts slotless habits first, as before', () => {
    expect(show(mergeHabits(tasks, [{ id: 'x' }, { id: 'y' }]))).toBe('XYabc');
  });
  it('places a habit after as many tasks as its slot says, clamped', () => {
    expect(show(mergeHabits(tasks, [{ id: 'x', slot: 2 }, { id: 'y', slot: 9 }]))).toBe('abXcY');
    expect(show(mergeHabits([], [{ id: 'x', slot: 3 }]))).toBe('X');
  });
  it('dragging a habit between tasks sets its slot', () => {
    const rows = mergeHabits(tasks, [{ id: 'x' }]);
    const r = dropInMerged(rows, { kind: 'habit', id: 'x' }, { kind: 'task', id: 'b' }, true);
    expect(r).toEqual({ taskIds: ['a', 'b', 'c'], slots: { x: 2 }, habitIds: ['x'] });
  });
  it('dragging a task above a habit pushes the habit a slot down', () => {
    const rows = mergeHabits(tasks, [{ id: 'x', slot: 1 }]);
    const r = dropInMerged(rows, { kind: 'task', id: 'c' }, { kind: 'habit', id: 'x' });
    expect(r.taskIds).toEqual(['a', 'c', 'b']);
    expect(r.slots).toEqual({ x: 2 });
  });
  it('a task coming from another period can be dropped in', () => {
    const rows = mergeHabits(tasks, [{ id: 'x', slot: 1 }]);
    const r = dropInMerged(rows, { kind: 'task', id: 'n', row: { kind: 'task', t: T('n') } }, { kind: 'habit', id: 'x' }, true);
    expect(r.taskIds).toEqual(['a', 'n', 'b', 'c']);
    expect(r.slots).toEqual({ x: 1 });
  });
  it('swapping two habits reorders them in the saved list only within their period', () => {
    const all = [{ id: 'x', block: 'morning' }, { id: 'n', block: 'night' }, { id: 'y', block: 'morning' }];
    const out = applyHabitOrder(all, ['y', 'x'], { y: 0, x: 1 });
    expect(out.map((h) => h.id)).toEqual(['y', 'n', 'x']);
    expect(out.map((h) => h.slot)).toEqual([0, undefined, 1]);
  });
  it('refuses a drop on itself or on an unknown row', () => {
    const rows = mergeHabits(tasks, [{ id: 'x' }]);
    expect(dropInMerged(rows, { kind: 'habit', id: 'x' }, { kind: 'habit', id: 'x' })).toBeNull();
    expect(dropInMerged(rows, { kind: 'habit', id: 'x' }, { kind: 'task', id: 'zz' })).toBeNull();
  });
});
