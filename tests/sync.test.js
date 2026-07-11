/* Sync engine tests — the merge is the part that must be right.
   A mock Supabase client stands in for the network; the live round-trip
   is verified against a real project (see README). */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSync } from '../src/sync.js';

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

function mockClient({ rows = [], user = { id: 'u1', email: 'a@b.c' } } = {}) {
  const upserts = [];
  return {
    upserts,
    rows,
    auth: {
      getSession: async () => ({ data: { session: user ? { user } : null } }),
      signInWithPassword: async () => ({ data: { user }, error: null }),
      signUp: async () => ({ data: { user }, error: null }),
      signOut: async () => ({}),
    },
    from: () => ({
      select: async () => ({ data: rows, error: null }),
      upsert: async (r) => { upserts.push(...r); return { error: null }; },
    }),
  };
}

const CFG = { url: 'https://x.supabase.co', anonKey: 'anon' };
let ls, applied;

beforeEach(() => {
  ls = makeLS();
  globalThis.localStorage = ls;
  applied = [];
});

const engine = (client, cfg = CFG, now = () => 1_000_000) =>
  createSync({ getConfig: () => cfg, onRemote: (k, v) => applied.push([k, v]), clientFactory: () => client, now });

describe('syncNow — last-write-wins per key', () => {
  it('remote newer than local → pulled, applied, not echoed back', async () => {
    ls.setItem('planner:settings', '{"local":true}');
    ls.setItem('rhythm:sync:meta', JSON.stringify({ 'planner:settings': 100 }));
    const c = mockClient({ rows: [{ key: 'planner:settings', value: '{"remote":true}', updated_at: new Date(200).toISOString() }] });
    const r = await engine(c).syncNow();
    expect(r.pulled).toBe(1);
    expect(ls.getItem('planner:settings')).toBe('{"remote":true}');
    expect(applied).toEqual([['planner:settings', '{"remote":true}']]);
    expect(c.upserts.find((u) => u.key === 'planner:settings')).toBeUndefined(); // no echo
  });

  it('local newer than remote → pushed, remote copy not applied', async () => {
    ls.setItem('planner:pool', '[1]');
    ls.setItem('rhythm:sync:meta', JSON.stringify({ 'planner:pool': 900 }));
    ls.setItem('rhythm:sync:dirty', JSON.stringify(['planner:pool']));
    const c = mockClient({ rows: [{ key: 'planner:pool', value: '[0]', updated_at: new Date(500).toISOString() }] });
    const r = await engine(c).syncNow();
    expect(r.pulled).toBe(0);
    expect(r.pushed).toBe(1);
    expect(ls.getItem('planner:pool')).toBe('[1]');
    expect(c.upserts[0]).toMatchObject({ key: 'planner:pool', value: '[1]', user_id: 'u1' });
    expect(JSON.parse(ls.getItem('rhythm:sync:dirty'))).toEqual([]); // queue drained
  });

  it('local keys the remote has never seen are seeded, even if not dirty', async () => {
    ls.setItem('planner:week:2026-07-04', '{"tasks":[]}');
    const c = mockClient({ rows: [] });
    const r = await engine(c).syncNow();
    expect(r.pushed).toBe(1);
    expect(c.upserts[0].key).toBe('planner:week:2026-07-04');
  });

  it('non-syncable keys are never pushed', async () => {
    ls.setItem('planner:__probe', 'x');
    ls.setItem('rhythm:sync:meta', '{}');
    ls.setItem('other:thing', 'y');
    const c = mockClient({ rows: [] });
    const r = await engine(c).syncNow();
    expect(r.pushed).toBe(0);
  });

  it('unconfigured → clean no-op', async () => {
    const c = mockClient({});
    const r = await engine(c, { url: '', anonKey: '' }).syncNow();
    expect(r.skipped).toBe('not configured');
  });

  it('signed out → clean no-op', async () => {
    const c = mockClient({ user: null });
    const r = await engine(c).syncNow();
    expect(r.skipped).toBe('signed out');
  });

  it('two-device round trip converges', async () => {
    // Device A edits settings at t=300 and pushes to an empty remote.
    ls.setItem('planner:settings', '{"v":"A"}');
    ls.setItem('rhythm:sync:meta', JSON.stringify({ 'planner:settings': 300 }));
    ls.setItem('rhythm:sync:dirty', JSON.stringify(['planner:settings']));
    const remote = [];
    const cA = mockClient({ rows: remote });
    cA.from = () => ({
      select: async () => ({ data: [...remote], error: null }),
      upsert: async (rows) => { rows.forEach((r) => { const i = remote.findIndex((x) => x.key === r.key); i >= 0 ? remote[i] = r : remote.push(r); }); return { error: null }; },
    });
    await engine(cA).syncNow();
    expect(remote).toHaveLength(1);
    // Device B: fresh localStorage, pulls A's value.
    ls = makeLS(); globalThis.localStorage = ls; applied = [];
    const cB = mockClient({});
    cB.from = cA.from;
    const rB = await engine(cB).syncNow();
    expect(rB.pulled).toBe(1);
    expect(ls.getItem('planner:settings')).toBe('{"v":"A"}');
  });
});

describe('markDirty', () => {
  it('stamps meta and queues syncable keys only', () => {
    const e = engine(mockClient({}), CFG, () => 42);
    e.markDirty('planner:pool');
    e.markDirty('planner:__probe');
    e.markDirty('unrelated');
    expect(JSON.parse(ls.getItem('rhythm:sync:dirty'))).toEqual(['planner:pool']);
    expect(JSON.parse(ls.getItem('rhythm:sync:meta'))['planner:pool']).toBe(42);
  });
});
