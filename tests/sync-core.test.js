/* The server push algorithm, against an in-memory store.

   This is the part that can lose data — merge, compare-and-set, retry — so it
   is tested without needing a live Postgres. `store` is the same seam _db.js
   implements over Neon. */
import { describe, it, expect } from 'vitest';
import { pushDocument, TooLarge, Conflict } from '../api/_sync-core.js';
import { fingerprint } from '../shared/model.js';

const entry = (value, updatedAt) => ({ value, updatedAt });
const doc = (keys) => ({ v: 1, keys });

/* Mirrors _db.js: rev-guarded update, insert-if-absent. */
function memStore(initial = null) {
  let row = initial;
  return {
    get row() { return row; },
    async get() { return row ? { ...row } : null; },
    async insert(userId, email, d) {
      if (row) return { inserted: false };
      row = { rev: 1, doc: d };
      return { rev: 1, inserted: true };
    },
    async update(userId, email, d, bytes, expectedRev) {
      if (!row || row.rev !== expectedRev) return null; // someone else moved it
      row = { rev: row.rev + 1, doc: d };
      return { rev: row.rev };
    },
  };
}

describe('pushDocument', () => {
  it('creates the row on a first push', async () => {
    const s = memStore();
    const out = await pushDocument(s, 'u1', 'a@b.c', doc({ 'planner:pool': entry('[]', 10) }));
    expect(out.rev).toBe(1);
    expect(out.doc.keys['planner:pool'].value).toBe('[]');
  });

  it('merges into an existing row rather than overwriting it', async () => {
    const s = memStore({ rev: 1, doc: doc({ 'planner:week:2026-07-25': entry('A', 10) }) });
    const out = await pushDocument(s, 'u1', null, doc({ 'planner:settings': entry('S', 20) }));
    expect(out.rev).toBe(2);
    // the other device's week survived
    expect(out.doc.keys['planner:week:2026-07-25'].value).toBe('A');
    expect(out.doc.keys['planner:settings'].value).toBe('S');
  });

  it('newer client data wins on the same key', async () => {
    const s = memStore({ rev: 1, doc: doc({ 'planner:pool': entry('old', 10) }) });
    const out = await pushDocument(s, 'u1', null, doc({ 'planner:pool': entry('new', 20) }));
    expect(out.doc.keys['planner:pool'].value).toBe('new');
  });

  it('older client data does NOT clobber the server', async () => {
    const s = memStore({ rev: 1, doc: doc({ 'planner:pool': entry('server', 99) }) });
    const out = await pushDocument(s, 'u1', null, doc({ 'planner:pool': entry('stale', 5) }));
    expect(out.doc.keys['planner:pool'].value).toBe('server');
  });

  it('is idempotent — pushing the same document twice settles', async () => {
    const s = memStore();
    const d = doc({ 'planner:pool': entry('[]', 10) });
    const a = await pushDocument(s, 'u1', null, d);
    const b = await pushDocument(s, 'u1', null, d);
    // Content identical: this is the property that stops push→adopt→push.
    expect(fingerprint(a.doc)).toBe(fingerprint(b.doc));
  });

  it('retries when another writer moves the revision mid-flight', async () => {
    const s = memStore({ rev: 1, doc: doc({ 'planner:pool': entry('a', 1) }) });
    let first = true;
    const racing = {
      ...s,
      async get() { return s.get(); },
      async insert(...args) { return s.insert(...args); },
      async update(userId, email, d, bytes, expectedRev) {
        if (first) { first = false; return null; } // simulate a lost race once
        return s.update(userId, email, d, bytes, expectedRev);
      },
    };
    const out = await pushDocument(racing, 'u1', null, doc({ 'planner:settings': entry('S', 10) }));
    expect(out.doc.keys['planner:settings'].value).toBe('S');
  });

  it('gives up with Conflict when it keeps losing', async () => {
    const s = memStore({ rev: 1, doc: doc({}) });
    const always = { ...s, async get() { return s.get(); }, async update() { return null; } };
    await expect(pushDocument(always, 'u1', null, doc({ 'planner:pool': entry('x', 1) }))).rejects.toBeInstanceOf(Conflict);
  });

  it('rejects a document that is too large', async () => {
    const huge = doc({ 'planner:pool': entry('x'.repeat(5 * 1024 * 1024), 1) });
    await expect(pushDocument(memStore(), 'u1', null, huge)).rejects.toBeInstanceOf(TooLarge);
  });

  it('rejects nonsense instead of storing it', async () => {
    await expect(pushDocument(memStore(), 'u1', null, null)).rejects.toMatchObject({ code: 'bad-doc' });
    await expect(pushDocument(memStore(), 'u1', null, [1, 2])).rejects.toMatchObject({ code: 'bad-doc' });
  });
});
