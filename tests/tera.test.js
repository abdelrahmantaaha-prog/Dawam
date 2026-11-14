import { describe, it, expect } from 'vitest';
import { ASSISTANT_SYSTEM } from '../src/assistant.js';
import {
  POPUP_BATCH_SYSTEM, popupBatchPrompt, parsePopupBatch, TERA_TOOL_SYSTEM,
  TERA_SWAPS, TERA_SYSTEM, TERA_SYSTEM_ASKING, TERA_BANK, TERA_DEFAULTS, teraSettings, teraLabels,
  detectLang, pushTimes, commandToActions, briefAppointments, buildBrief, loadChat, saveChat, CHAT_KEY, MAX_KEPT,
} from '../src/tera.js';

describe('Tera system prompt', () => {
  it('every swap still finds its sentence in the assistant prompt', () => {
    // If assistant.js rewords one of these, Tera would silently keep the old
    // instruction (e.g. "nothing happens until approved"). Fail instead.
    for (const [from] of TERA_SWAPS) {
      if (from instanceof RegExp) expect(from.test(ASSISTANT_SYSTEM)).toBe(true);
      else expect(ASSISTANT_SYSTEM.includes(from)).toBe(true);
    }
  });
  it('is Tera, applies immediately, and keeps the action contract', () => {
    expect(TERA_SYSTEM).toMatch(/You are Tera/);
    expect(TERA_SYSTEM).toMatch(/APPLIED IMMEDIATELY/);
    expect(TERA_SYSTEM).not.toMatch(/applied only if they approve it/);
    expect(TERA_SYSTEM).not.toMatch(/approves each proposal manually/);
    expect(TERA_SYSTEM).toMatch(/"kind":"complete_task"/);
    expect(TERA_SYSTEM).toMatch(/EGYPTIAN colloquial Arabic/);
  });
  it('the asking variant keeps approval but has her voice', () => {
    expect(TERA_SYSTEM_ASKING).toMatch(/You are Tera/);
    expect(TERA_SYSTEM_ASKING).toMatch(/applied only if they approve it/);
  });
});

describe('detectLang', () => {
  it('reads the script', () => {
    expect(detectLang('خلصت التقرير')).toBe('ar');
    expect(detectLang('I finished the report')).toBe('en');
    expect(detectLang('خلصت ال report خلاص')).toBe('ar');
    expect(detectLang('12:30', 'en')).toBe('en');
    expect(detectLang('', 'ar')).toBe('ar');
  });
});

describe('pushTimes', () => {
  it('moves a slot and keeps its length', () => {
    expect(pushTimes('14:00', '15:00', 15)).toEqual({ start: '14:15', end: '15:15', days: 0 });
    expect(pushTimes('09:30', '10:00', 60)).toEqual({ start: '10:30', end: '11:00', days: 0 });
  });
  it('carries over midnight', () => {
    expect(pushTimes('23:30', '00:30', 60)).toEqual({ start: '00:30', end: '01:30', days: 1 });
  });
  it('a start with no end stays endless', () => {
    expect(pushTimes('08:00', '', 15)).toEqual({ start: '08:15', end: '', days: 0 });
  });
});

