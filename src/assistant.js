/* ------------------------------------------------------------------ */
/*  Planning assistant — chat about the day.                            */
/*                                                                      */
/*  It reads a compact snapshot of the day (blocks, tasks, habits,      */
/*  prayers, overdue, projects) and answers. It never writes anything   */
/*  itself: it may only PROPOSE changes, which the person approves one  */
/*  by one in the UI. Every proposal is validated here before it can be */
/*  shown — a malformed or unknown action is dropped, not guessed at.   */
/* ------------------------------------------------------------------ */
import { BLOCKS, firstJsonObject } from './core.jsx';

const BLOCK_IDS = BLOCKS.map((b) => b.id);

export const ASSISTANT_SYSTEM = `You are the planning assistant inside "Rhythm", a daily planner whose day is divided into six periods anchored to Islamic prayer times: fajr, morning, dhuhr, asr, maghrib, isha.

You help the person think about their day: what to prioritise, what to drop, what is slipping. Be concise, concrete and honest — if they are overcommitted, say so plainly. Never moralise about prayer or habits; report what the data says and leave judgement to them.

Reply with ONLY one valid JSON object. No prose outside it, no markdown fences.

Schema:
{
  "reply": string,              // your answer, plain text, 1-6 short sentences
  "proposals": [ proposal ]     // may be empty; ONLY when a concrete change helps
}

proposal types (all fields required unless marked optional):
- {"kind":"add_task","title":string,"block":blockId,"date":"YYYY-MM-DD","start":"HH:MM"|null,"end":"HH:MM"|null,"why":string}
- {"kind":"move_task","taskId":string,"block":blockId,"date":"YYYY-MM-DD","why":string}
- {"kind":"complete_task","taskId":string,"why":string}
- {"kind":"task_to_backlog","taskId":string,"why":string}
- {"kind":"backlog_to_day","poolId":string,"block":blockId,"date":"YYYY-MM-DD","why":string}

Rules:
- blockId is one of: fajr, morning, dhuhr, asr, maghrib, isha.
- date is an absolute calendar date. It does NOT have to fall inside the shown
  week: to move something to the day after the last day listed, give the next
  day's date. WEEK DAYS in the snapshot gives you each shown day's date.
- Use ONLY ids that appear in the snapshot. Never invent an id.
- "why" is a short phrase (<= 10 words) explaining the change.
- Propose nothing unless it clearly helps. An empty "proposals" array is normal and good.
- Never propose more than 5 changes at once.
- The person approves each proposal manually, so propose, don't assume.`;

/* A compact, token-cheap snapshot. Deliberately terse: the model needs facts,
   not prose. */
