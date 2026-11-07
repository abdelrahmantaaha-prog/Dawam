/* ------------------------------------------------------------------ */
/*  A project's Kanban board.                                          */
/*                                                                     */
/*  The cards are the project's own tasks — the same records the Plan   */
/*  page and the Now queue work on, not a copy. Moving a card is a      */
/*  normal edit to a task, which is why ticking something off on the    */
/*  Now screen moves its card here without anything having to sync.     */
/*                                                                     */
/*  Columns are the project's to arrange. Done is not: it is always     */
/*  last, cannot be renamed or removed, and is filled from each task's  */
/*  own done flag rather than from the column field.                    */
/*                                                                     */
/*  Dragging is offered where there is a mouse, and there are always    */
/*  arrows as well. Not a fallback for accessibility's sake alone: this */
/*  runs on a phone, where dragging a card between columns that do not  */
/*  fit on screen together is worse than a button.                     */
/* ------------------------------------------------------------------ */
import React, { useState } from 'react';
import { ArrowLeft, Calendar, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, Columns3, Inbox, Lock, Plus, Trash2 } from 'lucide-react';
import { DONE_COL, columnOf, columnsOf, groupByColumn, isMove, newColumn, toStored } from './board.js';
import { isPast } from './calprep.js';
import { bName, blockById, fmtTime, mon, pad, tx, wd } from './core.jsx';

