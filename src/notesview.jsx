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
  ArrowLeft, Bold, Check, Hash, Heading, Italic, Layers, Link as LinkIcon, List, ListOrdered,
  Pin, Plus, Search, StickyNote, Trash2, Underline, X,
} from 'lucide-react';
import { NOTE_COLOURS, addTags, allNoteTags, excerpt, groupByTag, hasTag, isEmptyNote, noteTags, removeTag, sanitise, tagKey } from './notes.js';
import { tx } from './core.jsx';
import { applySort } from './filters.js';

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

/* ---- tags on one note ----
   Typed, not picked: Enter or a comma files what is in the box, Backspace in
   an empty box takes the last one back off. The tags already in use are
   offered as suggestions so "reading" and "Reading list" do not drift apart
   by accident. */
function NoteTags({ note, allTags = [], onChange }) {
  const [draft, setDraft] = useState('');
  const tags = noteTags(note);
  const commit = () => {
    if (!draft.trim()) return;
    onChange({ tags: addTags(note, draft) });
    setDraft('');
  };
  const listId = `note-tags-${note.id}`;
  return (
    <div className="note-tags">
      <Hash size={13} className="note-tags-ic" />
      {tags.map((t) => (
        <span key={tagKey(t)} className="note-tag">
          {t}
          <button onClick={() => onChange({ tags: removeTag(note, t) })} aria-label={`${tx('Remove tag', 'أزل الوسم')} ${t}`}><X size={11} /></button>
        </span>
      ))}
      <input
        className="note-tag-in"
        list={listId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
          else if (e.key === 'Backspace' && !draft && tags.length) onChange({ tags: removeTag(note, tags[tags.length - 1]) });
        }}
        onBlur={commit}
        placeholder={tags.length ? tx('Add tag', 'أضف وسمًا') : tx('Tag this note…', 'ضع وسمًا لهذه الملاحظة…')}
        aria-label={tx('Add a tag', 'أضف وسمًا')}
      />
      <datalist id={listId}>
        {allTags.filter((x) => !hasTag(note, x.tag)).map((x) => <option key={tagKey(x.tag)} value={x.tag} />)}
      </datalist>
    </div>
  );
}

export function NoteEditor({ note, onChange, onClose, onDelete, taskTitle, allTags = [] }) {
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

        <NoteTags note={note} allTags={allTags} onChange={onChange} />

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

/* Remembered per device: how someone likes to look at their wall is a
   preference, not data, and it should not ride sync to a phone where the
   other arrangement suits the screen better. */
const GROUP_PREF = 'rhythm:notes:group';
const readGroupPref = () => { try { return localStorage.getItem(GROUP_PREF) === 'tag'; } catch { return false; } };
const writeGroupPref = (on) => { try { localStorage.setItem(GROUP_PREF, on ? 'tag' : 'none'); } catch { /* private mode */ } };

export function NotesView({ notes, sky, stars, heroLight, SkyScene, filterBar, sort, onOpen, onNew, onChange, taskTitleFor }) {
  const [q, setQ] = useState('');
  const [tagOn, setTagOn] = useState(null);          // one tag narrowed to, or null
  const [grouped, setGrouped] = useState(readGroupPref);
  const tagList = allNoteTags(notes);
  // A tag that no note carries any more stops filtering, rather than leaving
  // an empty wall with no way to tell why.
  const activeTag = tagOn && tagList.some((x) => tagKey(x.tag) === tagKey(tagOn)) ? tagOn : null;
  const term = q.trim().toLowerCase();
  const found = notes
    .filter((n) => !activeTag || hasTag(n, activeTag))
    .filter((n) => !term || `${n.title} ${noteTags(n).join(' ')} ${excerpt(n.body, 4000)}`.toLowerCase().includes(term));
  /* Pinned stays above the sort whatever it is: pinning is a statement about
     where something belongs on the wall, and an ordering that ignores it makes
     the pin do nothing. */
  const shown = applySort(found, sort === 'title' ? 'title' : 'recent', { title: (n) => n.title || excerpt(n.body, 40) })
    .slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  /* One card on the wall. Its tags are shown, and tapping one narrows the
     wall to it. */
  const card = (n) => {
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
        {noteTags(n).length > 0 && (
          <span className="note-card-tags">
            {noteTags(n).map((t) => (
              <span key={tagKey(t)} className="note-card-tag" role="button" tabIndex={0}
                onClick={(e) => { e.stopPropagation(); setTagOn(t); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setTagOn(t); } }}>#{t}</span>
            ))}
          </span>
        )}
        <span className="note-card-f">
          {from ? <span className="note-card-task">“{from}”</span> : null}
          <span className="note-stamp">{stamp(n.updatedAt)}</span>
        </span>
      </button>
    );
  };

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
          {filterBar}
          {tagList.length > 0 && (
            <button className={`ghost sm note-groupbtn ${grouped ? 'on' : ''}`} aria-pressed={grouped}
              onClick={() => { setGrouped(!grouped); writeGroupPref(!grouped); }}
              title={tx('Group the wall by tag', 'جمّع الملاحظات حسب الوسم')}>
              <Layers size={14} /> {tx('Group by tag', 'حسب الوسم')}
            </button>
          )}
          {/* Narrowed to a tag, a new note starts with that tag — it was
              written from inside that group. */}
          <button className="primary sm" onClick={() => onNew(activeTag ? { tags: [activeTag] } : undefined)}><Plus size={15} /> {tx('New note', 'ملاحظة جديدة')}</button>
        </div>

        {tagList.length > 0 && (
          <div className="note-tagbar" role="toolbar" aria-label={tx('Tags', 'الوسوم')}>
            <button className={`note-tagchip ${!activeTag ? 'on' : ''}`} onClick={() => setTagOn(null)}>{tx('All', 'الكل')}</button>
            {tagList.map((x) => {
              const on = !!activeTag && tagKey(activeTag) === tagKey(x.tag);
              return (
                <button key={tagKey(x.tag)} className={`note-tagchip ${on ? 'on' : ''}`} aria-pressed={on}
                  onClick={() => setTagOn(on ? null : x.tag)}>
                  <Hash size={11} />{x.tag}<span className="note-tagchip-n">{x.count}</span>
                </button>
              );
            })}
          </div>
        )}

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
            would leave a hole under every short one. Grouped, each tag gets
            its own wall; a note with two tags is on both. */}
        {grouped && !activeTag
          ? groupByTag(shown).map((g) => (
              <section key={g.tag == null ? '__none' : tagKey(g.tag)} className="note-group">
                <h4 className="note-group-h">
                  {g.tag == null ? tx('Untagged', 'بلا وسم') : <><Hash size={12} />{g.tag}</>}
                  <span className="note-group-n">{g.notes.length}</span>
                </h4>
                <div className="note-wall">{g.notes.map((n) => card(n))}</div>
              </section>
            ))
          : <div className="note-wall">{shown.map((n) => card(n))}</div>}
      </div>
    </div>
  );
}

export { isEmptyNote };
