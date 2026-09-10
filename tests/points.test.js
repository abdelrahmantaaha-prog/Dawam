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

/* Penalties are the direction the ledger was missing: a number that can only
   grow is a number nobody protects. The two rules worth pinning are that a
   penalty is an EVENT (doing the thing twice costs twice) and that a wipe is
   an entry rather than a delete — zero with no history is zero with no
   meaning. */
describe('penalise', () => {
  it('subtracts, and shows in the balance', async () => {
    const { award, penalise, readLedger, balanceOf } = await load();
    await award([], { iso: DAY, ref: 'task:a', kind: 'task', amount: 100 });
    await penalise(DAY, { title: 'Doomscrolled', cost: 30, penaltyId: 'x1' });
    const l = await readLedger();
    expect(balanceOf(l)).toBe(70);
    expect(l[1]).toMatchObject({ kind: 'penalty', amount: -30, title: 'Doomscrolled' });
    expect(l[1].meta).toMatchObject({ penaltyId: 'x1' });
  });

  it('is NOT idempotent — the same slip twice costs twice', async () => {
    const { penalise, readLedger } = await load();
    await penalise(DAY, { title: 'Slip', cost: 10, penaltyId: 'x1' });
    await penalise(DAY, { title: 'Slip', cost: 10, penaltyId: 'x1' });
    const l = await readLedger();
    expect(l).toHaveLength(2);
    expect(l[0].ref).not.toBe(l[1].ref);
  });

  it('takes the balance negative rather than clamping at zero', async () => {
    // The debt is real; hiding it would let a bad week look like a fresh start.
    const { penalise, readLedger, balanceOf } = await load();
    await penalise(DAY, { title: 'Slip', cost: 40 });
    expect(balanceOf(await readLedger())).toBe(-40);
  });

  it('ignores a nonsense cost', async () => {
    const { penalise, readLedger } = await load();
    expect(await penalise(DAY, { title: 'x', cost: 0 })).toBe(null);
    expect(await penalise(DAY, { title: 'x', cost: -5 })).toBe(null);
    expect(await readLedger()).toHaveLength(0);
  });
});

describe('wipe', () => {
  it('takes the balance to exactly zero', async () => {
    const { award, wipe, readLedger, balanceOf } = await load();
    await award([], { iso: DAY, ref: 'task:a', kind: 'task', amount: 30 });
    await award(await readLedger(), { iso: DAY, ref: 'task:b', kind: 'task', amount: 45 });
    const before = await readLedger();
    expect(balanceOf(before)).toBe(75);
    await wipe(before, DAY, { title: 'Smoked' });
    expect(balanceOf(await readLedger())).toBe(0);
  });

  it('writes an entry rather than deleting the history', async () => {
    const { award, wipe, readLedger } = await load();
    await award([], { iso: DAY, ref: 'task:a', kind: 'task', amount: 30 });
    await wipe(await readLedger(), DAY, { title: 'Smoked', penaltyId: 'p9' });
    const l = await readLedger();
    expect(l).toHaveLength(2);                       // the earning is still there
    expect(l[0]).toMatchObject({ ref: 'task:a', amount: 30 });
    expect(l[1]).toMatchObject({ kind: 'wipe', amount: -30 });
    expect(l[1].meta).toMatchObject({ wiped: 30, penaltyId: 'p9' });
  });

  it('writes nothing when there is nothing to take', async () => {
    const { wipe, readLedger } = await load();
    expect(await wipe([], DAY, { title: 'Smoked' })).toBe(null);
    expect(await readLedger()).toHaveLength(0);
  });

  it('will not deepen an existing debt', async () => {
    // Already negative: a wipe should not double it. There is no balance left
    // to take, and "wipe" has never meant "charge again".
    const { penalise, wipe, readLedger, balanceOf } = await load();
    await penalise(DAY, { title: 'Slip', cost: 20 });
    const l = await readLedger();
    expect(await wipe(l, DAY, { title: 'Smoked' })).toBe(null);
    expect(balanceOf(await readLedger())).toBe(-20);
  });

  it('can be undone like any other entry', async () => {
    const { award, wipe, forget, readLedger, balanceOf } = await load();
    await award([], { iso: DAY, ref: 'task:a', kind: 'task', amount: 30 });
    const entry = await wipe(await readLedger(), DAY, { title: 'Mis-tapped' });
    await forget(await readLedger(), entry.ref);
    expect(balanceOf(await readLedger())).toBe(30);
  });
});