describe('commandToActions', () => {
  const tasks = {
    a: { id: 'a', title: 'Report', start: '14:00', end: '15:00', block: 'dhuhr', done: false },
    b: { id: 'b', title: 'Call', start: '', end: '', block: 'asr', done: false },
    c: { id: 'c', title: 'Old', start: '10:00', end: '11:00', block: 'morning', done: true },
    n: { id: 'n', title: 'Late', start: '23:30', end: '23:50', block: 'isha', done: false },
  };
  const ctx = {
    taskOf: (id) => tasks[id] || null,
    dateOf: () => '2026-11-13',
    addDaysISO: (iso, k) => {
      const d = new Date(`${iso}T00:00:00`);
      d.setDate(d.getDate() + k);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
  };
  it('done ticks an open task, and ignores a ticked or unknown one', () => {
    expect(commandToActions({ type: 'done', id: 'a' }, ctx)).toEqual([{ kind: 'complete_task', taskId: 'a' }]);
    expect(commandToActions({ type: 'done', id: 'c' }, ctx)).toEqual([]);
    expect(commandToActions({ type: 'done', id: 'zz' }, ctx)).toEqual([]);
  });
  it('push re-times a timed task', () => {
    expect(commandToActions({ type: 'push', id: 'a', minutes: 15 }, ctx)).toEqual([{ kind: 'edit_task', taskId: 'a', start: '14:15', end: '15:15' }]);
  });
  it('a whole day moves the date instead', () => {
    expect(commandToActions({ type: 'push', id: 'a', minutes: 1440 }, ctx)).toEqual([{ kind: 'move_task', taskId: 'a', block: 'dhuhr', date: '2026-11-14' }]);
  });
  it('past midnight re-times and moves to the next day', () => {
    expect(commandToActions({ type: 'push', id: 'n', minutes: 60 }, ctx)).toEqual([
      { kind: 'edit_task', taskId: 'n', start: '00:30', end: '00:50' },
      { kind: 'move_task', taskId: 'n', block: 'isha', date: '2026-11-14' },
    ]);
  });
  it('an untimed task has no time to push, and nonsense maps to nothing', () => {
    expect(commandToActions({ type: 'push', id: 'b', minutes: 15 }, ctx)).toEqual([]);
    expect(commandToActions({ type: 'push', id: 'a', minutes: -5 }, ctx)).toEqual([]);
    expect(commandToActions({ type: 'explode', id: 'a' }, ctx)).toEqual([]);
    expect(commandToActions(null, ctx)).toEqual([]);
  });
});

describe('briefAppointments', () => {
  const now = new Date(2026, 10, 13, 12, 0).getTime();
  const at = (h, m = 0, d = 13) => new Date(2026, 10, d, h, m).getTime();
  it('keeps upcoming timed tasks and events, sorted, and drops the rest', () => {
    const out = briefAppointments({
      now,
      tasks: [
        { id: 't1', title: 'Dentist', at: at(15), end: at(16) },
        { id: 't2', title: 'Done already', at: at(14), done: true },
        { id: 't3', title: 'Long gone', at: at(9) },
        { id: 't4', title: 'Untimed', at: NaN },
        { id: 't5', title: 'Next week', at: at(10, 0, 20) },
        { id: 't6', title: 'Tomorrow', at: at(10, 0, 14) },
      ],
      events: [
        { key: 'e1', summary: 'Standup', startMs: at(13), endMs: at(13, 15) },
        { key: 'e2', summary: 'Birthday', startMs: at(0), endMs: at(23, 59), allDay: true },
      ],
    });
    expect(out.map((x) => x.title)).toEqual(['Standup', 'Dentist', 'Tomorrow']);
    expect(out[0]).toMatchObject({ key: 'c:e1', kind: 'cal' });
    expect(out[1]).toMatchObject({ key: 't:t1', id: 't1', kind: 'task', end: at(16) });
  });
});

describe('buildBrief', () => {
  it('carries settings, clamps them, and keeps the appointments flag apart from the list', () => {
    const b = buildBrief({
      settings: { apiKey: 'k', tera: { nagMin: 5, quietFrom: 'nope', appts: false } },
      talkLang: 'en',
      appts: [{ key: 't:x', id: 'x', kind: 'task', title: 'X', at: 1, end: 0 }],
      fresh: { nag: [['a {hours}'], [], []], appt: { 't:x': 'X soon' } },
    });
    expect(b.nagMin).toBe(15);
    expect(b.quietFrom).toBe('00:00');
    expect(b.apptsOn).toBe(false);
    expect(b.appts).toHaveLength(1);
    // No key of any kind travels to the phone's own storage.
    expect(JSON.stringify(b)).not.toMatch(/"k"|apiKey|gemini|groq|broker|sk-ant/);
    expect(b.fresh.appt['t:x']).toBe('X soon');
    expect(b.labels.ok).toBe('On it');
    expect(b.bank).toBe(TERA_BANK);
  });
  it('defaults are on, in Arabic', () => {
    const b = buildBrief({ settings: {} });
    expect(b.enabled && b.nag && b.apptsOn && b.speakPopups).toBe(true);
    expect(b.talkLang).toBe('ar');
    expect(b.labels.ok).toBe(teraLabels('ar').ok);
    expect(teraSettings({}).nagMin).toBe(TERA_DEFAULTS.nagMin);
    expect(b.openUntil).toBe(0);
    expect(buildBrief({ settings: {}, openUntil: 1763090000000 }).openUntil).toBe(1763090000000);
  });
});

describe('the bank', () => {
  it('never talks down (owner, 2026-11-13: "she talks to me like I\'m stupid")', () => {
    const patronising = /finally|look at you|wasn't so hard|keep it up|good job|well done|actually|pretend to believe|شاطر|برافو|مين قدّك|شوف إزاي|أخيرًا|أصلاً|بنسخّن|يا نجم/i;
    const lines = Object.values(TERA_BANK).flatMap((k) => [...k.ar, ...k.en]);
    for (const l of lines) expect(l).not.toMatch(patronising);
    for (const lang of ['ar', 'en']) expect(teraLabels(lang).ackFallback).not.toMatch(patronising);
  });
  it('has lines in both languages for every kind', () => {
    for (const k of ['nag', 'appt', 'ack']) {
      expect(TERA_BANK[k].ar.length).toBeGreaterThan(1);
      expect(TERA_BANK[k].en.length).toBeGreaterThan(1);
    }
  });
});

describe('chat log', () => {
  const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; };
  it('round-trips without the undo snapshots, trimmed', () => {
    const st = mem();
    const msgs = Array.from({ length: MAX_KEPT + 5 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `m${i}`, undo: i % 2 ? '{"big":1}' : undefined }));
    saveChat(msgs, st);
    expect(st.m[CHAT_KEY]).not.toMatch(/big/);
    const back = loadChat(st);
    expect(back).toHaveLength(MAX_KEPT);
    expect(back[back.length - 1].text).toBe(`m${MAX_KEPT + 4}`);
  });
  it('survives garbage', () => {
    const st = mem();
    st.setItem(CHAT_KEY, '{nope');
    expect(loadChat(st)).toEqual([]);
  });
});

