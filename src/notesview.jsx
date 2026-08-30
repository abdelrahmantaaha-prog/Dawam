/* ------------------------------------------------------------------ */
/*  Notes — a wall of notebooks, and the page you write on.            */
/*                                                                     */
/*  Two surfaces. The wall is for finding: pinned first, then whatever  */
/*  you touched last, laid out in columns so a short note does not      */
/*  leave a hole under a long one. The editor is for writing, and it is */
/*  a full sheet rather than a panel because a notebook is the thing    */
/*  you are doing while it is open, not a detail of something else.     */
/*                                                                     */
/*  The editor is a contentEditable. Its value is NOT driven from React */
/*  state on every keystroke: re-rendering the element under the caret  */
/*  moves the caret to the end, which makes writing anything longer     */
/*  than a sentence impossible. React sets it once when a different     */
/*  notebook is opened, and the DOM owns it after that.                 */
/* ------------------------------------------------------------------ */
import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Bold, Check, Heading, Italic, Link as LinkIcon, List, ListOrdered,
  Pin, Plus, Search, StickyNote, Trash2, Underline, X,
} from 'lucide-react';
import { NOTE_COLOURS, excerpt, isEmptyNote, sanitise } from './notes.js';
import { tx } from './core.jsx';

const stamp = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/* ---- the editor ---- */

export function NoteEditor({ note, onChange, onClose, onDelete, taskTitle }) {
  const bodyRef = useRef(null);
  const loadedFor = useRef(null);

  // Only when a DIFFERENT notebook is opened. Writing into innerHTML on every
  // change would drop the caret to the end of the document on every keystroke.
  useEffect(() => {
    if (!bodyRef.current || loadedFor.current === note.id) return;
    bodyRef.current.innerHTML = note.body || '';
    loadedFor.current = note.id;
  }, [note.id, note.body]);

  const push = () => onChange({ body: sanitise(bodyRef.current ? bodyRef.current.innerHTML : '') });
  const cmd = (name, value) => {
    bodyRef.current?.focus();
    // execCommand is deprecated and still the only thing every one of these
    // shells implements for rich text. The alternative is writing a selection
    // model by hand, which is a far bigger surface to get wrong.
    document.execCommand(name, false, value);
    push();
  };
  const addLink = () => {
    const url = window.prompt(tx('Link address', 'عنوان الرابط'));
    if (url && /^(https?:|mailto:)/i.test(url.trim())) cmd('createLink', url.trim());
  };

  return (
    <div className="overlay note-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { push(); onClose(); } }}>
      <div className="note-sheet" style={{ '--ncolour': note.colour }}>
        <div className="note-sheet-head">
          <button className="icon" onClick={() => { push(); onClose(); }} aria-label={tx('Back', 'رجوع')}><ArrowLeft size={18} /></button>
          <input
            className="note-title-in"
            value={note.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder={tx('Title', 'العنوان')}
          />
          <button className={`icon ${note.pinned ? 'on' : ''}`} onClick={() => onChange({ pinned: !note.pinned })}
            aria-label={tx('Pin', 'تثبيت')} title={tx('Pin', 'تثبيت')}><Pin size={17} /></button>
          <button className="icon" onClick={() => { push(); onClose(); }} aria-label={tx('Close', 'إغلاق')}><X size={18} /></button>
        </div>

        {taskTitle && <div className="note-fromtask"><Check size={12} /> {tx('from', 'من')} “{taskTitle}”</div>}

        <div className="note-tools">
          <button className="icon sm" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('bold')} aria-label="Bold"><Bold size={15} /></button>
          <button className="icon sm" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('italic')} aria-label="Italic"><Italic size={15} /></button>
          <button className="icon sm" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('underline')} aria-label="Underline"><Underline size={15} /></button>
          <span className="note-tool-sep" />
          <button className="icon sm" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('formatBlock', 'h2')} aria-label="Heading"><Heading size={15} /></button>
          <button className="icon sm" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('insertUnorderedList')} aria-label="Bullets"><List size={15} /></button>
          <button className="icon sm" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('insertOrderedList')} aria-label="Numbered"><ListOrdered size={15} /></button>
          <button className="icon sm" onMouseDown={(e) => e.preventDefault()} onClick={addLink} aria-label="Link"><LinkIcon size={15} /></button>
          <span className="note-tool-sep" />
          <span className="note-swatches">
            {NOTE_COLOURS.map((c) => (
              <button key={c} className={`note-swatch ${note.colour === c ? 'on' : ''}`} style={{ background: c }}
                onClick={() => onChange({ colour: c })} aria-label={tx('Colour', 'اللون')} />
            ))}
          </span>
        </div>

        <div
          ref={bodyRef}
          className="note-body"
          contentEditable
          suppressContentEditableWarning
          onInput={push}
          onBlur={push}
          /* Paste as text and let the sanitiser rebuild it, rather than
             trusting whatever the clipboard carried. */
          onPaste={(e) => {
            e.preventDefault();
            const html = e.clipboardData.getData('text/html');
            const text = e.clipboardData.getData('text/plain');
            document.execCommand('insertHTML', false, html ? sanitise(html) : (text || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])));
            push();
          }}
          data-placeholder={tx('Write…', 'اكتب…')}
        />

        <div className="note-sheet-foot">
          <span className="note-stamp">{note.updatedAt ? `${tx('edited', 'عُدّلت')} ${stamp(note.updatedAt)}` : ''}</span>
          <button className="danger sm" onClick={() => { onDelete(note.id); onClose(); }}><Trash2 size={14} /> {tx('Delete', 'حذف')}</button>
        </div>
      </div>
    </div>
  );
}

