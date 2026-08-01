/* The local half: turning storage into a document and back.

   This is where an echo bug would live. Applying a remote key must NOT look
   like a local edit, or the device re-stamps it, believes it has something to
   push, pushes it, adopts the reply, and loops — the same failure mode as the
   JSON.stringify comparison, reached by a different road. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

function makeLS() {
  let m = {};
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    key: (i) => Object.keys(m)[i] ?? null,
    get length() { return Object.keys(m).length; },
    _all: () => ({ ...m }),
  };
}

let ls;
beforeEach(async () => {
  ls = makeLS();
  globalThis.localStorage = ls;
  vi.resetModules();
});

const load = () => import('../src/sync.js');

describe('readLocalDoc', () => {
  it('collects syncable keys and skips the rest', async () => {
    const { readLocalDoc, markDirty } = await load();
    ls.setItem('planner:pool', '[1]');
    ls.setItem('planner:week:2026-07-25', '{"tasks":[]}');
    ls.setItem('planner:__probe', 'x');
    ls.setItem('planner:prayers:2026-07-25', 'x');
    ls.setItem('rhythm:sync:meta', '{}');
    markDirty('planner:pool', 500);
    const doc = await readLocalDoc();
    expect(Object.keys(doc.keys).sort()).toEqual(['planner:pool', 'planner:week:2026-07-25']);
    expect(doc.keys['planner:pool'].updatedAt).toBe(500);
  });

  it('stamps an unknown key at 1 so a real remote timestamp beats it', async () => {
    const { readLocalDoc } = await load();
    ls.setItem('planner:settings', '{}');
    const doc = await readLocalDoc();
    // Not Date.now(): a key that predates bookkeeping must not claim to be the
    // newest copy and clobber a genuine edit from another device.
    expect(doc.keys['planner:settings'].updatedAt).toBe(1);
  });

  it('carries tombstones for pruned keys', async () => {
    const { readLocalDoc, markDeleted } = await load();
    markDeleted('planner:week:2026-01-01', 900);
    const doc = await readLocalDoc();
    expect(doc.keys['planner:week:2026-01-01']).toEqual({ deletedAt: 900 });
  });
});

describe('applyDoc', () => {
  it('writes remote values and reports what changed', async () => {
    const { applyDoc } = await load();
    ls.setItem('planner:pool', '[1]');
    const touched = await applyDoc({ v: 1, keys: {
      'planner:pool': { value: '[2]', updatedAt: 50 },
      'planner:settings': { value: '{"lang":"ar"}', updatedAt: 60 },
    } });
    expect(ls.getItem('planner:pool')).toBe('[2]');
    expect(touched.sort()).toEqual(['planner:pool', 'planner:settings']);
  });

  it('does not report keys that were already identical', async () => {
    const { applyDoc } = await load();
    ls.setItem('planner:pool', '[1]');
    const touched = await applyDoc({ v: 1, keys: { 'planner:pool': { value: '[1]', updatedAt: 50 } } });
    // Nothing moved, so nothing should re-render.
    expect(touched).toEqual([]);
  });

  it('applying remote does NOT make the key look locally edited (echo guard)', async () => {
    const { applyDoc, readLocalDoc } = await load();
    const remote = { v: 1, keys: { 'planner:pool': { value: '[9]', updatedAt: 777 } } };
    await applyDoc(remote);
    const doc = await readLocalDoc();
    // The adopted key keeps the SERVER's timestamp. If it were re-stamped with
    // "now", the very next comparison would look like a local change and push
    // it straight back.
    expect(doc.keys['planner:pool'].updatedAt).toBe(777);
    expect(doc.keys['planner:pool'].value).toBe('[9]');
  });

  it('a round trip through storage is stable — nothing is owed afterwards', async () => {
    const { applyDoc, readLocalDoc } = await load();
    const { fingerprint } = await import('../shared/model.js');
    const server = { v: 1, keys: {
      'planner:settings': { value: '{"lang":"en"}', updatedAt: 10 },
      'planner:week:2026-07-25': { value: '{"tasks":[]}', updatedAt: 20 },
    } };
    await applyDoc(server);
    const back = await readLocalDoc();
    // THE loop test: what we would push next must equal what the server holds.
    expect(fingerprint(back)).toBe(fingerprint(server));
  });

  it('a tombstone deletes the local key', async () => {
    const { applyDoc } = await load();
    ls.setItem('planner:week:2026-01-01', '{"tasks":[]}');
    const touched = await applyDoc({ v: 1, keys: { 'planner:week:2026-01-01': { deletedAt: 99 } } });
    expect(ls.getItem('planner:week:2026-01-01')).toBe(null);
    expect(touched).toEqual(['planner:week:2026-01-01']);
  });
});

describe('markDirty / markDeleted', () => {
  it('markDirty stamps only syncable keys', async () => {
    const { markDirty } = await load();
    markDirty('planner:pool', 42);
    markDirty('planner:__probe', 42);
    markDirty('unrelated', 42);
    const meta = JSON.parse(ls.getItem('rhythm:sync:meta'));
    expect(Object.keys(meta)).toEqual(['planner:pool']);
  });

  it('re-creating a deleted key clears its tombstone', async () => {
    const { markDirty, markDeleted, readLocalDoc } = await load();
    markDeleted('planner:week:2026-01-01', 100);
    markDirty('planner:week:2026-01-01', 200);
    ls.setItem('planner:week:2026-01-01', '{"tasks":[]}');
    const doc = await readLocalDoc();
    expect(doc.keys['planner:week:2026-01-01'].deletedAt).toBeUndefined();
    expect(doc.keys['planner:week:2026-01-01'].updatedAt).toBe(200);
  });
});
