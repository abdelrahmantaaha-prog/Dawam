/* ------------------------------------------------------------------ */
/*  Kanban columns for a project's tasks.                              */
/*                                                                     */
/*  There is no new "status" field to keep in step with `done`, because */
/*  two sources of truth for "is this finished" is how a task ends up   */
/*  ticked off on the Now screen and still sitting in To do on the      */
/*  board. `done` remains the only answer to that question; the column  */
/*  is derived from it, and `board` only says which of the two          */
/*  *unfinished* columns a card belongs to.                             */
/*                                                                     */
/*  The consequence worth having: ticking a task off anywhere in the    */
/*  app moves its card to Done, and un-ticking it returns the card to   */
/*  the column it came from rather than dumping it back in To do.      */
/* ------------------------------------------------------------------ */
import { tx } from './core.jsx';

export const COLUMNS = ['todo', 'doing', 'done'];

export const columnName = (id) => (
  id === 'doing' ? tx('Doing', 'جارٍ')
    : id === 'done' ? tx('Done', 'منجز')
      : tx('To do', 'للعمل')
);

/* Which column a card is in. `done` wins over everything: a finished task is
   in Done no matter what the board field says. */
export function columnOf(card) {
  if (!card) return 'todo';
  if (card.done) return 'done';
  return card.board === 'doing' ? 'doing' : 'todo';
}

/* The patch that moves a card to a column.
 *
 * Moving INTO Done deliberately leaves `board` alone: it is the memory of
 * where the card was, and clearing it would make un-ticking dump every card
 * into To do regardless of what it was doing. */
export function patchFor(col) {
  if (col === 'done') return { done: true };
  if (col === 'doing') return { done: false, board: 'doing' };
  return { done: false, board: 'todo' };
}

/* Is this a real move? Dropping a card back where it started should not write
   anything — a no-op write still bumps the week document and costs a sync. */
export const isMove = (card, col) => COLUMNS.includes(col) && columnOf(card) !== col;

/* Cards grouped into columns, each keeping the order it arrived in (the
   caller sorts by date). */
export function groupByColumn(cards) {
  const out = { todo: [], doing: [], done: [] };
  for (const c of cards || []) out[columnOf(c)].push(c);
  return out;
}

/* A one-line count for the project card, so the board is worth opening. */
export function boardSummary(cards) {
  const g = groupByColumn(cards);
  return { todo: g.todo.length, doing: g.doing.length, done: g.done.length, total: (cards || []).length };
}
