/* ------------------------------------------------------------------ */
/*  Preparing for — or writing up — one meeting.                       */
/*                                                                     */
/*  Everything above the line is the feed's and cannot be edited here:  */
/*  the title, the time, where it came from. Everything below is        */
/*  Dawam's own record around it. The sheet says which is which,       */
/*  because a form that lets you type into a field it will then discard */
/*  is worse than one that does not offer the field.                    */
/* ------------------------------------------------------------------ */
import React from 'react';
import { CalendarClock, CheckCircle2, Circle, Lock, Plus, StickyNote, X } from 'lucide-react';
import { fmtTime, mon, pad, tx, wdFull } from './core.jsx';

const clockOf = (ms) => { const d = new Date(ms); return fmtTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`); };

export function MeetingSheet({
  ev, done, desc, notebooks = [], past, project,
  onToggleDone, onDesc, onOpenNotebook, onNewNotebook, onClose,
}) {
  const start = new Date(ev.startMs);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head plain">
          <strong><CalendarClock size={15} /> {past ? tx('Write it up', 'دوّنه') : tx('Prepare', 'التحضير')}</strong>
          <button className="icon" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {/* The feed's, and read-only. */}
          <div className="ms-fixed">
            <p className="ms-title">{ev.summary || tx('(busy)', '(مشغول)')}</p>
            <p className="ms-when">
              {wdFull(start.getDay())} {start.getDate()} {mon(start.getMonth())} · {clockOf(ev.startMs)}–{clockOf(ev.endMs)}
              {ev.location ? ` · ${ev.location}` : ''}
            </p>
            <p className="ms-ro"><Lock size={11} /> {tx('From your calendar — Dawam never changes it.', 'من تقويمك — لا يعدّله «دوام» أبدًا.')}</p>
            {project && <span className="ms-proj" style={{ '--pcolour': project.color }}>{project.name}</span>}
          </div>

          <button className={`ms-done ${done ? 'on' : ''}`} onClick={onToggleDone}>
            {done ? <CheckCircle2 size={17} /> : <Circle size={17} />}
            {done ? tx('Attended', 'حضرت') : tx('Mark attended', 'علّم الحضور')}
          </button>

          <div className="proj-field">
            <span>{tx('What it is for', 'ما الغرض منه')}</span>
            <textarea rows={2} className="ms-desc" value={desc} onChange={(e) => onDesc(e.target.value)}
              placeholder={tx('Weekly sync with the desk — bring the numbers', 'اجتماع أسبوعي — أحضر الأرقام')} />
            {/* Said plainly, because it is the opposite of the notes below and
                nobody would guess it from the field. */}
            <p className="hint-text" style={{ margin: '4px 0 0' }}>
              {tx('Kept for every occurrence of this meeting — write it once.', 'يُحفظ لكل تكرارات هذا الاجتماع — اكتبه مرة واحدة.')}
            </p>
          </div>

          <div className="nb-list">
            <div className="nb-head">
              {past ? tx('Notes from this one', 'ملاحظات هذه المرة') : tx('Notes for this one', 'ملاحظات لهذه المرة')}
            </div>
            {notebooks.map((n) => (
              <button key={n.id} className="nb-row" style={{ '--ncolour': n.colour }} onClick={() => onOpenNotebook(n.id)}>
                <StickyNote size={13} />
                <span className="nb-row-t">{n.title || tx('Untitled', 'بلا عنوان')}</span>
                <span className="nb-row-x">{n.excerpt}</span>
              </button>
            ))}
            <button className="nb-add" onClick={onNewNotebook}>
              <Plus size={13} /> {tx('New notebook', 'دفتر جديد')}
            </button>
            <p className="hint-text" style={{ margin: '6px 0 0' }}>
              {tx('These belong to this date only — next week gets its own page.', 'هذه لهذا التاريخ وحده — للأسبوع القادم صفحته.')}
            </p>
          </div>
        </div>
        <div className="modal-foot"><button className="primary" onClick={onClose}>{tx('Done', 'تم')}</button></div>
      </div>
    </div>
  );
}
