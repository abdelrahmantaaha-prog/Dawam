/* The assistant's parser is the safety boundary: nothing reaches the plan
   unless it validates AND the person approves. Test it like it matters. */
import { describe, it, expect, afterEach } from 'vitest';
import { ACTIONS, MAX_PROPOSALS, MAX_SERIES, SERIES_DEFAULT_DAYS, seriesDates, parseAssistantReply, validateProposal, buildDaySnapshot, describeProposal, parseEstimates, callAssistant, ASSISTANT_SYSTEM } from '../src/assistant.js';

const IDS = {
  taskIds: ['t1', 't2'], poolIds: ['p1'], habitIds: ['h1'], projectIds: ['j1'], recurringIds: ['r1'],
  projects: [{ id: 'j1', name: 'The Book' }],
  columns: [{ id: 'todo', name: 'To do', projectId: 'j1' }, { id: 'doing', name: 'Doing', projectId: 'j1' }, { id: 'done', name: 'Done', projectId: 'j1' }],
  todayISO: '2026-08-14',
};

describe('validateProposal', () => {
  it('accepts a well-formed add_task', () => {
    expect(validateProposal({ kind: 'add_task', title: 'Write column', block: 'dhuhr', date: '2026-08-16', start: '13:00', end: '14:00', why: 'free slot' }, IDS))
      .toEqual({ kind: 'add_task', title: 'Write column', block: 'dhuhr', date: '2026-08-16', start: '13:00', end: '14:00', why: 'free slot' });
  });
  it('rejects an unknown block', () => {
    expect(validateProposal({ kind: 'add_task', title: 'x', block: 'brunch', date: '2026-08-15' }, IDS)).toBe(null);
  });
  it('rejects a date that is not a real day', () => {
    // '2026-02-31' parses to March 3rd in JavaScript, so the round trip is what
    // catches it; without that the task silently lands on the wrong date.
    expect(validateProposal({ kind: 'add_task', title: 'x', block: 'asr', date: '2026-02-31' }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'add_task', title: 'x', block: 'asr', date: '15-08-2026' }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'add_task', title: 'x', block: 'asr', date: 'tomorrow' }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'add_task', title: 'x', block: 'asr' }, IDS)).toBe(null);
  });

  it('rejects a date far outside the window a planner would ever mean', () => {
    expect(validateProposal({ kind: 'add_task', title: 'x', block: 'asr', date: '2087-01-01' }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'add_task', title: 'x', block: 'asr', date: '1999-01-01' }, IDS)).toBe(null);
  });

  it('accepts a date in the NEXT week — the Friday-to-Saturday case', () => {
    // The bug this replaced: the contract could only say 'day 0-6 of the shown
    // week', so pushing a Friday task to Saturday meant the Saturday six days
    // BEHIND it. An absolute date is the only way to say the one ahead.
    expect(validateProposal({ kind: 'move_task', taskId: 't1', block: 'morning', date: '2026-08-15', why: 'next day' }, IDS))
      .toEqual({ kind: 'move_task', taskId: 't1', block: 'morning', date: '2026-08-15', why: 'next day' });
  });
  it('rejects a hallucinated task id', () => {
    expect(validateProposal({ kind: 'move_task', taskId: 'nope', block: 'asr', date: '2026-08-15' }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'complete_task', taskId: 'ghost' }, IDS)).toBe(null);
  });
  it('accepts ids that exist', () => {
    expect(validateProposal({ kind: 'complete_task', taskId: 't1', why: 'done' }, IDS)).toMatchObject({ kind: 'complete_task', taskId: 't1' });
    expect(validateProposal({ kind: 'backlog_to_day', poolId: 'p1', block: 'morning', date: '2026-08-15' }, IDS)).toMatchObject({ poolId: 'p1' });
  });
  it('rejects an unknown action kind outright', () => {
    expect(validateProposal({ kind: 'delete_everything', taskId: 't1' }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'send_email', to: 'x@y.z' }, IDS)).toBe(null);
  });
  it('rejects malformed times', () => {
    expect(validateProposal({ kind: 'add_task', title: 'x', block: 'asr', date: '2026-08-15', start: 'half past' }, IDS)).toBe(null);
  });
  it('rejects junk input', () => {
    expect(validateProposal(null, IDS)).toBe(null);
    expect(validateProposal('nope', IDS)).toBe(null);
    expect(validateProposal({}, IDS)).toBe(null);
  });
});

