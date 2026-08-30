/* A calendar entry stays read-only, but everything around it is Rhythm's to
   keep — and those things have different lifetimes, which is the whole design
   here. These pin the window a board shows and the per-series description. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map();
vi.mock('../src/storage.js', () => ({
  loadKey: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null),
  saveKey: async (k, v) => { store.set(k, JSON.stringify(v)); },
}));

const { loadCalPrep, setCalPrep, prepFor, meetingsForProject, isPast } = await import('../src/calprep.js');
const { calSeriesKey } = await import('../src/calproj.js');

const NOW = new Date('2026-09-10T12:00:00').getTime();
const at = (dayOffset, h) => NOW + dayOffset * 86400000 + (h - 12) * 3600000;
const ev = (uid, dayOffset, over = {}) => ({
  feedId: 'work', uid, summary: uid, allDay: false,
  startMs: at(dayOffset, 10), endMs: at(dayOffset, 11), ...over,
});

beforeEach(() => store.clear());

describe('the description', () => {
  it('round-trips, keyed by series', async () => {
    const key = calSeriesKey(ev('standup', 0));
    const map = await setCalPrep({}, key, '  Bring the numbers  ');
    expect(map[key]).toBe('Bring the numbers');
    expect(await loadCalPrep()).toEqual({ [key]: 'Bring the numbers' });
  });

  it('is the same for every occurrence — that is why it gets written at all', () => {
    // "Weekly sync — bring the numbers" is true every week. Asking again each
    // Monday would mean it never gets written.
    const map = { [calSeriesKey(ev('standup', 0))]: 'Bring the numbers' };
    expect(prepFor(map, ev('standup', 7))).toBe('Bring the numbers');
    expect(prepFor(map, ev('standup', 14))).toBe('Bring the numbers');
  });

  it('clears rather than storing a blank', async () => {
    const key = calSeriesKey(ev('standup', 0));
    let map = await setCalPrep({}, key, 'x');
    map = await setCalPrep(map, key, '   ');
    expect(map).toEqual({});
  });

  it('caps a runaway paste', async () => {
    const key = calSeriesKey(ev('standup', 0));
    const map = await setCalPrep({}, key, 'y'.repeat(900));
    expect(map[key].length).toBe(500);
  });

  it('is empty for a meeting nobody described', () => {
    expect(prepFor({}, ev('other', 0))).toBe('');
    expect(prepFor(null, ev('other', 0))).toBe('');
  });
});

describe('meetingsForProject', () => {
  const key = (e) => calSeriesKey(e);
  const soon = ev('soon', 2);
  const later = ev('later', 10);
  const other = ev('other', 2);
  const ancient = ev('ancient', -30);
  const yesterday = ev('yesterday', -1);
  const map = {
    [key(soon)]: 'p1', [key(later)]: 'p1', [key(ancient)]: 'p1',
    [key(yesterday)]: 'p1', [key(other)]: 'p2',
  };
  const all = [later, soon, other, ancient, yesterday];

  it('shows only this project, soonest first', () => {
    expect(meetingsForProject(all, map, 'p1', NOW).map((e) => e.uid))
      .toEqual(['yesterday', 'soon', 'later']);
  });

  it('keeps yesterday but drops last month', () => {
    // A board is a place to work from. Last month's standup is not work; the
    // one you are still writing up is.
    const out = meetingsForProject(all, map, 'p1', NOW).map((e) => e.uid);
    expect(out).toContain('yesterday');
    expect(out).not.toContain('ancient');
  });

  it('drops anything beyond the window', () => {
    expect(meetingsForProject([ev('far', 90)], { [key(ev('far', 90))]: 'p1' }, 'p1', NOW)).toEqual([]);
  });

  it('ignores all-day entries', () => {
    const holiday = ev('holiday', 1, { allDay: true });
    expect(meetingsForProject([holiday], { [key(holiday)]: 'p1' }, 'p1', NOW)).toEqual([]);
  });

  it('returns nothing without a project', () => {
    expect(meetingsForProject(all, map, null, NOW)).toEqual([]);
    expect(meetingsForProject(null, map, 'p1', NOW)).toEqual([]);
  });
});

describe('isPast', () => {
  it('tells preparing for from writing up', () => {
    expect(isPast(ev('done', -1), NOW)).toBe(true);
    expect(isPast(ev('soon', 1), NOW)).toBe(false);
    expect(isPast(null, NOW)).toBe(false);
  });
});
