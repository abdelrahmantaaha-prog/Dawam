/* Filing read-only calendar entries under a project.

   The identity scheme is the whole design here, and it is deliberately the
   opposite of the done-marks next door: those pin an occurrence, because
   attending Monday's standup says nothing about Wednesday's, while these pin a
   series, because a standing meeting belongs to a project as a standing fact.
   Getting that backwards would mean re-filing the same meeting every week. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map();
vi.mock('../src/storage.js', () => ({
  loadKey: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null),
  saveKey: async (k, v) => { store.set(k, JSON.stringify(v)); },
}));

const { calSeriesKey, loadCalProjects, setCalProject, pruneCalProjects, projectOfEvent, projectMinutes, seriesIn } =
  await import('../src/calproj.js');

const at = (iso, h, m = 0) => new Date(`${iso}T00:00:00`).getTime() + (h * 60 + m) * 60000;
const ev = (over = {}) => ({ feedId: 'work', uid: 'standup@google', summary: 'Standup', allDay: false, ...over });

beforeEach(() => store.clear());

describe('calSeriesKey', () => {
  it('is the same across every occurrence of a recurring event', () => {
    const mon = ev({ startMs: at('2026-09-07', 9), endMs: at('2026-09-07', 9, 15) });
    const wed = ev({ startMs: at('2026-09-09', 9), endMs: at('2026-09-09', 9, 15) });
    expect(calSeriesKey(mon)).toBe(calSeriesKey(wed));
  });

  it('keeps two feeds apart even if they reuse a uid', () => {
    expect(calSeriesKey(ev({ feedId: 'work' }))).not.toBe(calSeriesKey(ev({ feedId: 'home' })));
  });

  it('falls back to the summary when an exporter gives no uid', () => {
    const k = calSeriesKey(ev({ uid: '' }));
    expect(k).toContain('Standup');
    expect(k).not.toContain('undefined');
  });

  it('survives a junk event without throwing', () => {
    expect(typeof calSeriesKey(null)).toBe('string');
    expect(typeof calSeriesKey({})).toBe('string');
  });
});

describe('assigning and clearing', () => {
  it('round-trips through storage', async () => {
    const key = calSeriesKey(ev());
    const map = await setCalProject({}, key, 'proj-book');
    expect(map[key]).toBe('proj-book');
    expect(await loadCalProjects()).toEqual({ [key]: 'proj-book' });
  });

  it('clears with a null rather than storing an empty marker', async () => {
    const key = calSeriesKey(ev());
    let map = await setCalProject({}, key, 'proj-book');
    map = await setCalProject(map, key, null);
    expect(map).toEqual({});
    expect(await loadCalProjects()).toEqual({});
  });

  it('files every occurrence at once, which is the point', () => {
    const key = calSeriesKey(ev());
    const map = { [key]: 'proj-book' };
    for (const iso of ['2026-09-07', '2026-09-14', '2026-09-21']) {
      expect(projectOfEvent(map, ev({ startMs: at(iso, 9), endMs: at(iso, 9, 15) }))).toBe('proj-book');
    }
  });

  it('forgets assignments whose project is gone', async () => {
    // Otherwise a deleted project leaves meetings looking filed under nothing,
    // which reads as a bug rather than as an empty project.
    const map = { a: 'proj-book', b: 'proj-dead' };
    expect(await pruneCalProjects(map, ['proj-book'])).toEqual({ a: 'proj-book' });
  });
});

describe('projectMinutes', () => {
  const key = calSeriesKey(ev());
  const map = { [key]: 'proj-book' };

  it('totals only what is assigned', () => {
    const list = [
      ev({ startMs: at('2026-09-07', 9), endMs: at('2026-09-07', 10) }),
      ev({ uid: 'other@google', startMs: at('2026-09-07', 11), endMs: at('2026-09-07', 12) }),
    ];
    expect(projectMinutes(list, map, at('2026-09-07', 0), at('2026-09-08', 0))).toEqual({ 'proj-book': 60 });
  });

  it('clips to the range so a straddling meeting is not counted twice', () => {
    const list = [ev({ startMs: at('2026-09-07', 23), endMs: at('2026-09-08', 1) })];
    const day1 = projectMinutes(list, map, at('2026-09-07', 0), at('2026-09-08', 0));
    const day2 = projectMinutes(list, map, at('2026-09-08', 0), at('2026-09-09', 0));
    expect(day1['proj-book']).toBe(60);
    expect(day2['proj-book']).toBe(60);
  });

  it('ignores all-day entries', () => {
    // A birthday is a note on the day, not eight hours of project work — and
    // counting it would swamp every real number in the total.
    const list = [ev({ allDay: true, startMs: at('2026-09-07', 0), endMs: at('2026-09-08', 0) })];
    expect(projectMinutes(list, map, at('2026-09-07', 0), at('2026-09-08', 0))).toEqual({});
  });

  it('adds up a recurring series across a range', () => {
    const list = ['2026-09-07', '2026-09-14', '2026-09-21']
      .map((iso) => ev({ startMs: at(iso, 9), endMs: at(iso, 9, 30) }));
    expect(projectMinutes(list, map, at('2026-09-01', 0), at('2026-10-01', 0))).toEqual({ 'proj-book': 90 });
  });
});

describe('seriesIn', () => {
  it('lists one row per series, not one per occurrence', () => {
    // A weekly meeting appearing fifty-two times in a picker is the reason
    // this exists.
    const list = ['2026-09-07', '2026-09-14', '2026-09-21']
      .map((iso) => ev({ startMs: at(iso, 9), endMs: at(iso, 9, 30) }));
    const s = seriesIn(list);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ summary: 'Standup', count: 3 });
  });

  it('puts the most recent series first', () => {
    const a = ev({ uid: 'old', summary: 'Old', startMs: at('2026-09-01', 9), endMs: at('2026-09-01', 10) });
    const b = ev({ uid: 'new', summary: 'New', startMs: at('2026-09-20', 9), endMs: at('2026-09-20', 10) });
    expect(seriesIn([a, b]).map((s) => s.summary)).toEqual(['New', 'Old']);
  });
});