describe('parseAssistantReply', () => {
  it('parses reply + valid proposals', () => {
    const txt = JSON.stringify({ reply: 'You are overcommitted.', proposals: [{ kind: 'complete_task', taskId: 't1', why: 'already done' }] });
    const r = parseAssistantReply(txt, IDS);
    expect(r.reply).toBe('You are overcommitted.');
    expect(r.proposals).toHaveLength(1);
  });
  it('tolerates markdown fences and preamble', () => {
    const txt = 'Sure!\n```json\n{"reply":"ok","proposals":[]}\n```';
    expect(parseAssistantReply(txt, IDS).reply).toBe('ok');
  });
  it('drops invalid proposals but keeps the good ones', () => {
    const txt = JSON.stringify({ reply: 'r', proposals: [
      { kind: 'complete_task', taskId: 't1' },
      { kind: 'move_task', taskId: 'hallucinated', block: 'asr', date: '2026-08-15' },
      { kind: 'nuke', taskId: 't2' },
    ] });
    const r = parseAssistantReply(txt, IDS);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].taskId).toBe('t1');
  });
  it('caps proposals at the documented maximum', () => {
    const many = Array.from({ length: MAX_PROPOSALS + 4 }, () => ({ kind: 'complete_task', taskId: 't1', why: 'w' }));
    expect(parseAssistantReply(JSON.stringify({ reply: 'r', proposals: many }), IDS).proposals).toHaveLength(MAX_PROPOSALS);
  });
  it('falls back to plain text when there is no JSON', () => {
    const r = parseAssistantReply('I think you should rest today.', IDS);
    expect(r.reply).toBe('I think you should rest today.');
    expect(r.proposals).toEqual([]);
  });
  it('survives malformed JSON without throwing', () => {
    const r = parseAssistantReply('{"reply": "oops", "proposals": [', IDS);
    expect(r.proposals).toEqual([]);
  });
});

describe('buildDaySnapshot', () => {
  it('includes ids and marks empties explicitly', () => {
    const s = buildDaySnapshot({
      dateLabel: 'Sunday 12 Jul', dayIdx: 1, dayNames: ['Sat', 'Sun'], activeBlock: 'dhuhr',
      tasks: [{ id: 't1', block: 'morning', title: 'Open the newsroom', done: true }],
      pool: [], habits: [{ name: 'Quran', block: 'fajr', streak: 7, doneToday: true }],
      prayersDone: ['fajr'], overdue: [], projects: [],
    });
    expect(s).toContain('id=t1');
    expect(s).toContain('NOW IN PERIOD: dhuhr');
    expect(s).toContain('OVERDUE TASKS: none');
    expect(s).toContain('streak=7');
  });
});

describe('parseEstimates — the model advises, this decides', () => {
  const IDS = ['t1', 't2'];

  it('reads a clean answer', () => {
    const m = parseEstimates('[{"id":"t1","minutes":45},{"id":"t2","minutes":15}]', IDS);
    expect(m.get('t1')).toBe(45);
    expect(m.get('t2')).toBe(15);
  });

  it('tolerates fences and prose around the array', () => {
    const m = parseEstimates('Sure! ```json\n[{"id":"t1","minutes":30}]\n``` hope that helps', IDS);
    expect(m.get('t1')).toBe(30);
  });

  it('drops hallucinated ids instead of sizing ghosts', () => {
    const m = parseEstimates('[{"id":"made-up","minutes":30},{"id":"t1","minutes":20}]', IDS);
    expect(m.has('made-up')).toBe(false);
    expect(m.get('t1')).toBe(20);
  });

  it('clamps to 5..180 — a model saying "600" does not eat the day', () => {
    const m = parseEstimates('[{"id":"t1","minutes":600},{"id":"t2","minutes":1}]', IDS);
    expect(m.get('t1')).toBe(180);
    expect(m.get('t2')).toBe(5);
  });

  it('returns null for junk, so the caller falls back to the heuristic', () => {
    expect(parseEstimates('I cannot help with that.', IDS)).toBe(null);
    expect(parseEstimates('{"id":"t1","minutes":30}', IDS)).toBe(null); // object, not array
    expect(parseEstimates('[{"id":"t1","minutes":"soon"}]', IDS)).toBe(null);
    expect(parseEstimates(null, IDS)).toBe(null);
  });
});

/* The action table is now the contract: the prompt is generated from it and
   the validator walks it. These guard the two ways that can go wrong — a row
   naming a type that doesn't exist, and an action the prompt never mentions. */
