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
import { ArrowLeft, Calendar, Check, ChevronLeft, ChevronRight, Columns3, Inbox, Lock, Plus, Trash2 } from 'lucide-react';
import { DONE_COL, columnOf, columnsOf, groupByColumn, isMove, newColumn, toStored } from './board.js';
import { bName, blockById, mon, tx, wd } from './core.jsx';

const neighbour = (cols, col, dir) => {
  const i = cols.findIndex((c) => c.id === col) + dir;
  return i >= 0 && i < cols.length ? cols[i].id : null;
};

function Card({ card, columns, projectColor, onMove, onOpen, onDragStart }) {
  const col = columnOf(card, columns);
  const prev = neighbour(columns, col, -1);
  const next = neighbour(columns, col, 1);
  const nameOf = (id) => (columns.find((c) => c.id === id) || {}).name || '';
  return (
    <div
      className={`kb-card${card.done ? ' done' : ''}`}
      style={{ borderInlineStartColor: projectColor }}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', card.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(card); }}
    >
      <button type="button" className="kb-card-main" onClick={() => onOpen(card)}>
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

export function KanbanBoard({ project, cards, onMove, onOpenTask, onBack, onAddTask, onColumns }) {
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const [editing, setEditing] = useState(false);
  const columns = columnsOf(project);
  const groups = groupByColumn(cards, columns);

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
        <span className="kb-count">{(cards || []).length} {tx('tasks', 'مهام')}</span>
        {onColumns && (
          <button className="ghost sm" onClick={() => setEditing((v) => !v)}>
            <Columns3 size={14} /> {tx('Columns', 'الأعمدة')}
          </button>
        )}
      </div>

      {editing && onColumns && (
        <ColumnEditor columns={columns} onColumns={onColumns} onClose={() => setEditing(false)} />
      )}

      <div className="kb-cols" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
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
