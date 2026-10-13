/* ------------------------------------------------------------------ */
/*  Notebooks — rich text that lives on its own.                       */
/*                                                                     */
/*  A task's `notes` are scraps: a link, a line, a picture. A notebook  */
/*  is the other thing — the page you actually write on, opened and     */
/*  edited by itself, and findable later whether or not you remember    */
/*  which task it hung off. So notebooks are top-level documents that   */
/*  a task may point at, rather than a field inside a task.             */
/*                                                                     */
/*  One storage key each. The week documents are already the thing that */
/*  makes sync coarse — two devices editing the same week trade whole    */
/*  weeks — and a single "all notebooks" document would be far worse:   */
/*  every edit to any note would collide with every other.              */
/*                                                                     */
/*  The body is HTML, and that is the one genuinely dangerous choice    */
/*  here. It is re-rendered into the app's own origin, which holds the  */
/*  key pool token and the sync device token, so a paste from a web     */
/*  page carrying a script or an onerror handler would be running with  */
/*  those in reach. Everything written is put through `sanitise` on the */
/*  way in AND on the way out — on the way out too because a document   */
/*  can arrive from sync, from an imported backup, or from a file       */
/*  edited by hand, none of which went through the editor.              */
/* ------------------------------------------------------------------ */
import { loadKey, saveKey, rawList, rawDelete } from './storage.js';
import { markDeleted } from './sync.js';
import { fmtISO, uid } from './core.jsx';

const PREFIX = 'planner:note:';
export const noteKey = (id) => `${PREFIX}${id}`;

export const NOTE_COLOURS = ['#F4FAF6', '#FDF2D0', '#FBE0DC', '#DDEBF7', '#E5E0F5', '#DFF2E4', '#F7E6D5'];

/* What a paste is allowed to keep. Formatting a person would actually use,
   and nothing that can execute, load, or navigate on its own. */
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'CODE', 'PRE', 'BR', 'P', 'DIV', 'SPAN',
  'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'A', 'HR']);
/* href only, and only on a link. No style: a pasted style attribute is how
   white-on-white text and 4000px images get in. */
const ALLOWED_ATTR = { A: new Set(['href']) };
const SAFE_HREF = /^(https?:|mailto:|#|\/)/i;

/* Strip everything not on the list, keeping the text inside it — losing a
   paragraph's words because it arrived wrapped in a <section> would be worse
   than the tag. */
export function sanitise(html) {
  const src = String(html == null ? '' : html);
  if (!src) return '';
  if (typeof document === 'undefined') return src.replace(/<[^>]*>/g, ''); // no DOM: text only
  const doc = document.implementation.createHTMLDocument('');
  doc.body.innerHTML = src;

  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) continue;                    // text
      if (child.nodeType !== 1) { child.remove(); continue; } // comments, etc.
      const tag = child.tagName;
      if (!ALLOWED.has(tag)) {
        // Unwrap rather than delete, unless the element is one whose CONTENT
        // is also unsafe — a <script>'s text is the payload.
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'OBJECT' || tag === 'EMBED') child.remove();
        else { while (child.firstChild) node.insertBefore(child.firstChild, child); child.remove(); }
        continue;
      }
      for (const attr of [...child.attributes]) {
        const ok = (ALLOWED_ATTR[tag] || new Set()).has(attr.name.toLowerCase());
        if (!ok) { child.removeAttribute(attr.name); continue; }
        if (attr.name.toLowerCase() === 'href' && !SAFE_HREF.test(attr.value.trim())) child.removeAttribute(attr.name);
      }
      if (tag === 'A') { child.setAttribute('rel', 'noreferrer noopener'); child.setAttribute('target', '_blank'); }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/* The first line, for a card's heading when nobody typed a title. */
export function excerpt(html, max = 180) {
  const text = String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-3])>/gi, '\n').replace(/<[^>]*>/g, ' ');
  const clean = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

export const isEmptyNote = (n) => !String(n && n.title || '').trim() && !excerpt((n && n.body) || '').trim();

export const newNote = (over = {}) => ({
  id: uid(),
  title: '',
  body: '',
  colour: NOTE_COLOURS[0],
  pinned: false,
  tags: [],              // free words for finding and grouping — see noteTags
  taskId: null,          // the task it was written from, if any
  eventKey: null,        // or the calendar occurrence — "uid|startMs"
  createdAt: fmtISO(new Date()),
  updatedAt: Date.now(),
  ...over,
});

