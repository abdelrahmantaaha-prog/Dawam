/* Done-marks for calendar events: per-day pages, occurrence-level identity,
   and pages that delete themselves (with a sync tombstone) when they empty. */
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
const load = () => import('../src/caldone.js');

const DAY = '2026-08-25';

describe('calKey', () => {
  it('separates occurrences of one recurring event', async () => {
    const { calKey } = await load();
    const a = calKey({ uid: 'standup@cal', startMs: 1000 });
    const b = calKey({ uid: 'standup@cal', startMs: 2000 });
    expect(a).not.toBe(b);
  });
  it('falls back to the summary when there is no uid', async () => {
    const { calKey } = await load();
    expect(calKey({ summary: 'Dentist', startMs: 5 })).toBe('Dentist|5');
  });
});

describe('toggleCalDone', () => {
  it('marks, reads back, and unmarks', async () => {
    const { toggleCalDone, loadCalDone } = await load();
    expect(await toggleCalDone(DAY, 'u|1')).toBe(true);
    expect(Object.keys(await loadCalDone(DAY))).toEqual(['u|1']);
    expect(await toggleCalDone(DAY, 'u|1')).toBe(false);
    expect(Object.keys(await loadCalDone(DAY))).toEqual([]);
  });

  it('deletes the page when the last mark goes, leaving a tombstone', async () => {
    const { toggleCalDone } = await load();
    await toggleCalDone(DAY, 'u|1');
    await toggleCalDone(DAY, 'u|1');
    expect(ls.getItem(`planner:caldone:${DAY}`)).toBeNull();
    const tombs = JSON.parse(ls.getItem('rhythm:sync:tombs') || '{}');
    expect(tombs[`planner:caldone:${DAY}`]).toBeTruthy();
  });

  it('keeps marks for different days on different pages', async () => {
    const { toggleCalDone, loadCalDone } = await load();
    await toggleCalDone('2026-08-24', 'a|1');
    await toggleCalDone('2026-08-25', 'b|2');
    expect(Object.keys(await loadCalDone('2026-08-24'))).toEqual(['a|1']);
    expect(Object.keys(await loadCalDone('2026-08-25'))).toEqual(['b|2']);
  });
});

describe('pruneCalDone', () => {
  it('removes pages older than the cutoff and spares the rest', async () => {
    const { toggleCalDone, pruneCalDone, loadCalDone } = await load();
    await toggleCalDone('2026-05-01', 'old|1');
    await toggleCalDone('2026-08-25', 'new|1');
    await pruneCalDone(new Date('2026-07-01T00:00:00'));
    expect(ls.getItem('planner:caldone:2026-05-01')).toBeNull();
    expect(Object.keys(await loadCalDone('2026-08-25'))).toEqual(['new|1']);
  });
});
