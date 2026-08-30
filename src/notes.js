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
  taskId: null,          // the task it was written from, if any
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

/* Notebooks written from a task. A task can carry several — a plan and a
   transcript are not the same page. */
export const notesForTask = (notes, taskId) => (notes || []).filter((n) => n.taskId && n.taskId === taskId);