export async function loadNotes() {
  const keys = await rawList(PREFIX);
  const out = [];
  for (const k of keys) {
    const doc = await loadKey(k);
    if (doc && doc.id) out.push({ ...doc, body: sanitise(doc.body) });
  }
  // Pinned first, then most recently touched — the Keep arrangement, and the
  // one that puts what you were last writing where your eye already is.
  return out.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function saveNote(note) {
  const clean = { ...note, body: sanitise(note.body), updatedAt: Date.now() };
  await saveKey(noteKey(clean.id), clean);
  return clean;
}

export async function deleteNote(id) {
  await rawDelete(noteKey(id));
  markDeleted(noteKey(id));
}

/* ---- drop-offs ----
   Other programs on this PC (Claude, chiefly) can add topics to a notebook
   without reaching into the planner's storage: the desktop shell picks up a
   `notebook-add-*.json` file from the backups folder and hands it here. Each
   topic becomes a bullet at the end of the notebook with that title — made,
   and pinned, the first time — so the entry is stamped and synced exactly like
   a line typed by hand. Text only: whatever arrives is escaped, never parsed. */
export const LATER_NOTEBOOK = 'To look into';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function dropLine(item) {
  const topic = String((item && (item.topic || item.text)) || '').trim().slice(0, 300);
  const detail = String((item && item.detail) || '').trim().slice(0, 1000);
  if (!topic) return '';
  return `<li><b>${esc(topic)}</b>${detail ? ` — ${esc(detail)}` : ''}</li>`;
}

/* Into the notebook's last list when it ends with one, so a run of topics
   reads as one list; otherwise a new list at the end. */
export function appendTopics(body, items) {
  const lines = (items || []).map(dropLine).join('');
  if (!lines) return String(body || '');
  const b = String(body || '');
  const tail = b.match(/<\/ul>\s*$/i);
  return tail ? b.slice(0, tail.index) + lines + b.slice(tail.index) : `${b}<ul>${lines}</ul>`;
}

/* The note a drop-off turns into, or null when it carries nothing usable. */
export function fileDrop(notes, drop) {
  const items = drop && Array.isArray(drop.items) ? drop.items : [];
  if (!items.some(dropLine)) return null;
  const title = String((drop && drop.notebook) || '').trim().slice(0, 120) || LATER_NOTEBOOK;
  const found = (notes || []).find((n) => tagKey(n.title) === tagKey(title));
  const base = found || newNote({ title, pinned: true, colour: NOTE_COLOURS[3] });
  return { note: { ...base, body: appendTopics(base.body, items) }, isNew: !found };
}

/* Notebooks written from a task. A task can carry several — a plan and a
   transcript are not the same page. */
export const notesForTask = (notes, taskId) => (notes || []).filter((n) => n.taskId && n.taskId === taskId);

/* Per OCCURRENCE, not per series: the agenda for this Monday is not the agenda
   for next Monday, which is exactly the opposite of the description. */
export const notesForEvent = (notes, eventKey) => (notes || []).filter((n) => n.eventKey && n.eventKey === eventKey);

/* ---- tags ----
   A note's tags are its own words, not the planner's labels: a label is a
   colour for work, and a note about "Arabic grammar" should not have to
   invent a task tag to be findable. Kept as written (so "Mutarjim" stays
   capitalised) but compared without case or a leading '#', so "#ideas",
   "Ideas" and "ideas " are one tag. */
export const tagKey = (t) => String(t == null ? '' : t).trim().replace(/^#+/, '').replace(/\s+/g, ' ').toLowerCase();
export const cleanTag = (t) => String(t == null ? '' : t).trim().replace(/^#+/, '').replace(/\s+/g, ' ').slice(0, 40);

/* A note's tags, de-duplicated, empties dropped. Old notes have none. */
export function noteTags(note) {
  const seen = new Set();
  const out = [];
  for (const raw of (note && Array.isArray(note.tags) ? note.tags : [])) {
    const t = cleanTag(raw);
    const k = tagKey(t);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(t);
  }
  return out;
}

/* Add one or several tags ("ideas, reading #later") to a note's list. */
export function addTags(note, text) {
  const words = String(text || '').split(/[,\n]|\s(?=#)/).map(cleanTag).filter(Boolean);
  return noteTags({ tags: [...noteTags(note), ...words] });
}

export const removeTag = (note, tag) => noteTags(note).filter((t) => tagKey(t) !== tagKey(tag));
export const hasTag = (note, tag) => noteTags(note).some((t) => tagKey(t) === tagKey(tag));

/* Every tag in use, with how many notes carry it, most used first — the first
   spelling seen is the one shown. */
export function allNoteTags(notes) {
  const by = new Map();
  for (const n of notes || []) {
    for (const t of noteTags(n)) {
      const k = tagKey(t);
      const cur = by.get(k);
      if (cur) cur.count += 1; else by.set(k, { tag: t, count: 1 });
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/* The wall grouped by tag. A note with two tags appears under both — a group
   is a way of looking, not a folder a note has to live in exactly once — and
   untagged notes come last, under `tag: null`. Order within a group is the
   order given. */
export function groupByTag(notes) {
  const groups = new Map();
  const loose = [];
  for (const n of notes || []) {
    const tags = noteTags(n);
    if (!tags.length) { loose.push(n); continue; }
    for (const t of tags) {
      const k = tagKey(t);
      if (!groups.has(k)) groups.set(k, { tag: t, notes: [] });
      groups.get(k).notes.push(n);
    }
  }
  const out = [...groups.values()].sort((a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' }));
  if (loose.length) out.push({ tag: null, notes: loose });
  return out;
}