describe('pop-up batch (Claude writes them in advance)', () => {
  it('parses the batch, keeps only known appointment keys, and rejects junk', () => {
    const text = 'Sure:\n{"nag": [["one {hours}", "two"], ["three"], []], "appt": {"t:a": "A in {min}", "t:zz": "unknown"}}';
    const b = parsePopupBatch(text, ['t:a', 't:b']);
    expect(b.nag[0]).toEqual(['one {hours}', 'two']);
    expect(b.appt).toEqual({ 't:a': 'A in {min}' });
    expect(parsePopupBatch('no json here', ['t:a'])).toBe(null);
    expect(parsePopupBatch('{"nag": [], "appt": {}}', [])).toBe(null);
  });
  it('the prompt carries tasks and appointments with times, and the system asks for placeholders', () => {
    const p = JSON.parse(popupBatchPrompt({ lang: 'ar', open: [{ title: 'Report' }], appts: [{ key: 't:a', title: 'Dentist', at: new Date(2026, 10, 14, 15, 0).getTime(), kind: 'task' }], now: new Date(2026, 10, 14, 12, 0) }));
    expect(p).toMatchObject({ lang: 'ar', now: '12:00', stillOpenToday: ['Report'], appointments: [{ key: 't:a', startsAt: '15:00' }] });
    expect(POPUP_BATCH_SYSTEM).toMatch(/\{hours\}/);
    expect(POPUP_BATCH_SYSTEM).not.toMatch(/Output only the line/);
  });
  it('the tool system prompt keeps the persona and the no-condescension rules', () => {
    expect(TERA_TOOL_SYSTEM).toMatch(/You are Tera/);
    expect(TERA_TOOL_SYSTEM).toMatch(/through tools/);
    expect(TERA_TOOL_SYSTEM).toMatch(/NEVER/);
  });
});
