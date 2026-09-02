/* A write that did not land must never look like one that did.

   The failure this locks down cost a person their tasks on two devices at
   once. localStorage filled up; rawSet swallowed the quota error; the app
   showed the task anyway because it was in React state; and saveKey ran the
   save hook regardless, so sync marked the key dirty and told the server the
   OLD value was this device's newest edit. The other device then adopted the
   stale copy over its own good one. Every assertion here is one link of that
   chain. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

function makeLS({ full = false } = {}) {
  const m = {};
  return {
    full,
    getItem: (k) => (k in m ? m[k] : null),
    setItem(k, v) {
      if (this.full) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      m[k] = String(v);
    },
    removeItem: (k) => { delete m[k]; },
    key: (i) => Object.keys(m)[i] ?? null,
    get length() { return Object.keys(m).length; },
    _all: () => ({ ...m }),
  };
}

let ls;
beforeEach(() => { vi.resetModules(); ls = makeLS(); globalThis.localStorage = ls; });

const loadStorage = () => import('../src/storage.js');
const loadSync = () => import('../src/sync.js');

describe('a refused write', () => {
  it('reports failure instead of returning quietly', async () => {
    const { rawSet, writesFailing } = await loadStorage();
    expect(await rawSet('planner:pool', '[]')).toBe(true);
    expect(writesFailing()).toBe(false);

    ls.full = true;
    expect(await rawSet('planner:pool', '[1]')).toBe(false);
    expect(writesFailing()).toBe(true);
  });

  it('does not mark the key dirty — this is what pushed stale data to the other device', async () => {
    const { saveKey, setSaveHook } = await loadStorage();
    const dirtied = [];
    setSaveHook((k) => dirtied.push(k));

    expect(await saveKey('planner:pool', [1])).toBe(true);
    expect(dirtied).toEqual(['planner:pool']);

    ls.full = true;
    expect(await saveKey('planner:pool', [1, 2])).toBe(false);
    expect(dirtied).toEqual(['planner:pool']); // no second entry
    expect(JSON.parse(ls.getItem('planner:pool'))).toEqual([1]); // the old value is what is really there
  });

  it('clears the alarm once a write is accepted again', async () => {
    const { rawSet, writesFailing } = await loadStorage();
    ls.full = true;
    await rawSet('planner:pool', '[1]');
    expect(writesFailing()).toBe(true);
    ls.full = false;
    await rawSet('planner:pool', '[1]');
    expect(writesFailing()).toBe(false);
  });

  it('tells its watchers, so the banner cannot stay quiet', async () => {
    const { rawSet, onStorageHealth } = await loadStorage();
    const seen = [];
    onStorageHealth((s) => seen.push(s.failing));
    ls.full = true;
    await rawSet('planner:pool', '[1]');
    expect(seen).toEqual([true]);
  });
});

describe('applyDoc against a full store', () => {
  it('refuses to record a timestamp for a value it could not write', async () => {
    const { applyDoc, syncMeta } = await loadSync();
    ls.full = true;
    const doc = { v: 1, keys: { 'planner:pool': { value: '[1]', updatedAt: 5000 } } };

    await expect(applyDoc(doc)).rejects.toThrow('storage-full');
    // Claiming updatedAt here would tell the next push that this device's
    // (missing) copy is current.
    expect(syncMeta()['planner:pool']).toBeUndefined();
    expect(ls.getItem('planner:pool')).toBeNull();
  });

  it('still applies what it can, and keeps the keys that landed', async () => {
    const { applyDoc, syncMeta } = await loadSync();
    const touched = await applyDoc({ v: 1, keys: { 'planner:pool': { value: '[1]', updatedAt: 5000 } } });
    expect(touched).toEqual(['planner:pool']);
    expect(syncMeta()['planner:pool']).toBe(5000);
  });
});

describe('what a backup is allowed to carry', () => {
  it('treats the rebuildable caches as disposable, exactly as sync does', async () => {
    const { isDerived, isSyncable } = await import('../shared/model.js');
    for (const k of ['planner:calcache:abc', 'planner:trellocache', 'planner:prayers:2026-09-03']) {
      expect(isDerived(k)).toBe(true);
      expect(isSyncable(k)).toBe(false); // the two must never disagree
    }
    for (const k of ['planner:pool', 'planner:week:2026-09-01', 'planner:settings', 'planner:calendars']) {
      expect(isDerived(k)).toBe(false);
      expect(isSyncable(k)).toBe(true);
    }
  });
});
