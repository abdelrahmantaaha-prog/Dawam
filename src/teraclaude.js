/* ------------------------------------------------------------------ */
/*  Tera's brain: Claude, through the Anthropic SDK's tool runner.     */
/*                                                                     */
/*  2026-11-14, the owner: "Tera using Gemini is quite stupid… switch  */
/*  her to Claude API and give her 100% control over anything the      */
/*  user can do by hand." So she no longer answers with a JSON blob of */
/*  proposals: she calls tools, sees what each one did, and keeps      */
/*  going until the job is done — the same loop an agent runs.         */
/*                                                                     */
/*  The tools themselves (src/teratools.js) are built by App.jsx from  */
/*  its own handlers, so a tool does exactly what the button does.     */
/*                                                                     */
/*  The key is the person's own Anthropic key, kept on this device    */
/*  (Tera's settings). The shared key pool only holds Gemini and Groq. */
/*  Calling the API from a page needs the SDK's browser opt-in; the    */
/*  key is the owner's, on the owner's device, for the owner's app.    */
/* ------------------------------------------------------------------ */

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', en: 'Claude Opus 5.5 — smartest', ar: 'Claude Opus 5.5 — الأذكى' },
  { id: 'claude-sonnet-5-5', en: 'Claude Sonnet 5.5 — faster, cheaper', ar: 'Claude Sonnet 5.5 — أسرع وأرخص' },
  { id: 'claude-haiku-5-5', en: 'Claude Haiku 5.5 — fastest, cheapest', ar: 'Claude Haiku 5.5 — الأسرع والأرخص' },
];
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const EFFORTS = ['low', 'medium', 'high'];

// The SDK is a few hundred kB; nobody who never opens Tera should download it.
let sdk = null;
async function loadSdk() {
  if (!sdk) {
    const [core, js] = await Promise.all([
      import('@anthropic-ai/sdk'),
      import('@anthropic-ai/sdk/helpers/beta/json-schema.mjs'),
    ]);
    sdk = { Anthropic: core.default, betaTool: js.betaTool };
  }
  return sdk;
}

/* The key lives on THIS device only. Dawam's settings sync to the owner's
   server, and a key that does not need to travel should not. Each device
   gets it pasted once. */
export const KEY_STORE = 'rhythm:tera:claudeKey';
export function loadClaudeKey(storage = globalThis.localStorage) {
  try { return String(storage.getItem(KEY_STORE) || '').trim(); } catch { return ''; }
}
export function saveClaudeKey(key, storage = globalThis.localStorage) {
  try {
    const k = String(key || '').trim();
    if (k) storage.setItem(KEY_STORE, k); else storage.removeItem(KEY_STORE);
    return true;
  } catch { return false; }
}
export const looksLikeClaudeKey = (k) => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(String(k || '').trim());

/* A one-word round trip, for the settings page's "Test" button. */
export async function testClaudeKey({ apiKey, model = DEFAULT_MODEL }) {
  const t = Date.now();
  const text = await teraComplete({ apiKey, model, system: 'Reply with the single word: ok', prompt: 'ping', maxTokens: 400 });
  return { ok: /ok/i.test(text), ms: Date.now() - t };
}

/* Server-side refusal fallbacks: on a safety decline the API re-runs the
   request on another model inside the same call, instead of Tera simply
   going quiet. Haiku has none. */
const fallbackParams = (model) => (model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });

function errorCode(e, Anthropic) {
  if (e instanceof Anthropic.AuthenticationError) return 'auth';
  if (e instanceof Anthropic.PermissionDeniedError) return 'auth';
  if (e instanceof Anthropic.RateLimitError) return 'rate';
  if (e instanceof Anthropic.BadRequestError) return 'bad_request';
  if (e instanceof Anthropic.APIConnectionError) return 'network';
  if (e instanceof Anthropic.APIError) return 'api';
  return 'unknown';
}

/**
 * One turn of conversation, with as many tool calls as the job needs.
 *
 * tools: [{ name, description, schema, run(input) -> string }]
 *   `run` may throw; the message goes back to Claude as an error result and
 *   she can try something else.
 * history: earlier turns as plain text, [{role, content}] — never thinking
 *   or tool blocks, so the API's checks on edited history have nothing to
 *   object to; within this turn the runner keeps every block as it came.
 *
 * Returns { reply, stop, usage, iterations }. Throws an Error with .code on
 * failure ('auth' | 'rate' | 'network' | 'bad_request' | 'api' | 'no_key').
 */
export async function runTeraTurn({ apiKey, model = DEFAULT_MODEL, effort = 'medium', system, history = [], userContent, tools = [], maxIterations = 20, signal, onToolCall, fetch: fetchImpl }) {
  if (!apiKey) { const e = new Error('no Claude key'); e.code = 'no_key'; throw e; }
  const { Anthropic, betaTool } = await loadSdk();
  // `fetch` is for tests only: a scripted stand-in for the API.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 120000, ...(fetchImpl ? { fetch: fetchImpl } : {}) });

  const runnable = tools.map((t) => betaTool({
    name: t.name,
    description: t.description,
    inputSchema: t.schema,
    run: async (input) => {
      onToolCall?.(t.name, input);
      const out = await t.run(input || {});
      return typeof out === 'string' ? out : JSON.stringify(out ?? 'ok');
    },
  }));

  let final;
  try {
    const runner = client.beta.messages.toolRunner({
      model,
      max_tokens: 16000,
      ...fallbackParams(model),
      output_config: { effort },
      cache_control: { type: 'ephemeral' },
      system,
      tools: runnable,
      messages: [...history, { role: 'user', content: userContent }],
      max_iterations: maxIterations,
    }, { signal });
    final = await runner.runUntilDone();
  } catch (e) {
    const err = new Error(e?.message || String(e));
    err.code = errorCode(e, Anthropic);
    throw err;
  }

  const reply = (final.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return { reply, stop: final.stop_reason, usage: final.usage };
}

/**
 * A single short completion with no tools — the lines the phone says when
 * Tera pops up on her own. Low effort: these are one-liners.
 */
export async function teraComplete({ apiKey, model = DEFAULT_MODEL, system, prompt, maxTokens = 2000 }) {
  if (!apiKey) { const e = new Error('no Claude key'); e.code = 'no_key'; throw e; }
  const { Anthropic } = await loadSdk();
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 60000 });
  try {
    const res = await client.beta.messages.create({
      model,
      max_tokens: maxTokens,
      ...fallbackParams(model),
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    if (res.stop_reason === 'refusal') return '';
    return (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  } catch (e) {
    const err = new Error(e?.message || String(e));
    err.code = errorCode(e, Anthropic);
    throw err;
  }
}