export function buildDaySnapshot({ dateLabel, dayIdx, dayNames, dayDates, todayISO, timings, activeBlock, tasks, pool, habits, prayersDone, overdue, projects, labels }) {
  const L = [];
  L.push(`TODAY: ${dateLabel}${todayISO ? ` (${todayISO})` : ''}`);
  // Each shown day with its real date. Without the dates the model can only
  // name days inside this week, so "move it to Saturday" on the last day of the
  // week has no way to mean NEXT Saturday.
  L.push(`WEEK DAYS: ${(dayNames || []).map((n, i) => `${n}${dayDates && dayDates[i] ? ` ${dayDates[i]}` : ''}`).join(', ')}`);
  L.push(`NOW IN PERIOD: ${activeBlock}`);
  if (timings) L.push(`PRAYER TIMES: ${Object.entries(timings).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  L.push(`PRAYERS DONE TODAY: ${(prayersDone || []).length ? prayersDone.join(', ') : 'none'}`);
  L.push('');
  L.push('TASKS ON THE SHOWN DAY:');
  if (!tasks || !tasks.length) L.push('  (none)');
  else for (const t of tasks) L.push(`  id=${t.id} block=${t.block} ${t.time ? `time=${t.time} ` : ''}done=${t.done ? 'yes' : 'no'} title="${t.title}"${t.project ? ` project="${t.project}"` : ''}${t.subtasks ? ` steps=${t.subtasks}` : ''}`);
  L.push('');
  L.push('BACKLOG (no fixed day):');
  if (!pool || !pool.length) L.push('  (none)');
  else for (const p of pool.slice(0, 25)) L.push(`  id=${p.id} done=${p.done ? 'yes' : 'no'} title="${p.title}"`);
  L.push('');
  L.push('HABITS:');
  if (!habits || !habits.length) L.push('  (none)');
  else for (const h of habits) L.push(`  "${h.name}" period=${h.block} streak=${h.streak} today=${h.doneToday ? 'kept' : 'not yet'}${h.builtin ? ' (built-in prayer)' : ''}`);
  L.push('');
  L.push(`OVERDUE TASKS: ${overdue && overdue.length ? overdue.map((o) => `"${o.title}" (${o.when})`).join(', ') : 'none'}`);
  L.push('');
  L.push('PROJECTS:');
  if (!projects || !projects.length) L.push('  (none)');
  else for (const p of projects) L.push(`  "${p.name}" ${p.target ? `${p.done}/${p.target} ${p.unit}` : '(no numeric target)'} ${p.status}${p.perDay ? ` need=${p.perDay}/day` : ''}${p.daysLeft != null ? ` daysLeft=${p.daysLeft}` : ''}`);
  if (labels && labels.length) L.push(`\nLABELS: ${labels.join(', ')}`);
  return L.join('\n');
}

const isHM = (s) => s == null || s === '' || /^\d{1,2}:\d{2}$/.test(String(s));
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/* A real calendar date, and a real one — "2026-02-31" parses as March 3rd in
   JavaScript, so the round trip through Date is what actually rejects it.

   Bounded to roughly a year either side of the week on screen. The model has
   no business scheduling something in 2087, and an unbounded date is how a
   hallucinated year silently creates a week document nothing will ever show. */
const DATE_WINDOW_DAYS = 400;
function validDate(v, anchorISO) {
  const s = str(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  if (anchorISO && /^\d{4}-\d{2}-\d{2}$/.test(anchorISO)) {
    const [ay, am, ad] = anchorISO.split('-').map(Number);
    const anchor = new Date(ay, am - 1, ad);
    if (Math.abs(dt - anchor) > DATE_WINDOW_DAYS * 86400000) return null;
  }
  return s;
}

/* Validate one proposal. Returns the cleaned object or null (dropped). */
export function validateProposal(p, { taskIds = [], poolIds = [], todayISO = null } = {}) {
  if (!p || typeof p !== 'object') return null;
  const why = str(p.why) || '';
  const block = BLOCK_IDS.includes(p.block) ? p.block : null;
  const date = validDate(p.date, todayISO);
  switch (p.kind) {
    case 'add_task': {
      const title = str(p.title); if (!title || !block || !date) return null;
      if (!isHM(p.start) || !isHM(p.end)) return null;
      return { kind: 'add_task', title, block, date, start: str(p.start) || '', end: str(p.end) || '', why };
    }
    case 'move_task': {
      const taskId = str(p.taskId); if (!taskId || !taskIds.includes(taskId) || !block || !date) return null;
      return { kind: 'move_task', taskId, block, date, why };
    }
    case 'complete_task': {
      const taskId = str(p.taskId); if (!taskId || !taskIds.includes(taskId)) return null;
      return { kind: 'complete_task', taskId, why };
    }
    case 'task_to_backlog': {
      const taskId = str(p.taskId); if (!taskId || !taskIds.includes(taskId)) return null;
      return { kind: 'task_to_backlog', taskId, why };
    }
    case 'backlog_to_day': {
      const poolId = str(p.poolId); if (!poolId || !poolIds.includes(poolId) || !block || !date) return null;
      return { kind: 'backlog_to_day', poolId, block, date, why };
    }
    default: return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Task sizing — how long would this actually take?                    */
/* ------------------------------------------------------------------ */
/* Used by "Slot the day" when an API key is set. The model sees only the
   task texts, returns minutes per id, and everything it says is clamped
   and validated here — a bad answer degrades to the built-in heuristic,
   it never breaks slotting. */
export const ESTIMATOR_SYSTEM = `You estimate how many MINUTES each personal task will realistically take a normal person, based only on its text. Tasks may be in English or Arabic.

Reply with ONLY a JSON array, no prose, no markdown fences:
[{"id":"<id from input>","minutes":<integer>}]

Rules:
- One entry per input task, same ids. Never invent ids.
- minutes is the realistic working duration: 5 for trivial (a quick text), 15-30 for small (an email, a call), 45-90 for substantial (write a report, deep work), up to 180 for genuinely long single sittings.
- "steps" listed under a task are its subtasks — size the whole task including them.
- When the text is too vague to judge, use 25.`;

/* Model text → Map(id → minutes), or null when nothing validates. Unknown ids
   are dropped, values are clamped to 5..180 — the model advises, this decides. */
export function parseEstimates(text, ids) {
  if (typeof text !== 'string') return null;
  const a = text.indexOf('['), b = text.lastIndexOf(']');
  if (a < 0 || b <= a) return null;
  let arr;
  try { arr = JSON.parse(text.slice(a, b + 1)); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const known = new Set(ids || []);
  const out = new Map();
  for (const e of arr) {
    if (!e || typeof e !== 'object' || !known.has(e.id)) continue;
    const m = Number(e.minutes);
    if (!Number.isFinite(m) || m <= 0) continue;
    out.set(e.id, Math.max(5, Math.min(180, Math.round(m))));
  }
  return out.size ? out : null;
}

/* Model text → { reply, proposals }. Tolerates fences/preamble; drops anything
   that doesn't validate rather than acting on a guess. */
export function parseAssistantReply(text, ids = {}) {
  const raw = firstJsonObject(String(text || ''));
  if (!raw) return { reply: String(text || '').trim() || '(no reply)', proposals: [] };
  let obj; try { obj = JSON.parse(raw); } catch { return { reply: String(text || '').trim(), proposals: [] }; }
  const reply = typeof obj.reply === 'string' ? obj.reply.trim() : '';
  const list = Array.isArray(obj.proposals) ? obj.proposals : [];
  const proposals = list.map((p) => validateProposal(p, ids)).filter(Boolean).slice(0, 5);
  return { reply: reply || '(no reply)', proposals };
}

/* Provider call — mirrors the brain-dump sorter's shapes. */
export async function callAssistant({ provider, apiKey, system, messages }) {
  if (provider === 'gemini') {
    const call = (model) => fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: 'system', content: system }, ...messages] }),
    });
    let res = await call('gemini-flash-lite-latest');
    if (res.status === 404 || res.status === 400) res = await call('gemini-2.5-flash-lite');
    if (res.status === 429) { const e = new Error('rate'); e.code = 'rate'; throw e; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, system, messages }),
  });
  if (res.status === 429) { const e = new Error('rate'); e.code = 'rate'; throw e; }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}
