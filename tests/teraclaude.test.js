import { describe, it, expect } from 'vitest';
import { runTeraTurn, looksLikeClaudeKey, loadClaudeKey, saveClaudeKey, KEY_STORE } from '../src/teraclaude.js';
import { buildTeraTools, TOOL_NAMES, READ_TOOLS, _test } from '../src/teratools.js';

/* A stand-in for api.anthropic.com: answers each request with the next
   scripted message and records what was sent. No network, no key spent. */
function scriptedApi(replies) {
  const sent = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ url: String(url), beta: new Headers(init.headers).get('anthropic-beta') || '', browser: new Headers(init.headers).get('anthropic-dangerous-direct-browser-access'), body });
    const r = replies[Math.min(sent.length - 1, replies.length - 1)];
    const msg = { id: `msg_${sent.length}`, type: 'message', role: 'assistant', model: body.model, stop_reason: r.stop, stop_sequence: null, content: r.content, usage: { input_tokens: 10, output_tokens: 5 } };
    return new Response(JSON.stringify(msg), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, sent };
}

describe('runTeraTurn (the tool loop, against a scripted API)', () => {
  it('runs the tool Claude asks for, sends the result back, and returns the final words', async () => {
    const calls = [];
    const tools = [{ name: 'create_task', description: 'add', schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false }, run: async (i) => { calls.push(i); return { created: { id: 't1', title: i.title } }; } }];
    const api = scriptedApi([
      { stop: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: 'create_task', input: { title: 'Dentist' } }] },
      { stop: 'end_turn', content: [{ type: 'text', text: 'Added the dentist.' }] },
    ]);
    const res = await runTeraTurn({ apiKey: 'sk-ant-test-0000000000000000000000', model: 'claude-opus-5-5', effort: 'low', system: 'sys', history: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'ok' }], userContent: 'add dentist', tools, fetch: api.fetch });
    expect(calls).toEqual([{ title: 'Dentist' }]);
    expect(res.reply).toBe('Added the dentist.');
    expect(api.sent).toHaveLength(2);
    const first = api.sent[0].body;
    expect(first.model).toBe('claude-opus-5-5');
    expect(first.output_config).toEqual({ effort: 'low' });
    expect(first.fallbacks).toBe('default');
    expect(first.tools[0]).toMatchObject({ name: 'create_task', input_schema: { type: 'object' } });
    expect(first.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(api.sent[0].beta).toMatch(/server-side-fallback-2026-07-01/);
    expect(api.sent[0].browser).toBe('true'); // the page talks to the API directly
    expect(api.sent[0].url).toMatch(/api\.anthropic\.com\/v1\/messages/);
    // The second request carries the tool result for tu_1.
    const second = api.sent[1].body.messages;
    const last = second[second.length - 1];
    expect(last.role).toBe('user');
    expect(JSON.stringify(last.content)).toMatch(/tu_1/);
    expect(JSON.stringify(last.content)).toMatch(/Dentist/);
  });

  it('a tool that throws goes back to Claude as an error she can read', async () => {
    const tools = [{ name: 'delete_task', description: 'del', schema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'], additionalProperties: false }, run: async () => { throw new Error('no task with id x'); } }];
    const api = scriptedApi([
      { stop: 'tool_use', content: [{ type: 'tool_use', id: 'tu_9', name: 'delete_task', input: { taskId: 'x' } }] },
      { stop: 'end_turn', content: [{ type: 'text', text: 'Could not find it.' }] },
    ]);
    const res = await runTeraTurn({ apiKey: 'sk-ant-test-0000000000000000000000', system: 's', userContent: 'delete x', tools, fetch: api.fetch });
    expect(res.reply).toBe('Could not find it.');
    const back = JSON.stringify(api.sent[1].body.messages.at(-1).content);
    expect(back).toMatch(/is_error/);
    expect(back).toMatch(/no task with id x/);
  });

  it('Haiku goes without the fallback beta (it has none)', async () => {
    const api = scriptedApi([{ stop: 'end_turn', content: [{ type: 'text', text: 'hi' }] }]);
    await runTeraTurn({ apiKey: 'sk-ant-test-0000000000000000000000', model: 'claude-haiku-5-5', system: 's', userContent: 'hi', fetch: api.fetch });
    expect(api.sent[0].body.fallbacks).toBeUndefined();
  });

  it('no key is an error with a code, before any request', async () => {
    await expect(runTeraTurn({ apiKey: '', system: 's', userContent: 'x' })).rejects.toMatchObject({ code: 'no_key' });
  });
});

