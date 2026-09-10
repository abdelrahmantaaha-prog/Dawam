/* One filter read by four views, so the rules have to be the ones people mean
   when they tick boxes — and the sort has to survive being carried to a view
   that cannot express it. */
import { describe, it, expect } from 'vitest';
import { EMPTY, SORTS, isFiltering, toggle, clear, matches, applyFilter, applySort, sortFor, arrange, describeFilter } from '../src/filters.js';

const task = (id, label, project) => ({ id, title: id, projectId: label || null, projectRef: project || null });

describe('toggle', () => {
  it('adds then removes', () => {
    let f = toggle(EMPTY, 'labels', 'l1');
    expect(f.labels).toEqual(['l1']);
    f = toggle(f, 'labels', 'l1');
    expect(f.labels).toEqual([]);
  });
  it('keeps the other dimension and the sort', () => {
    const f = toggle({ ...EMPTY, projects: ['p1'], sort: 'title' }, 'labels', 'l1');
    expect(f).toMatchObject({ labels: ['l1'], projects: ['p1'], sort: 'title' });
  });
  it('never mutates what it was given', () => {
    const before = { ...EMPTY };
    toggle(before, 'labels', 'l1');
    expect(before.labels).toEqual([]);
  });
});

describe('matches', () => {
  it('passes everything when nothing is chosen', () => {
    expect(isFiltering(EMPTY)).toBe(false);
    expect(matches(task('a'), EMPTY)).toBe(true);
  });

  it('is OR within a dimension', () => {
    // Two labels has to mean "either". A task carries one, so AND would select
    // nothing — which is never what ticking two boxes means.
    const f = { ...EMPTY, labels: ['l1', 'l2'] };
    expect(matches(task('a', 'l1'), f)).toBe(true);
    expect(matches(task('b', 'l2'), f)).toBe(true);
    expect(matches(task('c', 'l3'), f)).toBe(false);
  });

  it('is AND across dimensions', () => {
    const f = { ...EMPTY, labels: ['l1'], projects: ['p1'] };
    expect(matches(task('a', 'l1', 'p1'), f)).toBe(true);
    expect(matches(task('b', 'l1', 'p2'), f)).toBe(false);
    expect(matches(task('c', 'l2', 'p1'), f)).toBe(false);
  });

  it('excludes items with nothing in the filtered dimension', () => {
    expect(matches(task('a', null), { ...EMPTY, labels: ['l1'] })).toBe(false);
  });

  it('reads ids through accessors, so one filter serves every kind of thing', () => {
    const event = { uid: 'e1', assignedTo: 'p1' };
    const f = { ...EMPTY, projects: ['p1'] };
    expect(matches(event, f, { project: (e) => e.assignedTo })).toBe(true);
  });
});

describe('applyFilter', () => {
  it('keeps only what survives', () => {
    const list = [task('a', 'l1'), task('b', 'l2'), task('c', 'l1')];
    expect(applyFilter(list, { ...EMPTY, labels: ['l1'] }).map((t) => t.id)).toEqual(['a', 'c']);
  });
  it('survives nothing at all', () => {
    expect(applyFilter(null, EMPTY)).toEqual([]);
  });
});

