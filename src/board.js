/* ------------------------------------------------------------------ */
/*  Kanban columns for a project's tasks.                              */
/*                                                                     */
/*  There is no new "status" field, because two sources of truth for   */
/*  "is this finished" is how a task ends up ticked off on the Now      */
/*  screen and still sitting in To do on the board. `done` remains the  */
/*  only answer to that question; `board` says only which of the        */
/*  *unfinished* columns a card belongs to.                            */
/*                                                                     */
/*  The consequence worth having: ticking a task off anywhere in the    */
/*  app moves its card to Done, and un-ticking it returns the card to   */
/*  the column it came from rather than dumping it back in the first.   */
/*                                                                     */
/*  Columns are per project and editable. Done is not one of them — it  */
/*  is appended, cannot be renamed, moved or deleted, and is the only   */
/*  column whose membership is decided by something other than          */
/*  `board`. Letting it be edited would mean a project could have two   */
/*  finished columns, or none.                                          */
/* ------------------------------------------------------------------ */
import { tx, uid } from './core.jsx';

export const DONE_COL = 'done';

export const defaultColumns = () => ([
  { id: 'todo', name: tx('To do', 'للعمل') },
  { id: 'doing', name: tx('Doing', 'جارٍ') },
  { id: 'issue', name: tx('Issue', 'عائق') },
]);

const cleanName = (v, fallback) => {
  const s = String(v == null ? '' : v).trim();
  return s ? s.slice(0, 40) : fallback;
};

/* The columns a project actually shows: its own, then Done.
 *
 * A stored `done` column is dropped rather than honoured — it would render
 * twice and the copy driven by `board` would never fill, since `columnOf`
 * answers Done from the task's own done flag. */
export function columnsOf(project) {
  const stored = Array.isArray(project && project.columns) ? project.columns : null;
  const custom = (stored || [])
    .filter((c) => c && c.id && String(c.id) !== DONE_COL)
    .map((c, i) => ({ id: String(c.id), name: cleanName(c.name, `${tx('Column', 'عمود')} ${i + 1}`) }));
  const base = custom.length ? custom : defaultColumns();
  return [...base, { id: DONE_COL, name: tx('Done', 'منجز'), fixed: true }];
}

/* What gets stored: the editable columns only, never Done. */
export const toStored = (columns) => (columns || []).filter((c) => c.id !== DONE_COL).map((c) => ({ id: c.id, name: c.name }));

export const newColumn = (name) => ({ id: uid(), name: cleanName(name, tx('New column', 'عمود جديد')) });

/* Which column a card is in.
 *
 * `done` wins over everything. And a card whose `board` names a column that
 * has since been deleted falls back to the first one rather than vanishing —
 * that fallback is what makes deleting a column safe without rewriting every
 * task record across every week it might live in. */
export function columnOf(card, columns) {
  if (!card) return (columns && columns[0] && columns[0].id) || 'todo';
  if (card.done) return DONE_COL;
  const cols = columns && columns.length ? columns : columnsOf(null);
  const ids = cols.map((c) => c.id);
  return ids.includes(card.board) ? card.board : ids[0];
}

/* The patch that moves a card to a column.
 *
 * Moving INTO Done deliberately leaves `board` alone: it is the memory of
 * where the card was, and clearing it would make un-ticking dump every card
 * into the first column regardless of what it had been doing. */
export function patchFor(col) {
  if (col === DONE_COL) return { done: true };
  return { done: false, board: col };
}

/* Is this a real move? Dropping a card back where it started should not write
   anything — a no-op write still bumps the week document and costs a sync. */
export function isMove(card, col, columns) {
  const cols = columns && columns.length ? columns : columnsOf(null);
  if (!cols.some((c) => c.id === col)) return false;
  return columnOf(card, cols) !== col;
}

/* Cards grouped into columns, each keeping the order it arrived in. Every
   column is present even when empty — an empty board still needs somewhere to
   drop the first card. */
export function groupByColumn(cards, columns) {
  const cols = columns && columns.length ? columns : columnsOf(null);
  const out = {};
  for (const c of cols) out[c.id] = [];
  for (const card of cards || []) {
    const id = columnOf(card, cols);
    (out[id] = out[id] || []).push(card);
  }
  return out;
}

/* A compact count per column for the project card, so the board is worth
   opening without opening it. */
export function boardSummary(cards, columns) {
  const cols = columns && columns.length ? columns : columnsOf(null);
  const g = groupByColumn(cards, cols);
  return {
    total: (cards || []).length,
    lanes: cols.map((c) => ({ id: c.id, name: c.name, n: (g[c.id] || []).length })),
  };
}