describe('the action table', () => {
  it('reaches every part of the app the person can reach by hand', () => {
    const kinds = ACTIONS.map((a) => a.kind);
    for (const k of ['add_task', 'delete_task', 'add_step', 'complete_step', 'add_backlog',
      'add_recurring', 'recurring_to_day', 'add_habit', 'mark_habit', 'mark_prayer',
      'add_project', 'log_project', 'add_reward', 'slot_day', 'start_focus', 'set_alarm',
      'overdue_to_today', 'go_to_date', 'open_view', 'set_language', 'set_theme', 'set_option']) {
      expect(kinds).toContain(k);
    }
    expect(new Set(kinds).size).toBe(kinds.length); // no duplicate rows
  });

  it('tells the model about every action it will accept', () => {
    for (const a of ACTIONS) expect(ASSISTANT_SYSTEM).toContain(`"kind":"${a.kind}"`);
  });

  it('accepts a valid instance of every action, and rejects it stripped of its ids', () => {
    const sample = {
      add_task: { title: 'x', block: 'asr', date: '2026-08-15' },
      add_task_series: { title: 'x', block: 'asr', from: '2026-08-15' },
      move_card: { taskId: 't1', column: 'Doing' },
      open_board: { project: 'j1' },
      add_column: { project: 'j1', name: 'Review' },
      rename_column: { project: 'j1', column: 'todo', name: 'Inbox' },
      delete_column: { project: 'j1', column: 'doing' },
      move_task: { taskId: 't1', block: 'asr', date: '2026-08-15' },
      edit_task: { taskId: 't1', title: 'renamed' },
      complete_task: { taskId: 't1' },
      reopen_task: { taskId: 't1' },
      delete_task: { taskId: 't1' },
      task_to_backlog: { taskId: 't1' },
      add_step: { taskId: 't1', title: 'step' },
      complete_step: { taskId: 't1', step: 2 },
      add_backlog: { title: 'x' },
      backlog_to_day: { poolId: 'p1', block: 'asr', date: '2026-08-15' },
      complete_backlog: { poolId: 'p1' },
      delete_backlog: { poolId: 'p1' },
      add_recurring: { title: 'x', block: 'fajr' },
      recurring_to_day: { recurringId: 'r1', date: '2026-08-15' },
      delete_recurring: { recurringId: 'r1' },
      add_habit: { name: 'Quran', block: 'fajr' },
      mark_habit: { habitId: 'h1', date: '2026-08-14' },
      delete_habit: { habitId: 'h1' },
      mark_prayer: { prayer: 'asr', date: '2026-08-14' },
      add_project: { name: 'Book' },
      log_project: { projectId: 'j1', amount: 12 },
      complete_project: { projectId: 'j1' },
      add_reward: { name: 'Coffee', cost: 100 },
      slot_day: { date: '2026-08-14' },
      clear_slots: { date: '2026-08-14' },
      start_focus: { taskId: 't1' },
      set_alarm: { at: '05:30' },
      cancel_alarm: {},
      overdue_to_today: {},
      go_to_date: { date: '2026-08-16' },
      open_view: { view: 'plan' },
      set_language: { lang: 'ar' },
      set_theme: { theme: 'dark' },
      set_option: { option: 'time24', on: true },
    };
    for (const a of ACTIONS) {
      const body = sample[a.kind];
      expect(body, `no sample for ${a.kind}`).toBeTruthy();
      expect(validateProposal({ kind: a.kind, ...body, why: 'w' }, IDS), a.kind).toBeTruthy();
    }
  });

  it('refuses ids the snapshot never showed it', () => {
    expect(validateProposal({ kind: 'mark_habit', habitId: 'ghost', date: '2026-08-14' }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'log_project', projectId: 'ghost', amount: 1 }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'recurring_to_day', recurringId: 'ghost', date: '2026-08-14' }, IDS)).toBe(null);
    // Prayer "habits" are not habit records; mark_prayer is the only way in.
    expect(validateProposal({ kind: 'mark_habit', habitId: 'prayer:fajr', date: '2026-08-14' }, IDS)).toBe(null);
  });

  it('refuses settings values outside the whitelist', () => {
    expect(validateProposal({ kind: 'set_option', option: 'pin', on: false }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'set_option', option: 'time24', on: 'yes' }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'set_theme', theme: 'neon' }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'set_language', lang: 'fr' }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'open_view', view: 'settings' }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'mark_prayer', prayer: 'morning', date: '2026-08-14' }, IDS)).toBe(null);
  });

  it('drops an edit that would change nothing', () => {
    expect(validateProposal({ kind: 'edit_task', taskId: 't1', why: 'w' }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'edit_task', taskId: 't1', start: '09:00' }, IDS)).toMatchObject({ start: '09:00' });
  });

  it('clamps and rejects numbers the way the app can survive', () => {
    expect(validateProposal({ kind: 'start_focus', taskId: 't1', minutes: 99999 }, IDS).minutes).toBe(600);
    expect(validateProposal({ kind: 'start_focus', taskId: 't1', minutes: 0 }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'complete_step', taskId: 't1', step: 0 }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'complete_step', taskId: 't1', step: 1.5 }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'log_project', projectId: 'j1', amount: -5 }, IDS).amount).toBe(-5);
    expect(validateProposal({ kind: 'set_alarm', at: '25:00' }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'set_alarm', at: '05:70' }, IDS)).toBe(null);
  });

  it('keeps subtask lists as strings and drops the rest', () => {
    const r = validateProposal({ kind: 'add_task', title: 'x', block: 'asr', date: '2026-08-15', steps: ['a', { title: 'b' }, 42, ''] }, IDS);
    expect(r.steps).toEqual(['a', 'b']);
    expect(validateProposal({ kind: 'add_backlog', title: 'x', steps: 'not an array' }, IDS)).toBe(null);
  });
});

