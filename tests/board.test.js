/* The board must never disagree with the rest of the app about what is
   finished. `done` stays the single answer to that and the column is derived
   from it — these pin the consequences of that choice, because the tempting
   alternative (a status field of its own) fails in a way nobody notices until
   a task is ticked off on the Now screen and still sitting in To do. */
import { describe, it, expect } from 'vitest';
import { COLUMNS, columnOf, patchFor, isMove, groupByColumn, boardSummary } from '../src/board.js';

describe('columnOf', () => {
  it('puts a fresh task in To do', () => {
    expect(columnOf({ title: 'x' })).toBe('todo');
    expect(columnOf({ title: 'x', board: 'todo' })).toBe('todo');
  });

  it('honours Doing', () => {
    expect(columnOf({ board: 'doing' })).toBe('doing');
  });

  it('lets done win over whatever the board field says', () => {
    // Ticking a task off on the Now screen has to move its card, or the board
    // quietly becomes a second, wrong opinion about what is finished.
    expect(columnOf({ done: true })).toBe('done');
    expect(columnOf({ done: true, board: 'doing' })).toBe('done');
    expect(columnOf({ done: true, board: 'todo' })).toBe('done');
  });

  it('does not throw on junk', () => {
    expect(columnOf(null)).toBe('todo');
    expect(columnOf({ board: 'nonsense' })).toBe('todo');
  });
});

describe('patchFor', () => {
  it('marks done when moved to Done', () => {
    expect(patchFor('done')).toEqual({ done: true });
  });

  it('remembers where a card was while it sits in Done', () => {
    // Moving into Done leaves `board` alone on purpose: it is the memory of
    // the column to come back to.
    const card = { done: false, board: 'doing' };
    const inDone = { ...card, ...patchFor('done') };
    expect(inDone.board).toBe('doing');
    expect(columnOf(inDone)).toBe('done');

    // Un-ticking anywhere in the app returns it to Doing, not to To do.
    const reopened = { ...inDone, done: false };
    expect(columnOf(reopened)).toBe('doing');
  });

  it('un-ticks when moved out of Done', () => {
    expect(patchFor('doing')).toEqual({ done: false, board: 'doing' });
    expect(patchFor('todo')).toEqual({ done: false, board: 'todo' });
  });

  it('round-trips every column', () => {
    for (const col of COLUMNS) {
      expect(columnOf({ ...patchFor(col) })).toBe(col);
    }
  });
});

describe('isMove', () => {
  it('is false for a card dropped where it already was', () => {
    // A no-op write still rewrites the week document and costs a sync.
    expect(isMove({ done: false, board: 'doing' }, 'doing')).toBe(false);
    expect(isMove({ done: true }, 'done')).toBe(false);
    expect(isMove({ title: 'x' }, 'todo')).toBe(false);
  });
  it('is true for a real move, false for a column that does not exist', () => {
    expect(isMove({ title: 'x' }, 'doing')).toBe(true);
    expect(isMove({ title: 'x' }, 'archive')).toBe(false);
  });
});

describe('groupByColumn', () => {
  it('always returns all three columns, even empty ones', () => {
    // An empty board still needs somewhere to drop the first card.
    expect(groupByColumn([])).toEqual({ todo: [], doing: [], done: [] });
  });

  it('keeps the order it was given', () => {
    const cards = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(groupByColumn(cards).todo.map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it('sorts a mixed set into the right columns', () => {
    const g = groupByColumn([
      { id: 'a' },
      { id: 'b', board: 'doing' },
      { id: 'c', done: true },
      { id: 'd', done: true, board: 'doing' },
    ]);
    expect(g.todo.map((c) => c.id)).toEqual(['a']);
    expect(g.doing.map((c) => c.id)).toEqual(['b']);
    expect(g.done.map((c) => c.id)).toEqual(['c', 'd']);
  });
});

describe('boardSummary', () => {
  it('counts each column and the total', () => {
    const s = boardSummary([{ id: 1 }, { id: 2, board: 'doing' }, { id: 3, done: true }]);
    expect(s).toEqual({ todo: 1, doing: 1, done: 1, total: 3 });
  });
  it('survives nothing at all', () => {
    expect(boardSummary(null)).toEqual({ todo: 0, doing: 0, done: 0, total: 0 });
  });
});