describe('the key', () => {
  it('stays in its own device-only slot and is shape-checked', () => {
    const m = {}; const st = { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; }, removeItem: (k) => { delete m[k]; } };
    expect(looksLikeClaudeKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz')).toBe(true);
    expect(looksLikeClaudeKey('AIzaSyNotAClaudeKey')).toBe(false);
    saveClaudeKey('  sk-ant-api03-abcdefghijklmnopqrstuvwxyz ', st);
    expect(m[KEY_STORE]).toBe('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
    expect(KEY_STORE.startsWith('rhythm:')).toBe(true); // never a synced planner: key
    expect(loadClaudeKey(st)).toBe('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
    saveClaudeKey('', st);
    expect(loadClaudeKey(st)).toBe('');
  });
});

describe('the tool catalogue', () => {
  const ops = new Proxy({}, { get: (_, k) => (k === 'change' ? async (meta, fn) => fn() : async (...a) => ({ op: k, a })) });
  const tools = buildTeraTools(ops);

  it('every tool has a unique name, a description and a closed object schema', () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
    expect(TOOL_NAMES.length).toBeGreaterThan(70);
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-z_]{3,64}$/);
      expect(t.description.length).toBeGreaterThan(8);
      expect(t.schema.type).toBe('object');
      expect(t.schema.additionalProperties).toBe(false);
      for (const r of t.schema.required) expect(Object.keys(t.schema.properties)).toContain(r);
    }
  });

  it('covers every area the person can touch', () => {
    for (const n of ['create_task', 'update_task', 'set_task_done', 'tick_step', 'set_steps', 'task_to_backlog', 'update_backlog_item', 'create_recurring', 'set_habit_done', 'set_prayer', 'update_project', 'log_progress', 'move_card', 'reorder_columns', 'cash_in_reward', 'charge_penalty', 'create_note', 'update_note', 'set_meeting_done', 'add_calendar_feed', 'create_label', 'update_settings', 'set_alarm', 'start_focus', 'backup_now']) {
      expect(TOOL_NAMES).toContain(n);
    }
  });

  it('nothing reads or writes keys or the PIN', () => {
    const all = JSON.stringify(tools.map((t) => t.schema));
    expect(all).not.toMatch(/apiKey|groqKey|brokerToken|anthropicKey|"pin"|googleClientSecret|trello.*token/i);
  });

  it('reading tools never go through change()', async () => {
    let changed = 0;
    const ops2 = new Proxy({}, { get: (_, k) => (k === 'change' ? async (m, fn) => { changed++; return fn(); } : async () => 'ok') });
    const t2 = buildTeraTools(ops2);
    for (const n of READ_TOOLS) await t2.find((t) => t.name === n).run({ date: '2026-11-14', from: '2026-11-14', to: '2026-11-15', noteId: 'n', projectId: 'p', text: '' });
    expect(changed).toBe(0);
  });

  it('bad input comes back as a readable error, and dangerous tools need confirm', async () => {
    const get = (n) => tools.find((t) => t.name === n);
    await expect(get('create_task').run({ title: 'x', date: '2026-02-31' })).rejects.toThrow(/real date/);
    await expect(get('update_task').run({ taskId: 'a' })).rejects.toThrow(/nothing to change/);
    await expect(get('reset_points').run({ confirm: false })).rejects.toThrow(/confirm/);
    await expect(get('clear_day').run({ date: '2026-11-14', confirm: false })).rejects.toThrow(/confirm/);
    await expect(get('create_task').run({ title: 'x', date: '2026-11-14', start: '25:00' })).rejects.toThrow(/HH:MM/);
    const ok = JSON.parse(await get('set_task_done').run({ taskId: 'a', done: true }));
    expect(ok).toEqual({ op: 'setTaskDone', a: ['a', true] });
  });

  it('pads single-digit hours and checks real dates', () => {
    expect(_test.padHM('9:30')).toBe('09:30');
    expect(_test.isDate('2026-11-14')).toBe(true);
    expect(_test.isDate('2026-13-01')).toBe(false);
  });
});