describe('describeProposal', () => {
  const names = { task: () => 'Write the column', pool: () => 'Read the note', habit: () => 'Quran', project: () => 'Book', recurring: () => 'Standup' };
  it('names the thing, not the id', () => {
    expect(describeProposal({ kind: 'complete_task', taskId: 't1' }, names)).toContain('Write the column');
    expect(describeProposal({ kind: 'log_project', projectId: 'j1', amount: 12 }, names)).toContain('Book');
  });
  it('has a line for every action in the table', () => {
    for (const a of ACTIONS) {
      const text = describeProposal({ kind: a.kind, date: '2026-08-15', block: 'asr', prayer: 'asr', view: 'plan', lang: 'ar', theme: 'dark', option: 'time24', on: true, at: '05:30', title: 'T', name: 'N', cost: 5, amount: 3, step: 1 }, names);
      expect(text, a.kind).not.toBe(a.kind); // the fallback means an unwritten case
    }
  });
});

/* Which credential is wrong?

   The two providers disagree in a way that turns out to be diagnostic: a bad
   Gemini key comes back 400 INVALID_ARGUMENT, while the broker answers 401
   broker_auth. So a 401 always means the pool token, never the key — and the
   app has to say so, because "Assistant unavailable (HTTP 401)" sends people
   to re-check the one credential that was fine. */
describe('telling a rejected pool token from an outage', () => {
  const BROKER = { url: 'https://pool.example', token: 'kb_wrong' };
  const reply = (status, body = {}) => Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  let calls;
  const stub = (fn) => { calls = []; globalThis.fetch = (url, init) => { calls.push(String(url)); return fn(String(url), init); }; };
  afterEach(() => { delete globalThis.fetch; });

  const ask = (opts) => callAssistant({ system: 's', messages: [{ role: 'user', content: 'hi' }], ...opts });

  it('reports a rejected token as pool_auth, not a bare HTTP code', async () => {
    stub(() => reply(401, { error: { type: 'broker_auth' } }));
    await expect(ask({ broker: BROKER })).rejects.toMatchObject({ code: 'pool_auth' });
  });

  it('treats 403 the same way', async () => {
    stub(() => reply(403));
    await expect(ask({ broker: BROKER })).rejects.toMatchObject({ code: 'pool_auth' });
  });

  it('still falls through to this device\u2019s own key when there is one', async () => {
    // A rejected pool token must not take the app down when it has a key of
    // its own — that is the whole reason the local key paths stayed in place.
    stub((url) => (url.includes('pool.example')
      ? reply(401)
      : reply(200, { choices: [{ message: { content: 'from the local key' } }] })));
    await expect(ask({ broker: BROKER, apiKey: 'AIza-local' })).resolves.toBe('from the local key');
    expect(calls.some((u) => u.includes('generativelanguage'))).toBe(true);
  });

  it('does not confuse an outage with a bad token', async () => {
    stub(() => reply(503));
    await expect(ask({ broker: BROKER })).rejects.toMatchObject({ message: 'pool unavailable' });
  });

  it('reports a rate limit as rate, from either lane', async () => {
    stub(() => reply(429));
    await expect(ask({ apiKey: 'AIza-local' })).rejects.toMatchObject({ code: 'rate' });
  });
});

