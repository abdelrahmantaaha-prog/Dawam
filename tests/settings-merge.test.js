/* Settings merge field by field.

   The bug: the prayer switch kept turning itself back on. Settings were one
   last-write-wins blob, and the same blob holds the habit logs and project
   progress, so a device that had not yet heard "prayer times off" would tick
   a habit, stamp the whole object newer, and push "on" back to everyone. */
import { describe, it, expect } from 'vitest';
import { mergeState, sameDoc, stampSettings, SETTINGS_KEY } from '../shared/model.js';

const doc = (e) => ({ v: 1, keys: { [SETTINGS_KEY]: e } });
// What a save on an updated build stores, with the entry stamped by the same clock.
const save = (prev, next, at) => { const v = stampSettings(prev, next, at); return { obj: v, entry: { value: JSON.stringify(v), updatedAt: at } }; };
const read = (d) => JSON.parse(d.keys[SETTINGS_KEY].value);

describe('stampSettings', () => {
  it('stamps only the fields that changed', () => {
    const first = stampSettings(null, { prayer: { useLive: true }, habits: [] }, 100);
    expect(first._at).toEqual({ prayer: 100, habits: 100 });
    const next = stampSettings(first, { ...first, habits: [{ id: 'h' }] }, 200);
    expect(next._at).toEqual({ prayer: 100, habits: 200 });
    expect(next._w).toBe(200);
  });
  it('ignores stamps the app handed back, and trusts only what was stored', () => {
    const stored = stampSettings(null, { lang: 'en' }, 100);
    const next = stampSettings(stored, { lang: 'en', _at: { lang: 999999 }, _w: 5 }, 200);
    expect(next._at.lang).toBe(100);
  });
  it('stamps every field when the stored copy has no stamps (the first save after updating)', () => {
    expect(stampSettings({ lang: 'en', prayer: {} }, { lang: 'en', prayer: {} }, 300)._at).toEqual({ lang: 300, prayer: 300 });
  });
});

describe('mergeState on settings', () => {
  const base = save(null, { prayer: { useLive: true }, habits: [] }, 100).obj;

  it('a stale device ticking a habit does not turn prayer times back on', () => {
    const laptop = save(base, { ...base, prayer: { useLive: false } }, 200);         // switched off
    const phone = save(base, { ...base, habits: [{ id: 'h', log: { d: 1 } }] }, 300); // never heard; ticks a habit later
    for (const m of [mergeState(doc(laptop.entry), doc(phone.entry)), mergeState(doc(phone.entry), doc(laptop.entry))]) {
      const s = read(m);
      expect(s.prayer.useLive).toBe(false);
      expect(s.habits[0].log.d).toBe(1);
    }
    expect(sameDoc(mergeState(doc(laptop.entry), doc(phone.entry)), mergeState(doc(phone.entry), doc(laptop.entry)))).toBe(true);
  });

  it('is idempotent, and a merged copy merges back into itself unchanged', () => {
    const a = save(base, { ...base, prayer: { useLive: false } }, 200);
    const b = save(base, { ...base, habits: [{ id: 'x' }] }, 300);
    const m = mergeState(doc(a.entry), doc(b.entry));
    expect(sameDoc(mergeState(m, m), m)).toBe(true);
    expect(sameDoc(mergeState(m, doc(a.entry)), m)).toBe(true);
    expect(sameDoc(mergeState(doc(b.entry), m), m)).toBe(true);
  });

  it('hands an unchanged copy back byte for byte, so nothing is pushed for nothing', () => {
    // Same content, keys in a different order: the document compares strings.
    const a = save(null, { b: 1, a: 2 }, 100).entry;
    const m = mergeState(doc(a), doc(a));
    expect(m.keys[SETTINGS_KEY]).toEqual(a);
  });

  it('stamps a new combination past both sides, so an old whole-key server keeps it', () => {
    const a = save(base, { ...base, prayer: { useLive: false } }, 300);
    const b = save(base, { ...base, habits: [{ id: 'x' }] }, 200);
    const e = mergeState(doc(a.entry), doc(b.entry)).keys[SETTINGS_KEY];
    expect(e.updatedAt).toBe(301);
    expect(JSON.parse(e.value)._w).toBe(301);
  });

  it('the same field changed on both sides: the later change wins', () => {
    const a = save(base, { ...base, prayer: { useLive: false } }, 200);
    const b = save(base, { ...base, prayer: { useLive: true, method: 5 } }, 250);
    expect(read(mergeState(doc(a.entry), doc(b.entry))).prayer).toEqual({ useLive: true, method: 5 });
  });

  it('falls back to whole-key last-write-wins against a build that does not stamp', () => {
    const a = save(base, { ...base, prayer: { useLive: false } }, 200);
    // An old build spread the stamps it was given but wrote at 300 without a new _w.
    const legacy = { value: JSON.stringify({ ...a.obj, habits: [{ id: 'old' }], prayer: { useLive: true } }), updatedAt: 300 };
    const m = mergeState(doc(a.entry), doc(legacy));
    expect(m.keys[SETTINGS_KEY]).toEqual(legacy);
  });

  it('a field removed on the newer side stays removed', () => {
    const withGate = save(base, { ...base, prayerGate: true }, 150).obj;
    const a = save(withGate, { prayer: withGate.prayer, habits: withGate.habits }, 300);   // migration drops it
    const b = save(withGate, { ...withGate, habits: [{ id: 'x' }] }, 200);
    const s = read(mergeState(doc(a.entry), doc(b.entry)));
    expect('prayerGate' in s).toBe(false);
    expect(s.habits).toEqual([{ id: 'x' }]);
  });
});
