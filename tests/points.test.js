/* The ledger. The balance is never stored — it is the sum of these entries —
   so what matters here is that entries appear exactly once, disappear cleanly,
   and land on the right day's page. */
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
beforeEach(() => { ls = makeLS(); globalThis.localStorage = ls; vi.resetModules(); });
const load = () => import('../src/points.js');

const DAY = '2026-08-13';

describe('award', () => {
  it('writes an entry onto its day and shows up in the balance', async () => {
    const { award, readLedger, balanceOf } = await load();
    await award([], { iso: DAY, ref: 'task:a', kind: 'task', amount: 30, title: 'Write' });
    const l = await readLedger();
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ ref: 'task:a', amount: 30, title: 'Write', day: DAY });
    expect(balanceOf(l)).toBe(30);
  });

  it('refuses to pay the same ref twice', async () => {
    // Tick, untick, tick again must not mint points — and neither must a task
    // finished today that was already paid for yesterday.
    const { award, readLedger } = await load();
    await award([], { iso: DAY, ref: 'task:a', kind: 'task', amount: 30 });
    const first = await readLedger();
    const again = await award(first, { iso: '2026-08-14', ref: 'task:a', kind: 'task', amount: 30 });
    expect(again).toBe(null);
    expect(await readLedger()).toHaveLength(1);
  });

  it('ignores a zero or missing amount rather than writing an empty entry', async () => {
    const { award, readLedger } = await load();
    expect(await award([], { iso: DAY, ref: 'task:a', amount: 0 })).toBe(null);
    expect(await award([], { iso: DAY, ref: '', amount: 10 })).toBe(null);
    expect(await readLedger()).toHaveLength(0);
  });

  it('keeps separate days on separate keys', async () => {
    const { award } = await load();
    await award([], { iso: DAY, ref: 'task:a', amount: 10 });
    await award([], { iso: '2026-08-14', ref: 'task:b', amount: 10 });
    expect(Object.keys(ls._all()).sort()).toEqual(['planner:points:2026-08-13', 'planner:points:2026-08-14']);
  });

  it('returns the ledger in time order, not day-key order', async () => {
    // An entry backdated onto an earlier page still reads as having happened
    // when it happened — which is what the "recent" list in the panel shows.
    const { award, readLedger } = await load();
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValue(1000);
    await award([], { iso: '2026-08-14', ref: 'b', amount: 5 });
    clock.mockReturnValue(2000);
    await award([], { iso: DAY, ref: 'a', amount: 5 });
    expect((await readLedger()).map((e) => e.ref)).toEqual(['b', 'a']);
    clock.mockRestore();
  });
});

describe('revoke', () => {
  it('removes the entry and reports what went away', async () => {
    const { award, revoke, readLedger, balanceOf } = await load();
    await award([], { iso: DAY, ref: 'task:a', amount: 30 });
    await award([], { iso: DAY, ref: 'task:b', amount: 12 });
    const l = await readLedger();
    expect(await revoke(l, 'task:a')).toBe(30);
    const after = await readLedger();
    expect(after.map((e) => e.ref)).toEqual(['task:b']);
    expect(balanceOf(after)).toBe(12);
  });

  it('deletes the day page once it empties, rather than leaving a husk behind', async () => {
    // An empty document would otherwise be carried around by sync forever.
    const { award, revoke, readLedger } = await load();
    await award([], { iso: DAY, ref: 'task:a', amount: 30 });
    await revoke(await readLedger(), 'task:a');
    expect(ls.getItem('planner:points:2026-08-13')).toBe(null);
  });

  it('is a no-op for a ref that was never paid', async () => {
    const { revoke } = await load();
    expect(await revoke([], 'task:ghost')).toBe(0);
  });

  it('un-ticking restores the balance exactly, however many times you flip', async () => {
    const { award, revoke, readLedger, balanceOf } = await load();
    for (let i = 0; i < 4; i++) {
      await award(await readLedger(), { iso: DAY, ref: 'task:a', amount: 30 });
      await revoke(await readLedger(), 'task:a');
    }
    await award(await readLedger(), { iso: DAY, ref: 'task:a', amount: 30 });
    expect(balanceOf(await readLedger())).toBe(30);
  });
});

describe('spend', () => {
  it('records a negative entry that the balance honours', async () => {
    const { award, spend, readLedger, balanceOf } = await load();
    await award([], { iso: DAY, ref: 'task:a', amount: 100 });
    await spend(DAY, { title: 'Two hours of games', cost: 60, rewardId: 'r1' });
    const l = await readLedger();
    expect(balanceOf(l)).toBe(40);
    expect(l[1]).toMatchObject({ kind: 'spend', amount: -60, title: 'Two hours of games' });
  });

  it('gives every spend its own ref, so buying the same thing twice logs twice', async () => {
    const { spend, readLedger } = await load();
    await spend(DAY, { title: 'Games', cost: 10 });
    await spend(DAY, { title: 'Games', cost: 10 });
    const l = await readLedger();
    expect(l).toHaveLength(2);
    expect(l[0].ref).not.toBe(l[1].ref);
  });

  it('ignores a nonsense cost', async () => {
    const { spend, readLedger } = await load();
    expect(await spend(DAY, { title: 'x', cost: 0 })).toBe(null);
    expect(await spend(DAY, { title: 'x', cost: -5 })).toBe(null);
    expect(await readLedger()).toHaveLength(0);
  });
});
