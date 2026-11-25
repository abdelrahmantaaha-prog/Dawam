/* The board must never disagree with the rest of the app about what is
   finished, and a column someone deletes must not take cards with it. Both
   failures are silent — a task ticked off on the Now screen still sitting in
   To do, or a card that simply is not on the board any more — so they are
   pinned here rather than left to be noticed. */
import { describe, it, expect } from 'vitest';
import {
  DONE_COL, columnsOf, toStored, newColumn,
  columnOf, patchFor, isMove, groupByColumn, boardSummary,
} from '../src/board.js';

const ids = (cols) => cols.map((c) => c.id);
const DEFAULTS = columnsOf(null);

describe('columnsOf', () => {
  it('gives a fresh project To do / Doing / Issue, then Done', () => {
    expect(ids(columnsOf(null))).toEqual(['todo', 'doing', 'issue', DONE_COL]);
    expect(ids(columnsOf({}))).toEqual(['todo', 'doing', 'issue', DONE_COL]);
  });

  it('honours custom columns and still appends Done', () => {
    const cols = columnsOf({ columns: [{ id: 'a', name: 'Ideas' }, { id: 'b', name: 'Review' }] });
    expect(ids(cols)).toEqual(['a', 'b', DONE_COL]);
    expect(cols[cols.length - 1].fixed).toBe(true);
  });

  it('refuses a stored column pretending to be Done', () => {
    // It would render twice, and the copy driven by `board` could never fill —
    // Done is answered by the task's own done flag, not by `board`.
    const cols = columnsOf({ columns: [{ id: 'todo', name: 'To do' }, { id: 'done', name: 'Finished' }] });
    expect(ids(cols)).toEqual(['todo', DONE_COL]);
    expect(cols.filter((c) => c.id === DONE_COL)).toHaveLength(1);
  });

  it('falls back to the defaults rather than showing only Done', () => {
    // An empty custom list would otherwise leave a board you cannot put
    // anything on.
    expect(ids(columnsOf({ columns: [] }))).toEqual(['todo', 'doing', 'issue', DONE_COL]);
    expect(ids(columnsOf({ columns: [{ name: 'no id' }] }))).toEqual(['todo', 'doing', 'issue', DONE_COL]);
  });

  it('names an unnamed column instead of rendering a blank header', () => {
    expect(columnsOf({ columns: [{ id: 'x', name: '   ' }] })[0].name).toBeTruthy();
  });
});

describe('toStored', () => {
  it('never persists the Done column', () => {
    expect(toStored(columnsOf(null)).map((c) => c.id)).toEqual(['todo', 'doing', 'issue']);
  });
  it('round-trips a custom set', () => {
    const cols = columnsOf({ columns: [{ id: 'a', name: 'Ideas' }] });
    expect(ids(columnsOf({ columns: toStored(cols) }))).toEqual(['a', DONE_COL]);
  });
});

describe('newColumn', () => {
  it('mints a unique id so renaming never moves cards', () => {
    const a = newColumn('Ideas'), b = newColumn('Ideas');
    expect(a.id).not.toBe(b.id);
    expect(a.name).toBe('Ideas');
  });
  it('names an empty one rather than leaving it blank', () => {
    expect(newColumn('').name).toBeTruthy();
  });
});

