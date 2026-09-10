/* Typing a task and meaning more than its words.

   Two rules are what these mostly guard. Nothing is silently lost — an
   unresolved token stays in the title rather than vanishing into a project
   that does not exist — and plain prose still parses as a plain title, because
   a parser that grabs at ordinary words is worse than no parser. */
import { describe, it, expect } from 'vitest';
import { parseTaskText, describeParse, hasHints, tokenAt, suggestFor, applySuggestion } from '../src/parse.js';

// A Saturday, so weekday maths is visible rather than accidental.
const TODAY = new Date('2026-08-29T10:00:00');
const CTX = {
  today: TODAY,
  labels: [{ id: 'l1', name: 'calls' }, { id: 'l2', name: 'Rhythm' }],
  projects: [{ id: 'p1', name: 'Bugs' }, { id: 'p2', name: 'The Book' }, { id: 'p3', name: 'Budget' }],
};
const P = (s, ctx = CTX) => parseTaskText(s, ctx);

describe('plain text stays plain', () => {
  it('leaves prose alone', () => {
    const r = P('call the dentist');
    expect(r.title).toBe('call the dentist');
    expect(hasHints(r)).toBe(false);
    expect(r.dateISO).toBe(null);
    expect(r.start).toBe(null);
  });

  it('does not read a bare number as a time', () => {
    // "buy 3 apples" is a quantity. A lone time has to look like one.
    const r = P('buy 3 apples');
    expect(r.start).toBe(null);
    expect(r.title).toBe('buy 3 apples');
  });

  it('survives empty and junk input', () => {
    expect(P('').title).toBe('');
    expect(P(null).title).toBe('');
    expect(P('   ').title).toBe('');
  });
});

describe('#tags', () => {
  it('matches an existing label by name, case-insensitively', () => {
    const r = P('ring the bank #Calls');
    expect(r.labelIds).toEqual(['l1']);
    expect(r.labelNames).toEqual(['calls']);   // the label's own spelling wins
    expect(r.title).toBe('ring the bank');
  });

  it('keeps a new tag name for the caller to create', () => {
    const r = P('write it up #drafts');
    expect(r.labelIds).toEqual([]);
    expect(r.labelNames).toEqual(['drafts']);
  });

  it('reads a quoted tag with spaces', () => {
    const r = P('sort it #"deep work"');
    expect(r.labelNames).toEqual(['deep work']);
    expect(r.title).toBe('sort it');
  });

  it('claims only the first tag, leaving the rest visible', () => {
    // A task carries one label. Consuming a second "#foo" would delete a word
    // and attach nothing to it.
    const r = P('sort it #calls #drafts');
    expect(r.labelNames).toEqual(['calls', 'drafts']);
    expect(r.title).toBe('sort it #drafts');
  });

  it('ignores a # in the middle of a word', () => {
    const r = P('issue C#101');
    expect(r.labelNames).toEqual([]);
    expect(r.title).toBe('issue C#101');
  });
});

describe('%projects', () => {
  it('resolves an exact name', () => {
    const r = P('fix the crash %Bugs');
    expect(r.projectId).toBe('p1');
    expect(r.project).toBe('Bugs');
    expect(r.title).toBe('fix the crash');
  });

  it('resolves a unique prefix and a quoted full name', () => {
    expect(P('read a chapter %"The Book"').projectId).toBe('p2');
    expect(P('draft it %Boo').projectId).toBe('p2');
  });

  it('refuses an ambiguous prefix rather than guessing', () => {
    // "Bu" matches Bugs and Budget. Picking one would be a coin toss.
    const r = P('look at it %Bu');
    expect(r.projectId).toBe(null);
    expect(r.title).toContain('%Bu');
  });

  it('never invents a project, and leaves the word visible', () => {
    // A project carries a target, a deadline and a pace. Creating one from a
    // typo is worse than leaving the text where it can be seen.
    const r = P('do the thing %Nonexistent');
    expect(r.projectId).toBe(null);
    expect(r.title).toBe('do the thing %Nonexistent');
  });
});

