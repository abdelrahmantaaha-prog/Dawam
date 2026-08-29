/* ------------------------------------------------------------------ */
/*  A project's Kanban board.                                          */
/*                                                                     */
/*  The cards are the project's own tasks — the same records the Plan   */
/*  page and the Now queue work on, not a copy. Moving a card is a      */
/*  normal edit to a task, which is why ticking something off on the    */
/*  Now screen moves its card here without anything having to sync.     */
/*                                                                     */
/*  Dragging is offered where there is a mouse, and there are always    */
/*  arrows as well. Not a fallback for accessibility's sake alone: this */
/*  runs on a phone, where dragging a card between columns that do not  */
/*  fit on screen together is worse than a button.                      */
/* ------------------------------------------------------------------ */
import React, { useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Calendar, Inbox, Plus } from 'lucide-react';
import { COLUMNS, columnName, columnOf, groupByColumn, isMove } from './board.js';
import { bName, blockById, mon, tx, wd } from './core.jsx';

const nextCol = (col, dir) => {
  const i = COLUMNS.indexOf(col) + dir;
  return i >= 0 && i < COLUMNS.length ? COLUMNS[i] : null;
};

function Card({ card, projectColor, onMove, onOpen, onDragStart }) {
  const col = columnOf(card);
  const prev = nextCol(col, -1);
  const next = nextCol(col, 1);
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
          aria-label={prev ? `${tx('Move to', 'انقل إلى')} ${columnName(prev)}` : undefined}><ChevronLeft size={15} /></button>
        <button type="button" className="icon sm" disabled={!next} onClick={() => next && onMove(card, next)}
          aria-label={next ? `${tx('Move to', 'انقل إلى')} ${columnName(next)}` : undefined}><ChevronRight size={15} /></button>
      </span>
    </div>
  );
}

export function KanbanBoard({ project, cards, onMove, onOpenTask, onBack, onAddTask }) {
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const groups = groupByColumn(cards);

  const drop = (col) => {
    setOver(null);
    const card = dragging;
    setDragging(null);
    if (card && isMove(card, col)) onMove(card, col);
  };

  return (
    <div className="kb">
      <div className="kb-head">
        <button className="icon" onClick={onBack} aria-label={tx('Back to projects', 'العودة للمشاريع')}><ArrowLeft size={18} /></button>
        <span className="kb-dot" style={{ background: project.color }} />
        <strong className="kb-title">{project.name}</strong>
        <span className="kb-count">{(cards || []).length} {tx('tasks', 'مهام')}</span>
      </div>

      <div className="kb-cols">
        {COLUMNS.map((col) => (
          <section
            key={col}
            className={`kb-col${over === col ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(col); }}
            onDragLeave={() => setOver((o) => (o === col ? null : o))}
            onDrop={(e) => { e.preventDefault(); drop(col); }}
          >
            <header className="kb-col-h">
              <span>{columnName(col)}</span>
              <span className="kb-col-n">{groups[col].length}</span>
            </header>
            <div className="kb-col-body">
              {groups[col].map((c) => (
                <Card
                  key={c.id}
                  card={c}
                  projectColor={project.color}
                  onMove={onMove}
                  onOpen={onOpenTask}
                  onDragStart={setDragging}
                />
              ))}
              {!groups[col].length && (
                <p className="kb-empty">
                  {col === 'todo'
                    ? tx('Nothing waiting.', 'لا شيء في الانتظار.')
                    : col === 'doing' ? tx('Nothing in flight.', 'لا شيء جارٍ.') : tx('Nothing finished yet.', 'لم يُنجز شيء بعد.')}
                </p>
              )}
              {col === 'todo' && onAddTask && (
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