/* ---- the wall ---- */

export function NotesView({ notes, sky, stars, heroLight, SkyScene, onOpen, onNew, onChange, taskTitleFor }) {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const shown = term
    ? notes.filter((n) => `${n.title} ${excerpt(n.body, 4000)}`.toLowerCase().includes(term))
    : notes;

  return (
    <div className="hero-card wide">
      <SkyScene sky={sky} stars={stars} light={heroLight}
        label={tx('Notes', 'الملاحظات')} time={String(notes.length)}
        blockName={notes.length ? tx('notebooks', 'دفاتر') : tx('nothing written yet', 'لا شيء بعد')} blockAr=""
        range={notes.length ? `${notes.filter((n) => n.pinned).length} ${tx('pinned', 'مثبّتة')}` : tx('write something down', 'دوّن شيئًا')} />
      <div className="hero-sheet">
        <div className="note-bar">
          <span className="note-search">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('Search notes…', 'ابحث في الملاحظات…')} />
          </span>
          <button className="primary sm" onClick={onNew}><Plus size={15} /> {tx('New note', 'ملاحظة جديدة')}</button>
        </div>

        {notes.length === 0 && (
          <div className="proj-empty">
            <StickyNote size={26} />
            <p>{tx('Somewhere to write properly — a plan, a transcript, a page of thinking. Notes can stand on their own or hang off a task, and they stay here either way.', 'مكان للكتابة على مهل — خطة، تفريغ، صفحة تفكير. يمكن للملاحظة أن تقف وحدها أو تُعلَّق بمهمة، وتبقى هنا في الحالتين.')}</p>
          </div>
        )}

        {notes.length > 0 && shown.length === 0 && (
          <p className="hint-text">{tx('Nothing matches that.', 'لا شيء يطابق ذلك.')}</p>
        )}

        {/* Columns rather than a grid: notes are different heights, and a grid
            would leave a hole under every short one. */}
        <div className="note-wall">
          {shown.map((n) => {
            const text = excerpt(n.body, 260);
            const from = n.taskId && taskTitleFor ? taskTitleFor(n.taskId) : null;
            return (
              <button key={n.id} className="note-card" style={{ '--ncolour': n.colour }} onClick={() => onOpen(n.id)}>
                <span
                  className={`note-pin ${n.pinned ? 'on' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={tx('Pin', 'تثبيت')}
                  onClick={(e) => { e.stopPropagation(); onChange(n.id, { pinned: !n.pinned }); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange(n.id, { pinned: !n.pinned }); } }}
                >
                  <Pin size={13} />
                </span>
                {n.title ? <span className="note-card-t">{n.title}</span> : null}
                {text ? <span className="note-card-b">{text}</span> : <span className="note-card-b empty">{tx('Empty note', 'ملاحظة فارغة')}</span>}
                <span className="note-card-f">
                  {from ? <span className="note-card-task">“{from}”</span> : null}
                  <span className="note-stamp">{stamp(n.updatedAt)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { isEmptyNote };
