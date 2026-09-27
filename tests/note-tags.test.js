/* Tags on notes, and the wall grouped by them. */

import { describe, it, expect } from 'vitest';
import { addTags, allNoteTags, groupByTag, hasTag, noteTags, removeTag, tagKey } from '../src/notes.js';

describe('note tags', () => {
  it('treats case, a leading # and stray spaces as the same tag', () => {
    expect(tagKey('#Ideas ')).toBe('ideas');
    expect(noteTags({ tags: ['Ideas', '#ideas', ' IDEAS', '', null, 'Reading  list'] })).toEqual(['Ideas', 'Reading list']);
  });

  it('reads old notes, which have no tags at all', () => {
    expect(noteTags({})).toEqual([]);
    expect(noteTags(null)).toEqual([]);
  });

  it('adds several at once and never duplicates', () => {
    expect(addTags({ tags: ['ideas'] }, 'Reading, #later ideas')).toEqual(['ideas', 'Reading', 'later ideas']);
    expect(addTags({ tags: ['ideas'] }, '#Ideas')).toEqual(['ideas']);
    expect(addTags({ tags: [] }, '#a #b')).toEqual(['a', 'b']);
  });

  it('removes and finds without caring about case', () => {
    const n = { tags: ['Mutarjim', 'drafts'] };
    expect(removeTag(n, 'mutarjim')).toEqual(['drafts']);
    expect(hasTag(n, '#DRAFTS')).toBe(true);
    expect(hasTag(n, 'other')).toBe(false);
  });

  it('lists every tag in use, most used first', () => {
    const list = allNoteTags([{ tags: ['b', 'a'] }, { tags: ['A'] }, { tags: [] }]);
    expect(list).toEqual([{ tag: 'a', count: 2 }, { tag: 'b', count: 1 }]);
  });
});

describe('grouping the wall', () => {
  const notes = [
    { id: 1, tags: ['work', 'ideas'] },
    { id: 2, tags: ['Ideas'] },
    { id: 3 },
    { id: 4, tags: ['archive'] },
  ];

  it('groups alphabetically, with a note under each of its tags', () => {
    const g = groupByTag(notes);
    expect(g.map((x) => x.tag)).toEqual(['archive', 'ideas', 'work', null]);
    expect(g[1].notes.map((n) => n.id)).toEqual([1, 2]);
    expect(g[2].notes.map((n) => n.id)).toEqual([1]);
  });

  it('puts untagged notes last', () => {
    const g = groupByTag(notes);
    expect(g[g.length - 1]).toEqual({ tag: null, notes: [notes[2]] });
  });

  it('has no untagged group when everything is tagged', () => {
    expect(groupByTag([{ id: 1, tags: ['x'] }]).map((x) => x.tag)).toEqual(['x']);
  });
});