const clockOf = (ms) => { const d = new Date(ms); return fmtTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`); };

/* Meetings filed under this project.
 *
 * A rail rather than a column, because they cannot be moved: the feed is
 * read-only and a card that refuses to be dragged sitting among cards that
 * can be is a worse lie than not putting it there. What Dawam CAN keep about
 * one still lives here — whether you turned up, what it is for, and the page
 * you wrote before walking in. */
function Meetings({ meetings, calDone, prepFor, onOpen, onToggleDone }) {
  if (!meetings.length) return null;
  return (
    <div className="kb-meetings">
      <div className="kb-meetings-h">{tx('Meetings', 'الاجتماعات')} <span className="kb-col-n">{meetings.length}</span></div>
      <div className="kb-meetings-rail">
        {meetings.map((m) => {
          const done = calDone(m);
          const past = isPast(m);
          const desc = prepFor(m);
          return (
            <div key={`${m.uid}-${m.startMs}`} className={`kb-meeting${done ? ' done' : ''}${past ? ' past' : ''}`}>
              <button className="tcheck sm" onClick={() => onToggleDone(m)}
                aria-label={tx('Mark attended', 'تم الحضور')}>{done ? <CheckCircle2 size={15} /> : <Circle size={15} />}</button>
              <button className="kb-meeting-main" onClick={() => onOpen(m)}>
                <span className="kb-meeting-t">{m.summary || tx('(busy)', '(مشغول)')}</span>
                <span className="kb-meeting-w">
                  {wd(new Date(m.startMs).getDay())} {new Date(m.startMs).getDate()} {mon(new Date(m.startMs).getMonth())} · {clockOf(m.startMs)}
                </span>
                {desc ? <span className="kb-meeting-d">{desc}</span> : null}
              </button>
              <span className="kb-meeting-tag">{past ? tx('write up', 'التدوين') : tx('prepare', 'التحضير')}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const neighbour = (cols, col, dir) => {
  const i = cols.findIndex((c) => c.id === col) + dir;
  return i >= 0 && i < cols.length ? cols[i].id : null;
};

function Card({ card, columns, projectColor, label, onMove, onOpen, onDragStart }) {
  const col = columnOf(card, columns);
  const prev = neighbour(columns, col, -1);
  const next = neighbour(columns, col, 1);
  const nameOf = (id) => (columns.find((c) => c.id === id) || {}).name || '';
  return (
    <div
      className={`kb-card${card.done ? ' done' : ''}`}
      /* The label, not the project. Every card on a board belongs to the same
         project, so a project-coloured edge told you nothing you could not
         already see in the title above it. */
      style={{ borderInlineStartColor: (label && label.color) || projectColor }}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', card.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(card); }}
    >
      <button type="button" className="kb-card-main" onClick={() => onOpen(card)}>
        {label && <span className="lchip" style={{ '--lcolor': label.color }}>{label.name}</span>}
        <span className="kb-card-t">{card.title}</span>
        <span className="kb-card-m">
          {card.kind === 'pool'
            ? <><Inbox size={11} /> {tx('Backlog', 'قائمة الانتظار')}</>
            : <><Calendar size={11} /> {wd(card.date.getDay())} {card.date.getDate()} {mon(card.date.getMonth())}{card.block ? ` · ${bName(blockById(card.block))}` : ''}</>}
        </span>
      </button>
      <span className="kb-card-move">
        <button type="button" className="icon sm" disabled={!prev} onClick={() => prev && onMove(card, prev)}
          aria-label={prev ? `${tx('Move to', 'انقل إلى')} ${nameOf(prev)}` : undefined}><ChevronLeft size={15} /></button>
        <button type="button" className="icon sm" disabled={!next} onClick={() => next && onMove(card, next)}
          aria-label={next ? `${tx('Move to', 'انقل إلى')} ${nameOf(next)}` : undefined}><ChevronRight size={15} /></button>
      </span>
    </div>
  );
}

/* Editing the columns. Done appears in the list but only to be shown as
   locked — leaving it out entirely would read as a bug rather than a rule. */
function ColumnEditor({ columns, onColumns, onClose }) {
  const editable = columns.filter((c) => c.id !== DONE_COL);
  const commit = (next) => onColumns(toStored(next));
  const rename = (id, name) => commit(editable.map((c) => (c.id === id ? { ...c, name } : c)));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= editable.length) return;
    const next = [...editable];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };
  const remove = (id) => commit(editable.filter((c) => c.id !== id));
  const add = () => commit([...editable, newColumn()]);

  return (
    <div className="kb-editor">
      <div className="kb-editor-h">
        <strong><Columns3 size={14} /> {tx('Columns', 'الأعمدة')}</strong>
        <button className="primary sm" onClick={onClose}><Check size={14} /> {tx('Done', 'تم')}</button>
      </div>
      <ul className="kb-editor-list">
        {editable.map((c, i) => (
          <li key={c.id} className="kb-editor-row">
            <input value={c.name} onChange={(e) => rename(c.id, e.target.value)} aria-label={tx('Column name', 'اسم العمود')} />
            <button className="icon sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={tx('Move left', 'حرّك لليسار')}><ChevronLeft size={14} /></button>
            <button className="icon sm" onClick={() => move(i, 1)} disabled={i === editable.length - 1} aria-label={tx('Move right', 'حرّك لليمين')}><ChevronRight size={14} /></button>
            <button className="icon sm danger" onClick={() => remove(c.id)} disabled={editable.length <= 1}
              aria-label={tx('Delete column', 'احذف العمود')}><Trash2 size={14} /></button>
          </li>
        ))}
        <li className="kb-editor-row fixed">
          <span className="kb-editor-fixed"><Lock size={12} /> {tx('Done', 'منجز')}</span>
          <span className="hint-text">{tx('Always last. A card here is a task ticked off.', 'دائمًا في النهاية. البطاقة هنا مهمة منجزة.')}</span>
        </li>
      </ul>
      <button className="kb-add" onClick={add}><Plus size={14} /> {tx('Add a column', 'أضف عمودًا')}</button>
      {editable.length <= 1 && (
        <p className="hint-text">{tx('One column has to stay — cards need somewhere that is not Done.', 'لا بد من بقاء عمود واحد — تحتاج البطاقات مكانًا غير «منجز».')}</p>
      )}
    </div>
  );
}

export function KanbanBoard({
  project, cards, labels = [], filterBar, cardFilter, sortCards,
  meetings = [], calDone, prepFor, onOpenMeeting, onToggleMeetingDone,
  onMove, onOpenTask, onBack, onAddTask, onColumns,
}) {
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const [editing, setEditing] = useState(false);
  const columns = columnsOf(project);
  /* Filtered before grouping, so a column's count matches what is under it.
     Only the TAG dimension applies here — every card on this board is already
     the one project, so filtering by project would either change nothing or
     empty the board you deliberately opened. */
  const shown = cardFilter ? (cards || []).filter(cardFilter) : (cards || []);
  // Sorted before grouping: grouping keeps order, so every column comes out
  // in the chosen order without sorting each one separately.
  const groups = groupByColumn(sortCards ? sortCards(shown) : shown, columns);

  const drop = (col) => {
    setOver(null);
    const card = dragging;
    setDragging(null);
    if (card && isMove(card, col, columns)) onMove(card, col);
  };

  return (
    <div className="kb">
      <div className="kb-head">
        <button className="icon" onClick={onBack} aria-label={tx('Back to projects', 'العودة للمشاريع')}><ArrowLeft size={18} /></button>
        <span className="kb-dot" style={{ background: project.color }} />
        <strong className="kb-title">{project.name}</strong>
        <span className="kb-count">{shown.length}{shown.length !== (cards || []).length ? `/${(cards || []).length}` : ''} {tx('tasks', 'مهام')}</span>
        {filterBar}
        {onColumns && (
          <button className="ghost sm" onClick={() => setEditing((v) => !v)}>
            <Columns3 size={14} /> {tx('Columns', 'الأعمدة')}
          </button>
        )}
      </div>

      {editing && onColumns && (
        <ColumnEditor columns={columns} onColumns={onColumns} onClose={() => setEditing(false)} />
      )}

      {onOpenMeeting && (
        <Meetings meetings={meetings} calDone={calDone} prepFor={prepFor}
          onOpen={onOpenMeeting} onToggleDone={onToggleMeetingDone} />
      )}

      {/* The track list belongs to the stylesheet, not to this element. An
          inline grid-template-columns outranks every media query, so setting
          one here was quietly overriding the phone layout in styles.css and
          dividing 375px between however many columns the board had — four of
          them left a card narrow enough to wrap its title one letter per
          line. CSS sizes the columns from their own readable minimum now and
          scrolls the row when they no longer fit. */}
      <div className="kb-cols">
        {columns.map((c) => (
          <section
            key={c.id}
            className={`kb-col${over === c.id ? ' over' : ''}${c.fixed ? ' fixed' : ''}`}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(c.id); }}
            onDragLeave={() => setOver((o) => (o === c.id ? null : o))}
            onDrop={(e) => { e.preventDefault(); drop(c.id); }}
          >
            <header className="kb-col-h">
              <span>{c.name}</span>
              <span className="kb-col-n">{(groups[c.id] || []).length}</span>
            </header>
            <div className="kb-col-body">
              {(groups[c.id] || []).map((card) => (
                <Card
                  key={card.id}
                  card={card}
                  columns={columns}
                  projectColor={project.color}
                  label={card.projectId ? labels.find((l) => l.id === card.projectId) : null}
                  onMove={onMove}
                  onOpen={onOpenTask}
                  onDragStart={setDragging}
                />
              ))}
              {!(groups[c.id] || []).length && (
                <p className="kb-empty">
                  {c.id === DONE_COL ? tx('Nothing finished yet.', 'لم يُنجز شيء بعد.') : tx('Empty.', 'فارغ.')}
                </p>
              )}
              {c.id === columns[0].id && onAddTask && (
                <button className="kb-add" onClick={onAddTask}>
                  <Plus size={14} /> {tx('Add a task', 'أضف مهمة')}
                </button>
              )}
            </div>
          </section>
        ))}
      </div>

      {!(cards || []).length && (
        <p className="hint-text kb-hint">
          {tx('Nothing is linked to this project yet. Give a task this project in its editor, or ask the assistant to add one under it.',
            'لا شيء مرتبط بهذا المشروع بعد. أسنِد المشروع لمهمة من محرّرها، أو اطلب من المساعد إضافة مهمة تحته.')}
        </p>
      )}
    </div>
  );
}

export default KanbanBoard;