describe('columnOf', () => {
  it('puts a fresh task in the first column', () => {
    expect(columnOf({ title: 'x' }, DEFAULTS)).toBe('todo');
  });

  it('honours a named column, including Issue', () => {
    expect(columnOf({ board: 'doing' }, DEFAULTS)).toBe('doing');
    expect(columnOf({ board: 'issue' }, DEFAULTS)).toBe('issue');
  });

  it('lets done win over whatever the board field says', () => {
    expect(columnOf({ done: true }, DEFAULTS)).toBe(DONE_COL);
    expect(columnOf({ done: true, board: 'issue' }, DEFAULTS)).toBe(DONE_COL);
  });

  it('rescues a card whose column was deleted', () => {
    // This fallback is what makes deleting a column safe without rewriting
    // every task record in every week it might live in.
    const after = columnsOf({ columns: [{ id: 'todo', name: 'To do' }] });
    expect(columnOf({ board: 'issue' }, after)).toBe('todo');
  });

  it('still finishes a done card whose column was deleted', () => {
    const after = columnsOf({ columns: [{ id: 'todo', name: 'To do' }] });
    expect(columnOf({ done: true, board: 'issue' }, after)).toBe(DONE_COL);
  });

  it('does not throw on junk', () => {
    expect(columnOf(null, DEFAULTS)).toBe('todo');
    expect(columnOf({ board: 'nonsense' }, DEFAULTS)).toBe('todo');
  });
});

describe('patchFor', () => {
  it('marks done for Done and only for Done', () => {
    expect(patchFor(DONE_COL)).toEqual({ done: true });
    expect(patchFor('issue')).toEqual({ done: false, board: 'issue' });
  });

  it('remembers where a card was while it sits in Done', () => {
    const inDone = { done: false, board: 'issue', ...patchFor(DONE_COL) };
    expect(inDone.board).toBe('issue');
    expect(columnOf(inDone, DEFAULTS)).toBe(DONE_COL);
    // Un-ticking anywhere in the app returns it to Issue, not to To do.
    expect(columnOf({ ...inDone, done: false }, DEFAULTS)).toBe('issue');
  });

  it('round-trips every column', () => {
    for (const c of DEFAULTS) expect(columnOf({ ...patchFor(c.id) }, DEFAULTS)).toBe(c.id);
  });
});

describe('isMove', () => {
  it('is false for a card dropped where it already was', () => {
    expect(isMove({ board: 'issue' }, 'issue', DEFAULTS)).toBe(false);
    expect(isMove({ done: true }, DONE_COL, DEFAULTS)).toBe(false);
  });
  it('is false for a column this project does not have', () => {
    expect(isMove({ title: 'x' }, 'archive', DEFAULTS)).toBe(false);
  });
  it('is true for a real move', () => {
    expect(isMove({ title: 'x' }, 'issue', DEFAULTS)).toBe(true);
  });
});

describe('groupByColumn', () => {
  it('returns every column, even empty ones', () => {
    expect(Object.keys(groupByColumn([], DEFAULTS))).toEqual(['todo', 'doing', 'issue', DONE_COL]);
  });

  it('sorts a mixed set and keeps the given order', () => {
    const g = groupByColumn([
      { id: 'a' }, { id: 'b', board: 'doing' }, { id: 'c', board: 'issue' },
      { id: 'd', done: true }, { id: 'e' },
    ], DEFAULTS);
    expect(g.todo.map((c) => c.id)).toEqual(['a', 'e']);
    expect(g.issue.map((c) => c.id)).toEqual(['c']);
    expect(g[DONE_COL].map((c) => c.id)).toEqual(['d']);
  });

  it('loses nothing when a column has been deleted', () => {
    const after = columnsOf({ columns: [{ id: 'todo', name: 'To do' }] });
    const cards = [{ id: 'a', board: 'issue' }, { id: 'b', board: 'doing' }, { id: 'c', done: true }];
    const g = groupByColumn(cards, after);
    const seen = Object.values(g).flat().map((c) => c.id).sort();
    expect(seen).toEqual(['a', 'b', 'c']);
  });
});

describe('boardSummary', () => {
  it('counts each lane by name', () => {
    const s = boardSummary([{ id: 1 }, { id: 2, board: 'issue' }, { id: 3, done: true }], DEFAULTS);
    expect(s.total).toBe(3);
    expect(s.lanes.map((l) => [l.id, l.n])).toEqual([['todo', 1], ['doing', 0], ['issue', 1], [DONE_COL, 1]]);
  });
  it('survives nothing at all', () => {
    expect(boardSummary(null, DEFAULTS).total).toBe(0);
  });
});
