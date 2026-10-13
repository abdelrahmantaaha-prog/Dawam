/* @vitest-environment jsdom

   Only this file. The sanitiser needs a real HTML parser to be tested at all —
   a regex approximation of one is exactly the sort of thing that passes its
   own tests and lets a payload through — while the other four hundred tests
   stay in the fast node environment. */
/* The body of a notebook is HTML, re-rendered into the app's own origin — the
   origin that holds the key pool token and the sync device token. A paste from
   a web page carrying a script or an onerror handler would run with those in
   reach, so the sanitiser is the part of this feature that has to be right. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map();
vi.mock('../src/storage.js', () => ({
  loadKey: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null),
  saveKey: async (k, v) => { store.set(k, JSON.stringify(v)); },
  rawList: async (prefix) => [...store.keys()].filter((k) => k.startsWith(prefix)),
  rawDelete: async (k) => { store.delete(k); },
}));
vi.mock('../src/sync.js', () => ({ markDeleted: () => {} }));

const { sanitise, excerpt, newNote, saveNote, loadNotes, deleteNote, isEmptyNote, notesForTask, fileDrop, appendTopics, LATER_NOTEBOOK } =
  await import('../src/notes.js');

beforeEach(() => store.clear());

describe('sanitise — what a paste is allowed to keep', () => {
  it('keeps the formatting a person actually uses', () => {
    const html = '<p>Hello <b>bold</b> and <i>italic</i></p><ul><li>one</li></ul><h2>Head</h2>';
    expect(sanitise(html)).toBe(html);
  });

  it('removes a script outright, payload and all', () => {
    // Unwrapping this one would keep the code as visible text, but deleting is
    // the honest answer: its content IS the attack.
    const out = sanitise('<p>before</p><script>alert(1)</script><p>after</p>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('strips event handlers while keeping the element', () => {
    const out = sanitise('<p onclick="steal()">text</p>');
    expect(out).not.toContain('onclick');
    expect(out).toContain('text');
  });

  it('drops an img with an onerror payload', () => {
    const out = sanitise('<img src=x onerror="alert(1)">');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('<img');
  });

  it('refuses a javascript: link but keeps its words', () => {
    const out = sanitise('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('click');
  });

  it('keeps a real link, and makes it safe to open', () => {
    const out = sanitise('<a href="https://example.com">site</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('noreferrer');
  });

  it('drops style attributes', () => {
    // A pasted style is how white-on-white text and 4000px images get in.
    expect(sanitise('<p style="color:#fff">x</p>')).not.toContain('style');
  });

  it('unwraps an unknown tag rather than losing the words inside it', () => {
    const out = sanitise('<section><p>kept</p></section>');
    expect(out).toContain('kept');
    expect(out).not.toContain('section');
  });

  it('cleans nested and malformed attempts', () => {
    const out = sanitise('<div><SCRIPT>bad()</SCRIPT><p onmouseover=x>ok</p></div>');
    expect(out).not.toMatch(/script/i);
    expect(out).not.toContain('onmouseover');
    expect(out).toContain('ok');
  });

  it('survives empty and junk input', () => {
    expect(sanitise('')).toBe('');
    expect(sanitise(null)).toBe('');
    expect(sanitise(undefined)).toBe('');
  });
});

describe('excerpt', () => {
  it('reads the text out of the markup', () => {
    expect(excerpt('<h2>Title</h2><p>Body text</p>')).toBe('Title\nBody text');
  });
  it('turns breaks into lines and drops empties', () => {
    expect(excerpt('<p>one</p><p></p><p>two</p>')).toBe('one\ntwo');
  });
  it('truncates long text with an ellipsis', () => {
    const out = excerpt(`<p>${'x'.repeat(300)}</p>`, 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith('…')).toBe(true);
  });
  it('decodes the entities a contenteditable produces', () => {
    expect(excerpt('<p>a&nbsp;b &amp; c</p>')).toBe('a b & c');
  });
});

describe('storage', () => {
  it('round-trips a notebook', async () => {
    const n = await saveNote(newNote({ title: 'Plan', body: '<p>hello</p>' }));
    const all = await loadNotes();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ title: 'Plan', body: '<p>hello</p>' });
  });

  it('sanitises on the way out as well as in', async () => {
    // A document can arrive from sync, from an imported backup, or from a file
    // edited by hand — none of which went through the editor.
    store.set('planner:note:x', JSON.stringify({ id: 'x', title: 'T', body: '<script>bad()</script><p>ok</p>', updatedAt: 1 }));
    const [n] = await loadNotes();
    expect(n.body).not.toMatch(/script/i);
    expect(n.body).toContain('ok');
  });

  it('gives each notebook its own key, so two edits do not collide', async () => {
    await saveNote(newNote({ title: 'A' }));
    await saveNote(newNote({ title: 'B' }));
    expect([...store.keys()].filter((k) => k.startsWith('planner:note:'))).toHaveLength(2);
  });

  it('puts pinned first, then most recently touched', async () => {
    // Seeded straight into storage: saveNote stamps updatedAt itself, which is
    // right — a save IS a touch — and so it cannot be used to fake an age.
    const put = (n) => store.set(`planner:note:${n.id}`, JSON.stringify(n));
    put(newNote({ id: 'a', title: 'old', updatedAt: 1 }));
    put(newNote({ id: 'b', title: 'new', updatedAt: 5 }));
    put(newNote({ id: 'c', title: 'pinned', pinned: true, updatedAt: 2 }));
    expect((await loadNotes()).map((n) => n.title)).toEqual(['pinned', 'new', 'old']);
  });

  it('deletes', async () => {
    const n = await saveNote(newNote({ title: 'gone' }));
    await deleteNote(n.id);
    expect(await loadNotes()).toEqual([]);
  });
});

describe('attaching to a task', () => {
  it('finds every notebook written from one task', () => {
    const notes = [newNote({ taskId: 't1' }), newNote({ taskId: 't2' }), newNote({ taskId: 't1' }), newNote()];
    expect(notesForTask(notes, 't1')).toHaveLength(2);
  });
  it('never matches a loose notebook to a task', () => {
    expect(notesForTask([newNote()], undefined)).toHaveLength(0);
    expect(notesForTask([newNote({ taskId: null })], null)).toHaveLength(0);
  });
});

describe('isEmptyNote', () => {
  it('is true only when there is nothing at all', () => {
    expect(isEmptyNote(newNote())).toBe(true);
    expect(isEmptyNote(newNote({ body: '<p><br></p>' }))).toBe(true);
    expect(isEmptyNote(newNote({ title: 'x' }))).toBe(false);
    expect(isEmptyNote(newNote({ body: '<p>words</p>' }))).toBe(false);
  });
});

describe("drop-offs from outside — fileDrop", () => {
  it("makes the notebook, pinned, the first time", () => {
    const r = fileDrop([], { items: [{ topic: "Hawaii petitions", detail: "21,000 names" }] });
    expect(r.isNew).toBe(true);
    expect(r.note.title).toBe(LATER_NOTEBOOK);
    expect(r.note.pinned).toBe(true);
    expect(r.note.body).toBe("<ul><li><b>Hawaii petitions</b> — 21,000 names</li></ul>");
  });
  it("appends to the notebook with that title, whatever its case", () => {
    const mine = newNote({ title: "to look into", body: "<ul><li><b>A</b></li></ul>" });
    const r = fileDrop([newNote({ title: "Other" }), mine], { items: [{ topic: "B" }] });
    expect(r.isNew).toBe(false);
    expect(r.note.id).toBe(mine.id);
    expect(r.note.body).toBe("<ul><li><b>A</b></li><li><b>B</b></li></ul>");
  });
  it("starts a new list after writing that does not end in one", () => {
    expect(appendTopics("<p>my own words</p>", [{ topic: "C" }])).toBe("<p>my own words</p><ul><li><b>C</b></li></ul>");
  });
  it("uses the notebook named in the drop", () => {
    expect(fileDrop([], { notebook: "Books", items: [{ topic: "x" }] }).note.title).toBe("Books");
  });
  it("escapes what arrives instead of parsing it", () => {
    const r = fileDrop([], { items: [{ topic: "<img src=x onerror=alert(1)>", detail: "a & b" }] });
    expect(r.note.body).toContain("&lt;img");
    expect(sanitise(r.note.body)).not.toContain("<img");
    expect(r.note.body).toContain("a &amp; b");
  });
  it("ignores a drop with nothing in it", () => {
    expect(fileDrop([], {})).toBeNull();
    expect(fileDrop([], { items: [{ topic: "  " }] })).toBeNull();
    expect(fileDrop([], null)).toBeNull();
  });
  it("survives a save and a reload", async () => {
    const saved = await saveNote(fileDrop([], { items: [{ topic: "D" }] }).note);
    const [back] = await loadNotes();
    expect(back.id).toBe(saved.id);
    expect(back.body).toBe("<ul><li><b>D</b></li></ul>");
  });
});