describe('days and dates', () => {
  it('reads today and tomorrow', () => {
    expect(P('gym today').dateISO).toBe('2026-08-29');
    expect(P('gym tomorrow').dateISO).toBe('2026-08-30');
    expect(P('gym day after tomorrow').dateISO).toBe('2026-08-31');
  });

  it('reads Arabic ones too', () => {
    expect(P('الجيم بكرة').dateISO).toBe('2026-08-30');
    expect(P('الجيم النهاردة').dateISO).toBe('2026-08-29');
  });

  it('treats a weekday as the next one, counting today', () => {
    // Said on a Saturday, "Saturday" means today; someone who meant a week
    // away says "next Saturday".
    expect(P('deadline saturday').dateISO).toBe('2026-08-29');
    expect(P('deadline next saturday').dateISO).toBe('2026-09-05');
    expect(P('deadline monday').dateISO).toBe('2026-08-31');
  });

  it('reads an ISO date', () => {
    const r = P('review 2026-09-12');
    expect(r.dateISO).toBe('2026-09-12');
    expect(r.title).toBe('review');
  });

  it('reads day/month day-first, as Egypt writes it', () => {
    expect(P('pay rent 3/9').dateISO).toBe('2026-09-03');
    expect(P('pay rent 12/9/2027').dateISO).toBe('2027-09-12');
  });

  it('rolls a date already past into next year', () => {
    expect(P('pay rent 3/1').dateISO).toBe('2027-01-03');
  });

  it('reads "12 Sep" and "Sep 12"', () => {
    expect(P('flight 12 Sep').dateISO).toBe('2026-09-12');
    expect(P('flight Sep 12').dateISO).toBe('2026-09-12');
    expect(P('flight 12 September').dateISO).toBe('2026-09-12');
  });

  it('rejects a day that does not exist', () => {
    expect(P('meet 31/2').dateISO).toBe(null);
  });
});

describe('times', () => {
  it('reads a meridiem', () => {
    expect(P('call at 3pm').start).toBe('15:00');
    expect(P('call 9am').start).toBe('09:00');
    expect(P('call 9:30am').start).toBe('09:30');
  });

  it('gets noon and midnight the right way round', () => {
    // The one case a naive +12 gets backwards in both directions.
    expect(P('lunch 12pm').start).toBe('12:00');
    expect(P('sleep 12am').start).toBe('00:00');
  });

  it('reads a 24-hour clock', () => {
    expect(P('standup 09:15').start).toBe('09:15');
    expect(P('standup 14:00').start).toBe('14:00');
  });

  it('reads a range, and carries a meridiem across it', () => {
    const r = P('workshop 9-11am');
    expect([r.start, r.end]).toEqual(['09:00', '11:00']);
    expect(P('workshop 2pm-4pm').start).toBe('14:00');
    expect(P('workshop 2pm to 4pm').end).toBe('16:00');
  });

  it('rejects impossible clock values', () => {
    expect(P('call at 25:00').start).toBe(null);
    expect(P('call at 9:75').start).toBe(null);
  });
});

describe('durations', () => {
  it('reads minutes and hours', () => {
    expect(P('write for 45m').minutes).toBe(45);
    expect(P('write 90 min').minutes).toBe(90);
    expect(P('write for 2h').minutes).toBe(120);
    expect(P('write 1h30').minutes).toBe(90);
  });

  it('turns a start plus a duration into an end', () => {
    const r = P('write 3pm for 45m');
    expect([r.start, r.end]).toEqual(['15:00', '15:45']);
  });

  it('does not read the duration back as a time', () => {
    expect(P('write for 45m').start).toBe(null);
  });
});

describe('periods of the day', () => {
  it('reads the six blocks, in both languages', () => {
    expect(P('quran fajr').block).toBe('fajr');
    expect(P('emails morning').block).toBe('morning');
    expect(P('مذاكرة العصر').block).toBe('asr');
    expect(P('reading isha').block).toBe('isha');
  });
});

describe('everything at once', () => {
  it('reads the example from the brief', () => {
    const r = P('fix the login crash tomorrow 2pm-4pm #Rhythm %Bugs');
    expect(r.title).toBe('fix the login crash');
    expect(r.dateISO).toBe('2026-08-30');
    expect([r.start, r.end]).toEqual(['14:00', '16:00']);
    expect(r.labelNames).toEqual(['Rhythm']);
    expect(r.labelIds).toEqual(['l2']);
    expect(r.projectId).toBe('p1');
  });

  it('does not care about order', () => {
    const a = P('%Bugs #calls call the bank monday 10am');
    const b = P('call the bank #calls monday %Bugs 10am');
    expect(a.title).toBe('call the bank');
    expect(b.title).toBe('call the bank');
    expect([a.dateISO, a.start, a.projectId]).toEqual([b.dateISO, b.start, b.projectId]);
  });

  it('never returns an empty title', () => {
    // A line that is nothing but tokens keeps its own words rather than
    // becoming an untitled task.
    const r = P('#calls %Bugs tomorrow 3pm');
    expect(r.title).toBeTruthy();
  });

  it('reads Arabic-Indic digits', () => {
    expect(P('اتصال ٣ عصر').block).toBe('asr');
  });
});

describe('describeParse', () => {
  it('summarises only what was understood', () => {
    const r = P('fix it tomorrow 2pm #calls %Bugs');
    const s = describeParse(r);
    expect(s).toContain('2026-08-30');
    expect(s).toContain('14:00');
    expect(s).toContain('%Bugs');
    expect(s).toContain('#calls');
  });
  it('says nothing about plain text', () => {
    expect(describeParse(P('call the dentist'))).toBe('');
  });
});

