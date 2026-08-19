/* The assistant's parser is the safety boundary: nothing reaches the plan
   unless it validates AND the person approves. Test it like it matters. */
import { describe, it, expect } from 'vitest';
import { parseAssistantReply, validateProposal, buildDaySnapshot, parseEstimates } from '../src/assistant.js';

const IDS = { taskIds: ['t1', 't2'], poolIds: ['p1'], todayISO: '2026-08-14' };

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
  it('caps proposals at five', () => {
    const many = Array.from({ length: 9 }, () => ({ kind: 'complete_task', taskId: 't1', why: 'w' }));
    expect(parseAssistantReply(JSON.stringify({ reply: 'r', proposals: many }), IDS).proposals).toHaveLength(5);
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
