/* When may the app write something nobody tapped for?

   2026-10-17: the desktop had been closed for six days. It opened, and in the
   same second — before /api/me had answered — its recurring tasks added
   themselves to its six-day-old copy of the week. That copy was stamped
   newest, pushed, and adopted by the phone, taking that morning's ticks with
   it. The points survived because they live in their own per-day keys. The
   gate the app used read "sync is not known to be on" as "sync is off". */
import { describe, it, expect } from 'vitest';
import { autoWriteSafe } from '../src/sync.js';

const user = { email: 'a@b.c' };

describe('autoWriteSafe', () => {
  it('holds automatic writes while the boot probe has not answered', () => {
    expect(autoWriteSafe({ checked: false, sync: false }, null, false)).toBe(false);
    expect(autoWriteSafe(null, null, false)).toBe(false);
  });

  it('holds them on a synced device until it has pulled', () => {
    expect(autoWriteSafe({ checked: true, sync: true }, user, false)).toBe(false);
    expect(autoWriteSafe({ checked: true, sync: true }, user, true)).toBe(true);
  });

  it('lets them through where there is nothing to be stale against', () => {
    expect(autoWriteSafe({ checked: true, sync: false }, null, false, true)).toBe(true);
    expect(autoWriteSafe({ checked: true, sync: true }, null, false, true)).toBe(true);
  });

  it('holds them on a device that has synced before and cannot reach the server', () => {
    // Started offline: the probe answered "unreachable", not "no backend".
    const down = { checked: true, sync: false, unreachable: true };
    expect(autoWriteSafe(down, null, false, true)).toBe(false);
    expect(autoWriteSafe(down, null, false, false)).toBe(true);   // never synced: offline-only use
  });
});
