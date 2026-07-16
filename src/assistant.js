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
- {"kind":"add_task","title":string,"block":blockId,"day":0-6,"start":"HH:MM"|null,"end":"HH:MM"|null,"why":string}
- {"kind":"move_task","taskId":string,"block":blockId,"day":0-6,"why":string}
- {"kind":"complete_task","taskId":string,"why":string}
- {"kind":"task_to_backlog","taskId":string,"why":string}
- {"kind":"backlog_to_day","poolId":string,"block":blockId,"day":0-6,"why":string}

Rules:
- blockId is one of: fajr, morning, dhuhr, asr, maghrib, isha.
- day is the index within the shown week (0=first day of their week).
- Use ONLY ids that appear in the snapshot. Never invent an id.
- "why" is a short phrase (<= 10 words) explaining the change.
- Propose nothing unless it clearly helps. An empty "proposals" array is normal and good.
- Never propose more than 5 changes at once.
- The person approves each proposal manually, so propose, don't assume.`;

/* A compact, token-cheap snapshot. Deliberately terse: the model needs facts,
   not prose. */
export function buildDaySnapshot({ dateLabel, dayIdx, dayNames, timings, activeBlock, tasks, pool, habits, prayersDone, overdue, projects, labels }) {
  const L = [];
  L.push(`TODAY: ${dateLabel} (day index ${dayIdx} of the shown week)`);
  L.push(`WEEK DAYS: ${(dayNames || []).map((n, i) => `${i}=${n}`).join(', ')}`);
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

/* Validate one proposal. Returns the cleaned object or null (dropped). */
export function validateProposal(p, { taskIds = [], poolIds = [] } = {}) {
  if (!p || typeof p !== 'object') return null;
  const why = str(p.why) || '';
  const block = BLOCK_IDS.includes(p.block) ? p.block : null;
  const day = Number.isInteger(p.day) && p.day >= 0 && p.day <= 6 ? p.day : null;
  switch (p.kind) {
    case 'add_task': {
      const title = str(p.title); if (!title || !block || day == null) return null;
      if (!isHM(p.start) || !isHM(p.end)) return null;
      return { kind: 'add_task', title, block, day, start: str(p.start) || '', end: str(p.end) || '', why };
    }
    case 'move_task': {
      const taskId = str(p.taskId); if (!taskId || !taskIds.includes(taskId) || !block || day == null) return null;
      return { kind: 'move_task', taskId, block, day, why };
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
      const poolId = str(p.poolId); if (!poolId || !poolIds.includes(poolId) || !block || day == null) return null;
      return { kind: 'backlog_to_day', poolId, block, day, why };
    }
    default: return null;
  }
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