describe('applySort', () => {
  const items = [
    { id: 'b', title: 'Beta', date: '2026-09-02', updatedAt: 10 },
    { id: 'a', title: 'alpha', date: '2026-09-01', updatedAt: 30 },
    { id: 'c', title: 'Gamma', date: null, updatedAt: 20 },
  ];

  it('leaves the list untouched for manual', () => {
    // Not a copy sorted by nothing: that still costs a pass and can shuffle
    // equal keys, and manual order is the thing the Plan page is for.
    expect(applySort(items, 'manual')).toBe(items);
    expect(applySort(items, 'nonsense')).toBe(items);
  });

  it('sorts by title, case-insensitively', () => {
    expect(applySort(items, 'title').map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by date, undated last rather than in 1970', () => {
    expect(applySort(items, 'date').map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by most recent first', () => {
    expect(applySort(items, 'recent').map((i) => i.id)).toEqual(['a', 'c', 'b']);
  });

  it('does not mutate the input', () => {
    const before = items.map((i) => i.id);
    applySort(items, 'title');
    expect(items.map((i) => i.id)).toEqual(before);
  });
});

describe('sortFor', () => {
  it('falls back to a view first sort when it cannot express the current one', () => {
    // A board has no clock; carrying "date" onto it must not leave it ordered
    // by something it cannot show.
    expect(sortFor('date', ['manual', 'title'])).toBe('manual');
    expect(sortFor('title', ['manual', 'title'])).toBe('title');
    expect(sortFor(undefined, ['recent', 'title'])).toBe('recent');
  });
});

describe('arrange', () => {
  it('filters then sorts', () => {
    const list = [task('b', 'l1'), task('a', 'l1'), task('c', 'l2')];
    const out = arrange(list, { ...EMPTY, labels: ['l1'], sort: 'title' }, ['manual', 'title']);
    expect(out.map((t) => t.id)).toEqual(['a', 'b']);
  });
  it('respects a view that cannot sort that way', () => {
    const list = [task('b'), task('a')];
    expect(arrange(list, { ...EMPTY, sort: 'title' }, ['manual']).map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('describeFilter', () => {
  it('names what is on, for a chip that can be cleared', () => {
    const s = describeFilter({ ...EMPTY, labels: ['l1'], projects: ['p1'] },
      { labelName: () => 'calls', projectName: () => 'Bugs' });
    expect(s).toBe('Bugs, calls');
  });
  it('says nothing when nothing is filtered', () => {
    expect(describeFilter(EMPTY)).toBe('');
  });
});

describe('clear', () => {
  it('drops both dimensions but keeps the sort', () => {
    expect(clear({ labels: ['l1'], projects: ['p1'], sort: 'title' }))
      .toEqual({ labels: [], projects: [], sort: 'title' });
  });
});

describe('SORTS', () => {
  it('is the whole vocabulary', () => {
    expect(SORTS).toEqual(['manual', 'date', 'title', 'recent', 'tag', 'project']);
  });
});

/* Sorting by tag or project has to order by the NAME a person reads. Ordering
   by id would look deliberate and be arbitrary — and untagged work has to land
   at the bottom rather than under a blank heading at the top. */
describe('applySort — tag and project', () => {
  const named = (id, tag, project) => ({ id, labelName: tag || '', projectName: project || '' });
  const ids = (list) => list.map((i) => i.id);

  it('orders by tag name', () => {
    const list = [named('a', 'Reporting'), named('b', 'Admin'), named('c', 'Newsroom')];
    expect(ids(applySort(list, 'tag'))).toEqual(['b', 'c', 'a']);
  });

  it('puts untagged work last, not first', () => {
    const list = [named('a'), named('b', 'Admin'), named('c')];
    expect(ids(applySort(list, 'tag'))).toEqual(['b', 'a', 'c']);
  });

  it('orders by project name independently of the tag', () => {
    const list = [named('a', 'Zeta', 'Beta'), named('b', 'Alpha', 'Alpha')];
    expect(ids(applySort(list, 'project'))).toEqual(['b', 'a']);
  });

  it('takes the name from the view\'s resolver', () => {
    // A task carries an id; only the view knows what that id is called.
    const list = [{ id: 'a', projectId: 'l2' }, { id: 'b', projectId: 'l1' }];
    const names = { l1: 'Admin', l2: 'Reporting' };
    const out = applySort(list, 'tag', { tagName: (i) => names[i.projectId] });
    expect(ids(out)).toEqual(['b', 'a']);
  });

  it('ignores case and diacritics the way title does', () => {
    const list = [named('a', 'beta'), named('b', 'Alpha')];
    expect(ids(applySort(list, 'tag'))).toEqual(['b', 'a']);
  });

  it('never mutates the list it was given', () => {
    const list = [named('a', 'Zeta'), named('b', 'Alpha')];
    applySort(list, 'tag');
    expect(ids(list)).toEqual(['a', 'b']);
  });

  it('falls back when a view cannot express it', () => {
    // The Plan page has no tag column to sort under; carrying the sort there
    // must not leave it ordered by something it cannot show.
    expect(sortFor('tag', ['manual', 'title'])).toBe('manual');
    expect(sortFor('tag', ['manual', 'title', 'tag'])).toBe('tag');
  });
});