/* Typing `%bu` already resolved to "Bugs and Features" — what it did not do was
   say so, and finding out after pressing Enter is a coin toss you have to undo.
   The rule that matters here is that the suggestion list and the parser agree:
   picking a name from the list and typing the letters yourself must never mean
   different things. */
describe('tokenAt', () => {
  it('finds the token the caret sits in', () => {
    expect(tokenAt('call mum %bu', 12)).toMatchObject({ kind: 'project', query: 'bu' });
    expect(tokenAt('call mum #cal', 13)).toMatchObject({ kind: 'tag', query: 'cal' });
  });
  it('finds a bare sigil, so tapping # offers everything', () => {
    expect(tokenAt('call mum #', 10)).toMatchObject({ kind: 'tag', query: '' });
  });
  it('reports where the token starts and ends, sigil included', () => {
    const tok = tokenAt('do %bug now', 7);
    expect(tok).toMatchObject({ start: 3, end: 7, query: 'bug' });
  });
  it('works mid-string, not only at the end', () => {
    expect(tokenAt('%bu call mum', 3)).toMatchObject({ kind: 'project', query: 'bu' });
  });
  it('ignores a sigil that does not start a word', () => {
    // "50%off" is a discount, not a project.
    expect(tokenAt('50%off today', 6)).toBe(null);
    expect(tokenAt('a#b', 3)).toBe(null);
  });
  it('is null in ordinary prose', () => {
    expect(tokenAt('call mum tomorrow', 9)).toBe(null);
    expect(tokenAt('', 0)).toBe(null);
  });
  it('does not run past the caret into what is already written', () => {
    // Editing the middle of a token completes what is behind the cursor.
    expect(tokenAt('%bugs', 3)).toMatchObject({ query: 'bu', end: 3 });
  });
});

describe('suggestFor', () => {
  const labels = [{ id: 'l1', name: 'Bugs' }, { id: 'l2', name: 'Admin' }];
  const projects = [
    { id: 'p1', name: 'Bugs and Features' },
    { id: 'p2', name: 'The Book' },
    { id: 'p3', name: 'Old thing', completedAt: '2026-01-01' },
  ];

  it('matches a prefix of the name, or of any word in it — the parser\'s own rule', () => {
    const hits = suggestFor(tokenAt('%bu', 3), { labels, projects });
    expect(hits.map((h) => h.name)).toEqual(['Bugs and Features']);
    const inner = suggestFor(tokenAt('%boo', 4), { labels, projects });
    expect(inner.map((h) => h.name)).toEqual(['The Book']);
  });

  it('never offers a completed project', () => {
    expect(suggestFor(tokenAt('%old', 4), { labels, projects })).toEqual([]);
  });

  it('offers to create an unknown tag, because typing one does create it', () => {
    const hits = suggestFor(tokenAt('#newthing', 9), { labels, projects });
    expect(hits).toEqual([{ id: null, name: 'newthing', kind: 'tag', isNew: true }]);
  });

  it('never offers to create a project — a typo must not invent one', () => {
    expect(suggestFor(tokenAt('%zzz', 4), { labels, projects })).toEqual([]);
  });

  it('offers everything for a bare sigil', () => {
    expect(suggestFor(tokenAt('#', 1), { labels, projects }).map((h) => h.name)).toEqual(['Bugs', 'Admin']);
  });

  it('caps the list — this renders under an input on a phone', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: `Book ${i}` }));
    expect(suggestFor(tokenAt('%bo', 3), { labels: [], projects: many }).length).toBeLessThanOrEqual(6);
  });

  it('has nothing to say without a token', () => {
    expect(suggestFor(null, { labels, projects })).toEqual([]);
  });
});

describe('applySuggestion', () => {
  it('replaces the token and leaves the caret after it', () => {
    const r = applySuggestion('call mum %bu', tokenAt('call mum %bu', 12), 'Health');
    expect(r.text).toBe('call mum %Health ');
    expect(r.caret).toBe(r.text.length);
  });

  it('quotes a name with a space, because that is the only form the parser reads back', () => {
    // Unquoted, "%Bugs and Features" tags "Bugs" and leaves two stray words in
    // the title — the exact failure the suggestion exists to prevent.
    const r = applySuggestion('fix it %bu', tokenAt('fix it %bu', 10), 'Bugs and Features');
    expect(r.text).toBe('fix it %"Bugs and Features" ');
    const parsed = parseTaskText(r.text, { projects: [{ id: 'p1', name: 'Bugs and Features' }] });
    expect(parsed.projectId).toBe('p1');
    expect(parsed.title).toBe('fix it');
  });

  it('keeps what was typed after the token', () => {
    const text = 'call %bu mum tomorrow';
    const r = applySuggestion(text, tokenAt(text, 8), 'Health');
    expect(r.text).toBe('call %Health  mum tomorrow');
    expect(r.caret).toBe('call %Health '.length);
  });

  it('leaves the text alone with no token', () => {
    expect(applySuggestion('plain words', null, 'X')).toMatchObject({ text: 'plain words' });
  });
});