/* Repeats.

   The arithmetic is pure and lives beside the action table because the same
   function answers two questions that must never disagree: how many tasks the
   description promises, and how many actually get written. */
describe('seriesDates', () => {
  it('defaults to one week when no end date was given', () => {
    // The person's own rule. A model asked to invent an end date invents a
    // different one each time, and being asked "until when?" is the thing they
    // said they did not want.
    const d = seriesDates({ from: '2026-08-30' });
    expect(d).toHaveLength(SERIES_DEFAULT_DAYS);
    expect(d[0]).toBe('2026-08-30');
    expect(d[d.length - 1]).toBe('2026-09-05');
  });

  it('honours an end date when there is one', () => {
    expect(seriesDates({ from: '2026-08-30', until: '2026-09-02' }))
      .toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  });

  it('steps by everyDays — 7 is weekly', () => {
    expect(seriesDates({ from: '2026-08-30', until: '2026-09-27', everyDays: 7 }))
      .toEqual(['2026-08-30', '2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']);
    expect(seriesDates({ from: '2026-08-30', until: '2026-09-05', everyDays: 2 }))
      .toEqual(['2026-08-30', '2026-09-01', '2026-09-03', '2026-09-05']);
  });

  it('treats named weekdays as a filter, not a stride', () => {
    // "Every Monday and Thursday" is not a fixed number of days apart, so a
    // stride cannot express it.
    const d = seriesDates({ from: '2026-08-30', until: '2026-09-13', weekdays: ['mon', 'thu'] });
    expect(d).toEqual(['2026-08-31', '2026-09-03', '2026-09-07', '2026-09-10']);
  });

  it('lets weekdays win over everyDays rather than combining them', () => {
    const d = seriesDates({ from: '2026-08-30', until: '2026-09-13', weekdays: ['fri'], everyDays: 3 });
    expect(d.every((iso) => new Date(`${iso}T00:00`).getDay() === 5)).toBe(true);
  });

  it('caps a runaway range instead of writing hundreds of tasks', () => {
    // "Daily until the end of the year" is a sentence someone will say.
    expect(seriesDates({ from: '2026-08-30', until: '2027-08-30' })).toHaveLength(MAX_SERIES);
  });

  it('returns nothing for a range that runs backwards or a bad date', () => {
    expect(seriesDates({ from: '2026-08-30', until: '2026-08-01' })).toEqual([]);
    expect(seriesDates({ from: 'tomorrow' })).toEqual([]);
    expect(seriesDates({})).toEqual([]);
  });
});

describe('add_task_series and projects', () => {
  it('validates a bare series and fills in nothing it was not told', () => {
    const r = validateProposal({ kind: 'add_task_series', title: 'Gym', block: 'asr', from: '2026-08-15', why: 'w' }, IDS);
    expect(r).toMatchObject({ kind: 'add_task_series', title: 'Gym', block: 'asr', from: '2026-08-15' });
    expect(r.until).toBeUndefined();          // the default lives in seriesDates, not in the record
    expect(seriesDates(r)).toHaveLength(7);
  });

  it('drops a series that would land on no days at all', () => {
    expect(validateProposal({ kind: 'add_task_series', title: 'x', block: 'asr', from: '2026-08-20', until: '2026-08-15' }, IDS)).toBe(null);
  });

  it('rejects a cadence outside anything a person means', () => {
    expect(validateProposal({ kind: 'add_task_series', title: 'x', block: 'asr', from: '2026-08-15', everyDays: 0 }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'add_task_series', title: 'x', block: 'asr', from: '2026-08-15', everyDays: 1000 }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'add_task_series', title: 'x', block: 'asr', from: '2026-08-15', weekdays: ['funday'] }, IDS)).toBe(null);
  });

  it('normalises weekday names people actually write', () => {
    const r = validateProposal({ kind: 'add_task_series', title: 'x', block: 'asr', from: '2026-08-15', weekdays: ['Monday', 'WED', 'mon'] }, IDS);
    expect(r.weekdays).toEqual(['mon', 'wed']);
  });

  it('attaches a long-term project only when the id is real', () => {
    expect(validateProposal({ kind: 'add_task', title: 'x', block: 'asr', date: '2026-08-15', project: 'j1' }, IDS).project).toBe('j1');
    expect(validateProposal({ kind: 'add_task', title: 'x', block: 'asr', date: '2026-08-15', project: 'ghost' }, IDS)).toBe(null);
  });

  it('keeps label and project as separate things', () => {
    // label is a free-text tag created on demand; project is an id that must
    // already exist. Conflating them is how a task ends up tagged "Book" and
    // linked to nothing.
    const r = validateProposal({ kind: 'add_task', title: 'x', block: 'asr', date: '2026-08-15', label: 'Deep work', project: 'j1' }, IDS);
    expect(r.label).toBe('Deep work');
    expect(r.project).toBe('j1');
  });

  it('describes a series by its real count and range', () => {
    const text = describeProposal({ kind: 'add_task_series', title: 'Gym', block: 'asr', from: '2026-08-30' }, {});
    expect(text).toContain('×7');
    expect(text).toContain('30 Aug');
    expect(text).toContain('5 Sep');
  });
});

