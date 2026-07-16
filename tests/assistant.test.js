/* The assistant's parser is the safety boundary: nothing reaches the plan
   unless it validates AND the person approves. Test it like it matters. */
import { describe, it, expect } from 'vitest';
import { parseAssistantReply, validateProposal, buildDaySnapshot } from '../src/assistant.js';

const IDS = { taskIds: ['t1', 't2'], poolIds: ['p1'] };

describe('validateProposal', () => {
  it('accepts a well-formed add_task', () => {
    expect(validateProposal({ kind: 'add_task', title: 'Write column', block: 'dhuhr', day: 2, start: '13:00', end: '14:00', why: 'free slot' }, IDS))
      .toEqual({ kind: 'add_task', title: 'Write column', block: 'dhuhr', day: 2, start: '13:00', end: '14:00', why: 'free slot' });
  });
  it('rejects an unknown block', () => {
    expect(validateProposal({ kind: 'add_task', title: 'x', block: 'brunch', day: 1 }, IDS)).toBe(null);
  });
  it('rejects an out-of-range day', () => {
    expect(validateProposal({ kind: 'add_task', title: 'x', block: 'asr', day: 9 }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'add_task', title: 'x', block: 'asr', day: -1 }, IDS)).toBe(null);
  });
  it('rejects a hallucinated task id', () => {
    expect(validateProposal({ kind: 'move_task', taskId: 'nope', block: 'asr', day: 1 }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'complete_task', taskId: 'ghost' }, IDS)).toBe(null);
  });
  it('accepts ids that exist', () => {
    expect(validateProposal({ kind: 'complete_task', taskId: 't1', why: 'done' }, IDS)).toMatchObject({ kind: 'complete_task', taskId: 't1' });
    expect(validateProposal({ kind: 'backlog_to_day', poolId: 'p1', block: 'morning', day: 0 }, IDS)).toMatchObject({ poolId: 'p1' });
  });
  it('rejects an unknown action kind outright', () => {
    expect(validateProposal({ kind: 'delete_everything', taskId: 't1' }, IDS)).toBe(null);
    expect(validateProposal({ kind: 'send_email', to: 'x@y.z' }, IDS)).toBe(null);
  });
  it('rejects malformed times', () => {
    expect(validateProposal({ kind: 'add_task', title: 'x', block: 'asr', day: 1, start: 'half past' }, IDS)).toBe(null);
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
      { kind: 'move_task', taskId: 'hallucinated', block: 'asr', day: 1 },
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
