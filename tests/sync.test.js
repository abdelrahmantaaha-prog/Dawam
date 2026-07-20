/* Sync engine tests — the merge is the part that must be right.
   A mock transport stands in for the backend, so these cover the merge
   independently of who stores the bytes. */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSync, AUTO_EVERY_MS } from '../src/sync.js';

// minimal localStorage for node
function makeLS() {
  let m = {};
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    key: (i) => Object.keys(m)[i] ?? null,
    get length() { return Object.keys(m).length; },
    _dump: () => ({ ...m }),
  };
}

/* A transport backed by a plain array, mimicking a remote table. */
function mockTransport(rows = []) {
  const upserts = [];
  return {
    rows,
    upserts,
    list: async () => [...rows],
    upsert: async (r) => {
      upserts.push(...r);
      r.forEach((x) => { const i = rows.findIndex((y) => y.key === x.key); if (i >= 0) rows[i] = x; else rows.push(x); });
    },
  };
}

let ls, applied;

beforeEach(() => {
  ls = makeLS();
  globalThis.localStorage = ls;
  applied = [];
});

const engine = (transport, now = () => 1_000_000) =>
  createSync({ getTransport: () => transport, onRemote: (k, v) => applied.push([k, v]), now });

describe('syncNow — last-write-wins per key', () => {
  it('remote newer than local → pulled, applied, not echoed back', async () => {
    ls.setItem('planner:settings', '{"local":true}');
    ls.setItem('rhythm:sync:meta', JSON.stringify({ 'planner:settings': 100 }));
    const t = mockTransport([{ key: 'planner:settings', value: '{"remote":true}', updated_at: new Date(200).toISOString() }]);
    const r = await engine(t).syncNow();
    expect(r.pulled).toBe(1);
    expect(ls.getItem('planner:settings')).toBe('{"remote":true}');
    expect(applied).toEqual([['planner:settings', '{"remote":true}']]);
    expect(t.upserts.find((u) => u.key === 'planner:settings')).toBeUndefined(); // no echo
  });

  it('local newer than remote → pushed, remote copy not applied', async () => {
    ls.setItem('planner:pool', '[1]');
    ls.setItem('rhythm:sync:meta', JSON.stringify({ 'planner:pool': 900 }));
    ls.setItem('rhythm:sync:dirty', JSON.stringify(['planner:pool']));
    const t = mockTransport([{ key: 'planner:pool', value: '[0]', updated_at: new Date(500).toISOString() }]);
    const r = await engine(t).syncNow();
    expect(r.pulled).toBe(0);
    expect(r.pushed).toBe(1);
    expect(ls.getItem('planner:pool')).toBe('[1]');
    expect(t.upserts[0]).toMatchObject({ key: 'planner:pool', value: '[1]' });
    expect(JSON.parse(ls.getItem('rhythm:sync:dirty'))).toEqual([]); // queue drained
  });

  it('local keys the remote has never seen are seeded, even if not dirty', async () => {
    ls.setItem('planner:week:2026-07-04', '{"tasks":[]}');
    const t = mockTransport([]);
    const r = await engine(t).syncNow();
    expect(r.pushed).toBe(1);
    expect(t.upserts[0].key).toBe('planner:week:2026-07-04');
  });

  it('non-syncable keys are never pushed', async () => {
    ls.setItem('planner:__probe', 'x');
    ls.setItem('rhythm:sync:meta', '{}');
    ls.setItem('other:thing', 'y');
    const r = await engine(mockTransport([])).syncNow();
    expect(r.pushed).toBe(0);
  });

  it('no backend configured → clean no-op', async () => {
    const r = await createSync({ getTransport: () => null, now: () => 1 }).syncNow();
    expect(r.skipped).toBe('not configured');
  });

  it('two-device round trip converges', async () => {
    // Device A edits settings at t=300 and pushes to an empty remote.
    ls.setItem('planner:settings', '{"v":"A"}');
    ls.setItem('rhythm:sync:meta', JSON.stringify({ 'planner:settings': 300 }));
    ls.setItem('rhythm:sync:dirty', JSON.stringify(['planner:settings']));
    const shared = mockTransport([]);
    await engine(shared).syncNow();
    expect(shared.rows).toHaveLength(1);
    // Device B: fresh localStorage, pulls A's value.
    ls = makeLS(); globalThis.localStorage = ls; applied = [];
    const rB = await engine(shared).syncNow();
    expect(rB.pulled).toBe(1);
    expect(ls.getItem('planner:settings')).toBe('{"v":"A"}');
  });
});

describe('automatic cadence — twice a day', () => {
  it('is due on a fresh install, and runs', async () => {
    const t = mockTransport([]);
    const e = engine(t, () => 5_000_000);
    expect(e.autoDue()).toBe(true);
    const r = await e.syncNow({ auto: true });
    expect(r.skipped).toBeUndefined();
  });

  it('a second automatic run inside the window is skipped', async () => {
    const t = mockTransport([]);
    let clock = 5_000_000;
    const e = engine(t, () => clock);
    await e.syncNow({ auto: true });
    clock += AUTO_EVERY_MS - 1;
    const r = await e.syncNow({ auto: true });
    expect(r.skipped).toBe('not due');
  });

  it('becomes due again once the window has passed', async () => {
    const t = mockTransport([]);
    let clock = 5_000_000;
    const e = engine(t, () => clock);
    await e.syncNow({ auto: true });
    clock += AUTO_EVERY_MS;
    expect(e.autoDue()).toBe(true);
    const r = await e.syncNow({ auto: true });
    expect(r.skipped).toBeUndefined();
  });

  it('a manual sync ignores the window', async () => {
    const t = mockTransport([]);
    let clock = 5_000_000;
    const e = engine(t, () => clock);
    await e.syncNow({ auto: true });
    clock += 1000;
    const r = await e.syncNow(); // manual
    expect(r.skipped).toBeUndefined();
  });
});

describe('markDirty', () => {
  it('stamps meta and queues syncable keys only', () => {
    const e = engine(mockTransport([]), () => 42);
    e.markDirty('planner:pool');
    e.markDirty('planner:__probe');
    e.markDirty('unrelated');
    expect(JSON.parse(ls.getItem('rhythm:sync:dirty'))).toEqual(['planner:pool']);
    expect(JSON.parse(ls.getItem('rhythm:sync:meta'))['planner:pool']).toBe(42);
  });
});