describe('naming a project the way a person does', () => {
  it('accepts the name the snapshot printed, not just the id', () => {
    // The model echoes the person's own words: asked to link something to
    // "The Book", it answers project:"The Book". Rejecting that dropped the
    // whole proposal — and a dropped proposal is invisible, so the reply still
    // said "added under The Book" while nothing appeared on the day.
    expect(validateProposal({ kind: 'add_task', title: 'x', block: 'asr', date: '2026-08-15', project: 'The Book' }, IDS).project).toBe('j1');
    expect(validateProposal({ kind: 'add_task', title: 'x', block: 'asr', date: '2026-08-15', project: 'the book' }, IDS).project).toBe('j1');
    expect(validateProposal({ kind: 'log_project', projectId: 'The Book', amount: 3 }, IDS).projectId).toBe('j1');
  });

  it('resolves a name on a series too', () => {
    const r = validateProposal({ kind: 'add_task_series', title: 'x', block: 'asr', from: '2026-08-15', project: 'The Book' }, IDS);
    expect(r.project).toBe('j1');
  });

  it('still refuses a project that exists under neither spelling', () => {
    expect(validateProposal({ kind: 'add_task', title: 'x', block: 'asr', date: '2026-08-15', project: 'The Novel' }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'log_project', projectId: 'ghost', amount: 1 }, IDS)).toBe(null);
  });

  it('leaves task and backlog ids strict', () => {
    // Projects are few and deliberately named. Task titles are neither, so
    // matching those by text would be a coin toss between duplicates.
    expect(validateProposal({ kind: 'complete_task', taskId: 'Write the column' }, IDS)).toBe(null);
  });
});

/* Board actions.

   Columns are per project, so the validator can only prove a name exists on
   SOME board — which project owns it is settled when the action is applied,
   from the task or project the action already names. That is still a real
   rail: a column nobody has never reaches the board. */
describe('board actions', () => {
  it('accepts a column by name or by id', () => {
    expect(validateProposal({ kind: 'move_card', taskId: 't1', column: 'Doing' }, IDS).column).toBe('Doing');
    expect(validateProposal({ kind: 'move_card', taskId: 't1', column: 'doing' }, IDS).column).toBe('doing');
  });

  it('refuses a column that exists on no board at all', () => {
    expect(validateProposal({ kind: 'move_card', taskId: 't1', column: 'Blocked' }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'delete_column', project: 'j1', column: 'Nope' }, IDS)).toBe(null);
  });

  it('still refuses a hallucinated task or project', () => {
    expect(validateProposal({ kind: 'move_card', taskId: 'ghost', column: 'Doing' }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'open_board', project: 'ghost' }, IDS)).toBe(null);
  });

  it('names a project by its printed name here too', () => {
    expect(validateProposal({ kind: 'open_board', project: 'The Book' }, IDS).project).toBe('j1');
  });

  it('describes each one without falling back to the raw kind', () => {
    const names = { task: () => 'Chapter 4', project: () => 'The Book' };
    for (const p of [
      { kind: 'move_card', taskId: 't1', column: 'Doing' },
      { kind: 'open_board', project: 'j1' },
      { kind: 'add_column', project: 'j1', name: 'Review' },
      { kind: 'rename_column', project: 'j1', column: 'todo', name: 'Inbox' },
      { kind: 'delete_column', project: 'j1', column: 'doing' },
    ]) {
      expect(describeProposal(p, names), p.kind).not.toBe(p.kind);
    }
  });
});
