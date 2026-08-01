/* The sync document: merge semantics, and the loop bug.

   The bug being pinned here cost Mizan a push→adopt→push cycle every few
   seconds, forever: "has anything changed?" was answered with JSON.stringify,
   whose output depends on the order keys happen to have been inserted in. The
   server builds the merged document one way and migrate() rebuilds it another,
   so an unchanged document compared unequal on every round trip.

   The tests below assert that key order really does differ — otherwise a future
   change could mask the bug rather than fix it and these would still pass. */
import { describe, it, expect } from 'vitest';
import { mergeState, fingerprint, sameDoc, migrate, isSyncable, docSize } from '../shared/model.js';

const entry = (value, updatedAt) => ({ value, updatedAt });
const doc = (keys) => ({ v: 1, keys });

describe('fingerprint — key order must not count as a change', () => {
  it('two objects with the same content but different key order match', () => {
    const a = doc({ 'planner:pool': entry('[1]', 10), 'planner:settings': entry('{}', 20) });
    // built in the opposite order, as the server would after a merge
    const bKeys = {};
    bKeys['planner:settings'] = entry('{}', 20);
    bKeys['planner:pool'] = entry('[1]', 10);
    const b = { keys: bKeys, v: 1 };

    // the premise: raw JSON really does differ, so this test can't pass vacuously
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(sameDoc(a, b)).toBe(true);
  });

  it('the exact round trip that used to loop settles after one pass', () => {
    const local = doc({ 'planner:week:2026-07-25': entry('{"tasks":[]}', 100), 'planner:settings': entry('{"lang":"en"}', 90) });
    // server merge order differs from the client's
    const server = migrate(mergeState({ v: 1, keys: {} }, local));
    // the client re-derives its document; content identical, order not guaranteed
    const roundTripped = migrate(server);
    expect(sameDoc(server, roundTripped)).toBe(true);
    // and merging again changes nothing — idempotent, so no second push is owed
    expect(sameDoc(mergeState(server, roundTripped), server)).toBe(true);
  });

  it('a real content change is still detected', () => {
    const a = doc({ 'planner:pool': entry('[1]', 10) });
    const b = doc({ 'planner:pool': entry('[2]', 11) });
    expect(sameDoc(a, b)).toBe(false);
  });

  it('undefined fields never make an identical document differ', () => {
    expect(fingerprint({ a: 1, b: undefined })).toBe(fingerprint({ a: 1 }));
  });
});

describe('mergeState — per key, last write wins', () => {
  it('keeps both sides when they touched different keys', () => {
    const a = doc({ 'planner:week:2026-07-25': entry('A', 10) });
    const b = doc({ 'planner:week:2026-08-01': entry('B', 20) });
    const m = mergeState(a, b);
    expect(m.keys['planner:week:2026-07-25'].value).toBe('A');
    expect(m.keys['planner:week:2026-08-01'].value).toBe('B');
  });

  it('newer wins on the same key', () => {
    const older = doc({ 'planner:pool': entry('old', 10) });
    const newer = doc({ 'planner:pool': entry('new', 20) });
    expect(mergeState(older, newer).keys['planner:pool'].value).toBe('new');
    expect(mergeState(newer, older).keys['planner:pool'].value).toBe('new'); // symmetric
  });

  it('is idempotent', () => {
    const a = doc({ 'planner:pool': entry('x', 10) });
    const b = doc({ 'planner:settings': entry('y', 20) });
    const once = mergeState(a, b);
    expect(sameDoc(mergeState(once, once), once)).toBe(true);
    expect(sameDoc(mergeState(once, b), once)).toBe(true);
  });

  it('a tombstone deletes an older copy, and an newer edit resurrects it', () => {
    const live = doc({ 'planner:week:2026-06-01': entry('W', 10) });
    const tomb = doc({ 'planner:week:2026-06-01': { deletedAt: 20 } });
    expect(mergeState(live, tomb).keys['planner:week:2026-06-01'].deletedAt).toBe(20);
    const recreated = doc({ 'planner:week:2026-06-01': entry('W2', 30) });
    expect(mergeState(tomb, recreated).keys['planner:week:2026-06-01'].value).toBe('W2');
  });

  it('a tie goes to the tombstone, so a delete is never silently undone', () => {
    const live = doc({ 'planner:pool': entry('x', 50) });
    const tomb = doc({ 'planner:pool': { deletedAt: 50 } });
    expect(mergeState(live, tomb).keys['planner:pool'].deletedAt).toBe(50);
    expect(mergeState(tomb, live).keys['planner:pool'].deletedAt).toBe(50);
  });
});

describe('migrate — anything in, valid document out', () => {
  it('drops junk and non-syncable keys', () => {
    const m = migrate({ keys: {
      'planner:pool': entry('[]', 5),
      'planner:__probe': entry('x', 5),
      'planner:prayers:2026-07-25': entry('x', 5),
      'unrelated': entry('x', 5),
      'planner:bad': { value: 42 },
    } });
    expect(Object.keys(m.keys)).toEqual(['planner:pool']);
  });

  it('survives null, arrays and nonsense', () => {
    expect(migrate(null).keys).toEqual({});
    expect(migrate([1, 2]).keys).toEqual({});
    expect(migrate('nope').keys).toEqual({});
  });
});

describe('isSyncable', () => {
  it('covers the planner keys and nothing else', () => {
    expect(isSyncable('planner:settings')).toBe(true);
    expect(isSyncable('planner:week:2026-07-25')).toBe(true);
    expect(isSyncable('planner:__probe')).toBe(false);
    expect(isSyncable('planner:prayers:2026-07-25')).toBe(false);
    expect(isSyncable('rhythm:sync:meta')).toBe(false);
  });
});

describe('docSize', () => {
  it('measures the serialised document', () => {
    expect(docSize(doc({}))).toBeGreaterThan(0);
    expect(docSize(doc({ 'planner:pool': entry('x'.repeat(1000), 1) }))).toBeGreaterThan(1000);
  });
});
