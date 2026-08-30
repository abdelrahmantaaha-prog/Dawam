/* ------------------------------------------------------------------ */
/*  Planning assistant — talk to the day, and change it.                */
/*                                                                      */
/*  It reads a compact snapshot of the day (blocks, tasks, backlog,     */
/*  recurring tasks, habits, prayers, overdue, projects, rewards) and   */
/*  answers. It never writes anything itself: it may only PROPOSE       */
/*  changes, which the person approves in the UI. Every proposal is     */
/*  validated here before it can be shown — a malformed or unknown      */
/*  action is dropped, not guessed at.                                  */
/*                                                                      */
/*  The action list below is the whole contract, in one table. The      */
/*  prompt the model reads is GENERATED from it, so a new action is a   */
/*  row here plus a handler in App.jsx — the schema the model is told   */
/*  about and the schema this file enforces cannot drift apart, which   */
/*  is exactly what went wrong when they were two hand-written lists.   */
/* ------------------------------------------------------------------ */
import { BLOCKS, PRAYER_BLOCKS, addDays, bName, blockById, firstJsonObject, fmtISO, fmtTime, mon, parseISO, tx, wdFull } from './core.jsx';

const BLOCK_IDS = BLOCKS.map((b) => b.id);
export const VIEWS = ['now', 'plan', 'calendar', 'projects', 'habits', 'notes', 'overdue', 'focus'];
const THEMES = ['auto', 'light', 'dark'];
const LANGS_OK = ['en', 'ar'];
const TOGGLES = ['time24', 'prayerGate'];
export const WEEKDAY_IDS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/* A repeat with no end date runs for a week. That is the person's own rule,
   and it belongs here rather than in the prompt: a model asked to invent an
   end date will invent a different one every time, and "until when?" is
   exactly the question they said they did not want to be asked. */
export const SERIES_DEFAULT_DAYS = 7;
/* And a ceiling, because "daily until the end of the year" is a sentence
   someone will say, and three hundred tasks is not what they meant. */
export const MAX_SERIES = 60;

/* ------------------------------------------------------------------ */
/*  Field types                                                         */
/* ------------------------------------------------------------------ */
/* Each returns the cleaned value, or null to reject the whole proposal.
   `undefined` is only ever returned for an absent optional field, which is
   how "leave this out" is told apart from "this was wrong". */

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const isHM = (s) => /^\d{1,2}:\d{2}$/.test(String(s)) && Number(String(s).split(':')[0]) < 24 && Number(String(s).split(':')[1]) < 60;

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

const oneOf = (list) => (v) => (list.includes(v) ? v : null);
const idIn = (key) => (v, ctx) => { const s = str(v); return s && (ctx[key] || []).includes(s) ? s : null; };

const TYPES = {
  text: (v) => str(v),
  /* A list of short strings — subtasks. Anything non-string in the array is
     dropped rather than stringified; "[object Object]" is not a step. */
  texts: (v) => {
    if (!Array.isArray(v)) return null;
    const out = v.map((s) => str(typeof s === 'string' ? s : s?.title)).filter(Boolean).slice(0, 12);
    return out.length ? out : null;
  },
  block: oneOf(BLOCK_IDS),
  prayer: oneOf(PRAYER_BLOCKS),
  view: oneOf(VIEWS),
  theme: oneOf(THEMES),
  lang: oneOf(LANGS_OK),
  toggle: oneOf(TOGGLES),
  bool: (v) => (typeof v === 'boolean' ? v : null),
  date: (v, ctx) => validDate(v, ctx.todayISO),
  hm: (v) => (isHM(v) ? String(v).trim() : null),
  /* Optional time that is always emitted, as '' when absent. The task shape
     stores start/end as strings, and a missing key there is a different thing
     from an empty one. */
  hm0: (v) => (v == null || v === '' ? '' : isHM(v) ? String(v).trim() : null),
  minutes: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 ? Math.min(600, Math.round(n)) : null; },
  count: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 ? Math.min(100000, Math.round(n)) : null; },
  /* Progress can be negative — correcting an over-log is a real thing to say. */
  amount: (v) => { const n = Number(v); return Number.isFinite(n) && n !== 0 ? Math.max(-100000, Math.min(100000, Math.round(n * 100) / 100)) : null; },
  /* 1-based, as the snapshot prints them. */
  stepNo: (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 50 ? n : null; },
  /* Days between repeats: 1 daily, 7 weekly, 14 fortnightly, and anything
     else they actually say. */
  seriesStep: (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 90 ? n : null; },
  weekdays: (v) => {
    if (!Array.isArray(v)) return null;
    const out = [...new Set(v.map((d) => String(d || '').slice(0, 3).toLowerCase()))].filter((d) => WEEKDAY_IDS.includes(d));
    return out.length ? out : null;
  },
  /* A board column, by id or by the name printed beside it.
     Columns are per project, so this can only check that the name exists
     SOMEWHERE — which project it belongs to is settled at apply time, from the
     task or project the action already names. That is still a real rail: a
     column nobody has is refused here rather than reaching the board. */
  column: (v, ctx) => {
    const s = str(v);
    if (!s) return null;
    const cols = ctx.columns || [];
    const lower = s.toLowerCase();
    return cols.some((c) => c.id === s || String(c.name).toLowerCase() === lower) ? s : null;
  },
  taskId: idIn('taskIds'),
  poolId: idIn('poolIds'),
  habitId: idIn('habitIds'),
  recurringId: idIn('recurringIds'),
  /* A project by id, or by the name printed next to it.
   *
   * Ids only was the strict-and-wrong choice. Asked to "link it to The Book
   * project", the model answers "project":"The Book" — it is echoing the
   * person's own words, and the name is right there in the snapshot beside the
   * id. Rejecting that dropped the whole proposal *silently*, so the reply
   * said "I've added it under The Book" and nothing appeared. A dropped
   * proposal is invisible by design; that is fine for a hallucinated id and
   * badly wrong for a correct answer in the other allowed spelling.
   *
   * Names only work because projects are few and deliberately named. Task and
   * backlog titles are neither, which is why they stay id-only. */
  projectId: (v, ctx) => {
    const s = str(v);
    if (!s) return null;
    if ((ctx.projectIds || []).includes(s)) return s;
    const hit = (ctx.projects || []).find((p) => String(p.name || '').trim().toLowerCase() === s.toLowerCase());
    return hit ? hit.id : null;
  },
};

/* ------------------------------------------------------------------ */
/*  The action table                                                    */
/* ------------------------------------------------------------------ */
/* `fields` maps a field name to a type name; a trailing "?" makes it
   optional. `doc` is the one line the model is shown about when to use it. */

export const ACTIONS = [
  // --- tasks on a day ---
  { kind: 'add_task', fields: { title: 'text', block: 'block', date: 'date', start: 'hm0?', end: 'hm0?', label: 'text?', project: 'projectId?', steps: 'texts?' }, doc: 'put a new task on a day; "project" links it to a long-term project by id' },
  { kind: 'add_task_series', fields: { title: 'text', block: 'block', from: 'date', until: 'date?', everyDays: 'seriesStep?', weekdays: 'weekdays?', start: 'hm0?', end: 'hm0?', label: 'text?', project: 'projectId?' }, doc: 'repeat one task on a cadence: everyDays 1 = daily, 7 = weekly, or name weekdays instead. Omit "until" and it runs one week', check: (o) => seriesDates(o).length > 0 },
  { kind: 'move_task', fields: { taskId: 'taskId', block: 'block', date: 'date' }, doc: 'move an existing task to another day and/or period' },
  { kind: 'edit_task', fields: { taskId: 'taskId', title: 'text?', start: 'hm0?', end: 'hm0?', label: 'text?' }, doc: 'rename or re-time a task; give only the fields that change', needsOne: ['title', 'start', 'end', 'label'] },
  { kind: 'complete_task', fields: { taskId: 'taskId' }, doc: 'tick a task off' },
  { kind: 'reopen_task', fields: { taskId: 'taskId' }, doc: 'un-tick a task that was marked done by mistake' },
  { kind: 'delete_task', fields: { taskId: 'taskId' }, doc: 'remove a task entirely — prefer task_to_backlog unless they said delete' },
  { kind: 'task_to_backlog', fields: { taskId: 'taskId' }, doc: 'unschedule a task, keeping it in the backlog' },
  { kind: 'add_step', fields: { taskId: 'taskId', title: 'text' }, doc: 'add a subtask to an existing task' },
  { kind: 'complete_step', fields: { taskId: 'taskId', step: 'stepNo' }, doc: 'tick off one subtask by its number in the snapshot' },

  // --- backlog ---
  { kind: 'add_backlog', fields: { title: 'text', steps: 'texts?' }, doc: 'capture something with no day yet' },
  { kind: 'backlog_to_day', fields: { poolId: 'poolId', block: 'block', date: 'date' }, doc: 'schedule a backlog item onto a day' },
  { kind: 'complete_backlog', fields: { poolId: 'poolId' }, doc: 'tick off a backlog item where it stands' },
  { kind: 'delete_backlog', fields: { poolId: 'poolId' }, doc: 'drop a backlog item' },

  // --- recurring task definitions ---
  { kind: 'add_recurring', fields: { title: 'text', block: 'block', start: 'hm0?', end: 'hm0?', label: 'text?' }, doc: 'define a REUSABLE recurring task, placed on days by hand later. To actually put a repeating task on the calendar now, use add_task_series instead' },
  { kind: 'recurring_to_day', fields: { recurringId: 'recurringId', date: 'date', block: 'block?' }, doc: 'place a recurring task on a day' },
  { kind: 'delete_recurring', fields: { recurringId: 'recurringId' }, doc: 'remove a recurring task definition' },

  // --- habits ---
  { kind: 'add_habit', fields: { name: 'text', block: 'block' }, doc: 'start tracking a daily habit in one period' },
  { kind: 'mark_habit', fields: { habitId: 'habitId', date: 'date' }, doc: 'mark a habit kept (or un-mark it) on a date' },
  { kind: 'delete_habit', fields: { habitId: 'habitId' }, doc: 'stop tracking a habit' },
  { kind: 'mark_prayer', fields: { prayer: 'prayer', date: 'date' }, doc: 'mark a prayer prayed (or un-mark it). Only ever when they say they prayed' },

  // --- long-term projects ---
  { kind: 'add_project', fields: { name: 'text', target: 'count?', unit: 'text?', deadline: 'date?', goal: 'text?' }, doc: 'start a long-term project with a numeric target' },
  { kind: 'log_project', fields: { projectId: 'projectId', amount: 'amount', note: 'text?' }, doc: 'log progress against a project' },
  { kind: 'complete_project', fields: { projectId: 'projectId' }, doc: 'mark a project finished' },

  // --- project boards ---
  { kind: 'move_card', fields: { taskId: 'taskId', column: 'column' }, doc: "move a task to a column on its project's board; the Done column ticks it off" },
  { kind: 'open_board', fields: { project: 'projectId' }, doc: "open a project's board" },
  { kind: 'add_column', fields: { project: 'projectId', name: 'text' }, doc: 'add a column to a board' },
  { kind: 'rename_column', fields: { project: 'projectId', column: 'column', name: 'text' }, doc: 'rename a board column' },
  { kind: 'delete_column', fields: { project: 'projectId', column: 'column' }, doc: 'remove a board column; its cards fall back to the first column' },

  // --- points ---
  { kind: 'add_reward', fields: { name: 'text', cost: 'count' }, doc: 'add something points can buy' },

  // --- the day as a whole ---
  { kind: 'slot_day', fields: { date: 'date' }, doc: 'auto-slot a day: give every untimed task a start and end around what is fixed' },
  { kind: 'clear_slots', fields: { date: 'date' }, doc: 'strip the auto-assigned times off a day' },
  { kind: 'start_focus', fields: { taskId: 'taskId', minutes: 'minutes?' }, doc: 'start a focus session on a task now' },
  { kind: 'set_alarm', fields: { at: 'hm', label: 'text?' }, doc: 'set the wake alarm for a time of day' },
  { kind: 'cancel_alarm', fields: {}, doc: 'cancel the wake alarm' },
  { kind: 'overdue_to_today', fields: {}, doc: 'pull everything overdue onto today' },

  // --- moving around, and settings ---
  { kind: 'go_to_date', fields: { date: 'date' }, doc: 'show a particular day' },
  { kind: 'open_view', fields: { view: 'view' }, doc: 'switch to Now, Plan, Overdue or Focus' },
  { kind: 'set_language', fields: { lang: 'lang' }, doc: 'switch the interface language' },
  { kind: 'set_theme', fields: { theme: 'theme' }, doc: 'light, dark, or automatic by sunset' },
  { kind: 'set_option', fields: { option: 'toggle', on: 'bool' }, doc: 'time24 = 24-hour clock; prayerGate = the prayer gate that blocks the app until the prayer is marked' },
];

/* Which days a repeat actually lands on. Pure, so the description a person
   approves and the tasks that get written come from the same arithmetic —
   "×7, Sat 30 Aug -> Fri 5 Sep" is not a guess about what will happen, it is
   the list. */
export function seriesDates(p) {
  const from = parseISO(p.from);
  if (!from || Number.isNaN(from.getTime())) return [];
  const until = p.until ? parseISO(p.until) : addDays(from, SERIES_DEFAULT_DAYS - 1);
  if (!until || Number.isNaN(until.getTime()) || until < from) return [];
  const wanted = Array.isArray(p.weekdays) && p.weekdays.length ? new Set(p.weekdays) : null;
  // Named weekdays are a filter over every day, not a stride — "every Monday
  // and Thursday" is not a fixed number of days apart.
  const step = wanted ? 1 : Math.max(1, Number(p.everyDays) || 1);
  const out = [];
  for (let d = from; d <= until && out.length < MAX_SERIES; d = addDays(d, step)) {
    if (wanted && !wanted.has(WEEKDAY_IDS[d.getDay()])) continue;
    out.push(fmtISO(d));
  }
  return out;
}

const BY_KIND = new Map(ACTIONS.map((a) => [a.kind, a]));

/* The literal JSON line for one action, as the model is shown it. */
const schemaLine = (a) => {
  const parts = Object.entries(a.fields).map(([name, spec]) => {
    const optional = spec.endsWith('?');
    const type = optional ? spec.slice(0, -1) : spec;
    return `"${name}":${type}${optional ? '|null' : ''}`;
  });
  return `- {"kind":"${a.kind}"${parts.length ? `,${parts.join(',')}` : ''},"why":str}  — ${a.doc}`;
};

export const ACTION_SCHEMA = ACTIONS.map(schemaLine).join('\n');

export const MAX_PROPOSALS = 8;

/* ------------------------------------------------------------------ */
/*  The prompt                                                          */
/* ------------------------------------------------------------------ */

export const ASSISTANT_SYSTEM = `You are the planning assistant inside "Rhythm", a daily planner whose day is divided into six periods anchored to Islamic prayer times: fajr, morning, dhuhr, asr, maghrib, isha.

You help the person run their day, and you can change anything in the app on their behalf — every proposal you make is shown to them and applied only if they approve it.

Be concise, concrete and honest — if they are overcommitted, say so plainly. Never moralise about prayer or habits; report what the data says and leave judgement to them.

The person may be speaking rather than typing, so their message can arrive as loose dictated speech with no punctuation, in English, Egyptian Arabic, or a mix. Read the intent, not the grammar. Answer in the language they used.

Reply with ONLY one valid JSON object. No prose outside it, no markdown fences.

{
  "reply": string,              // your answer, plain text, 1-6 short sentences
  "proposals": [ proposal ]     // may be empty; ONLY when a concrete change helps
}

TYPES
  str      a plain string
  int      a whole number
  block    one of: ${BLOCK_IDS.join(', ')}
  prayer   one of: ${PRAYER_BLOCKS.join(', ')}
  date     an absolute calendar date, "YYYY-MM-DD"
  hm       a time of day, "HH:MM", 24-hour
  view     one of: ${VIEWS.join(', ')}
  [str]    an array of plain strings

ACTIONS
${ACTION_SCHEMA}

Rules:
- Use ONLY ids that appear in the snapshot. Never invent an id. If what they
  asked about is not in the snapshot, say so instead of guessing an id.
- TASKS THIS WEEK covers the whole week, not only the day on screen, so a task
  on another day is still yours to act on. Overdue tasks from earlier weeks
  have no ids here: overdue_to_today is the only way to reach them.
- date is absolute and does NOT have to fall inside the week shown: to move
  something to the day after the last day listed, give the next day's date.
  WEEK DAYS in the snapshot gives you each shown day's date.
- "step" in complete_step is the number printed beside that subtask.
- To put a repeating task on the calendar, use add_task_series. Leave "until"
  out unless they named an end — an omitted "until" already means one week,
  and inventing a date they did not give is worse than the default.
- add_recurring only DEFINES a reusable task; it puts nothing on any day.
- Every project has a board. Its columns are listed with the project, and
  "Done" is on every board, cannot be renamed or removed, and means the task
  is ticked off — so move_card to Done and complete_task are the same act.
  Use whichever the person's words fit.
- "project" attaches a task to a long-term project. Give its id or its exact
  name from the PROJECTS list. Whenever the request mentions something that
  appears in PROJECTS, that task MUST carry "project" — saying so in "reply"
  is not the same as setting the field, and a task without it is linked to
  nothing. This applies to add_task and add_task_series alike.
    "put chapter 4 on Monday under The Book"
      -> {"kind":"add_task","title":"Chapter 4","block":"morning",
          "date":"...","project":"The Book","why":"..."}
- "label" is a different thing: a free-text tag, created on demand, for work
  that is not one of their projects.
- "why" is a short phrase (<= 10 words) explaining the change.
- When one request means several changes, propose them all — but never more
  than ${MAX_PROPOSALS} at once, and propose nothing unless it clearly helps. An empty
  "proposals" array is normal and good.
- Destructive actions (delete_task, delete_backlog, delete_habit,
  delete_recurring) are only for when they plainly asked to delete something.
- The person approves each proposal manually, so propose, don't assume.`;

/* ------------------------------------------------------------------ */
/*  The snapshot                                                        */
/* ------------------------------------------------------------------ */
/* Deliberately terse: the model needs facts, not prose. Ids are printed for
   everything an action can name, because an action can only name what it can
   see — anything left out of here is, in practice, out of reach. */

export function buildDaySnapshot({
  dateLabel, dayIdx, dayNames, dayDates, todayISO, shownDate, timings, activeBlock,
  tasks, pool, recurring, habits, prayersDone, overdue, projects, labels,
  rewards, balance, view, alarm, options,
}) {
  const L = [];
  L.push(`TODAY: ${dateLabel}${todayISO ? ` (${todayISO})` : ''}`);
  // Each shown day with its real date. Without the dates the model can only
  // name days inside this week, so "move it to Saturday" on the last day of the
  // week has no way to mean NEXT Saturday.
  L.push(`WEEK DAYS: ${(dayNames || []).map((n, i) => `${n}${dayDates && dayDates[i] ? ` ${dayDates[i]}` : ''}`).join(', ')}`);
  L.push(`NOW IN PERIOD: ${activeBlock}`);
  if (view) L.push(`SCREEN: ${view}`);
  if (timings) L.push(`PRAYER TIMES: ${Object.entries(timings).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  L.push(`PRAYERS DONE TODAY: ${(prayersDone || []).length ? prayersDone.join(', ') : 'none'}`);
  L.push('');
  /* The whole week, not just the day on screen.

     This used to list only the selected day, and the cost was invisible until
     you tried to use it: ask to move tomorrow's dentist appointment and the
     model correctly answered that it could not see any such task — an id it
     cannot see is an id it must not name. Every task in the loaded week is an
     id a proposal may legitimately carry, so every one of them is printed. */
  L.push('TASKS THIS WEEK:');
  if (!tasks || !tasks.length) L.push('  (none)');
  else {
    let lastDate = null;
    for (const t of tasks) {
      if (t.date && t.date !== lastDate) { lastDate = t.date; L.push(`  --- ${t.date}${t.date === shownDate ? ' (the day on screen)' : ''} ---`); }
      L.push(`  id=${t.id} block=${t.block} ${t.time ? `time=${t.time} ` : ''}done=${t.done ? 'yes' : 'no'} title="${t.title}"${t.project ? ` project="${t.project}"` : ''}${t.column ? ` column=${t.column}` : ''}`);
      // Numbered so complete_step can name one without every subtask id
      // having to be spelled out in the snapshot.
      const steps = Array.isArray(t.steps) ? t.steps : [];
      if (steps.length) L.push(`    steps: ${steps.map((s, i) => `${i + 1}.${s.done ? '[x]' : '[ ]'}"${s.title}"`).join(' ')}`);
      else if (t.subtasks) L.push(`    steps: ${t.subtasks}`);
    }
  }
  L.push('');
  L.push('BACKLOG (no fixed day):');
  if (!pool || !pool.length) L.push('  (none)');
  else for (const p of pool.slice(0, 25)) L.push(`  id=${p.id} done=${p.done ? 'yes' : 'no'} title="${p.title}"`);
  L.push('');
  L.push('RECURRING TASKS (definitions, not yet on any day):');
  if (!recurring || !recurring.length) L.push('  (none)');
  else for (const r of recurring.slice(0, 25)) L.push(`  id=${r.id} block=${r.block}${r.time ? ` time=${r.time}` : ''} title="${r.title}"`);
  L.push('');
  L.push('HABITS:');
  if (!habits || !habits.length) L.push('  (none)');
  else for (const h of habits) L.push(`  id=${h.id} "${h.name}" period=${h.block} streak=${h.streak} today=${h.doneToday ? 'kept' : 'not yet'}${h.builtin ? ' (built-in prayer — use mark_prayer, not mark_habit)' : ''}`);
  L.push('');
  L.push(`OVERDUE TASKS: ${overdue && overdue.length ? overdue.map((o) => `"${o.title}" (${o.when})`).join(', ') : 'none'}`);
  L.push('');
  L.push('PROJECTS:');
  if (!projects || !projects.length) L.push('  (none)');
  else for (const p of projects) {
    L.push(`  id=${p.id} "${p.name}" ${p.target ? `${p.done}/${p.target} ${p.unit}` : '(no numeric target)'} ${p.status}${p.perDay ? ` need=${p.perDay}/day` : ''}${p.daysLeft != null ? ` daysLeft=${p.daysLeft}` : ''}`);
    if (p.columns && p.columns.length) L.push(`    board columns: ${p.columns.map((c) => `${c.name}(${c.id})`).join(', ')}`);
  }
  if (rewards && rewards.length) {
    L.push('');
    L.push(`POINTS: balance=${balance == null ? '?' : balance}`);
    for (const r of rewards.slice(0, 15)) L.push(`  id=${r.id} "${r.name}" costs ${r.cost}`);
  } else if (balance != null) {
    L.push('');
    L.push(`POINTS: balance=${balance}, no rewards defined`);
  }
  if (labels && labels.length) L.push(`\nLABELS: ${labels.join(', ')}`);
  if (alarm) L.push(`\nWAKE ALARM: ${alarm}`);
  if (options) L.push(`SETTINGS: language=${options.lang} theme=${options.theme} time24=${options.time24 ? 'on' : 'off'} prayerGate=${options.prayerGate ? 'on' : 'off'}`);
  return L.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Validation — the safety boundary                                    */
/* ------------------------------------------------------------------ */

/* Validate one proposal against the table. Returns the cleaned object or null
   (dropped). An unknown kind, a bad field, a missing required field, or an id
   the snapshot never mentioned all mean the same thing: drop it. */
export function validateProposal(p, ctx = {}) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const action = BY_KIND.get(p.kind);
  if (!action) return null;

  const out = { kind: action.kind };
  for (const [name, spec] of Object.entries(action.fields)) {
    const optional = spec.endsWith('?');
    const fn = TYPES[optional ? spec.slice(0, -1) : spec];
    if (!fn) return null; // a typo in the table is a bug, not a silent pass
    const raw = p[name];
    if (raw == null || raw === '') {
      if (!optional) return null;
      // hm0 is optional but always present in the output: '' is its absence.
      if (spec === 'hm0?') out[name] = '';
      continue;
    }
    const v = fn(raw, ctx);
    if (v == null) return null;
    out[name] = v;
  }
  // "Change nothing" is not a change worth showing anyone.
  if (action.needsOne && !action.needsOne.some((f) => out[f])) return null;
  // A repeat that lands on no days at all is not a proposal, it is a typo.
  if (action.check && !action.check(out)) return null;

  out.why = str(p.why) || '';
  return out;
}

/* Model text → { reply, proposals }. Tolerates fences/preamble; drops anything
   that doesn't validate rather than acting on a guess. */
export function parseAssistantReply(text, ids = {}) {
  const raw = firstJsonObject(String(text || ''));
  if (!raw) return { reply: String(text || '').trim() || '(no reply)', proposals: [] };
  let obj; try { obj = JSON.parse(raw); } catch { return { reply: String(text || '').trim(), proposals: [] }; }
  const reply = typeof obj.reply === 'string' ? obj.reply.trim() : '';
  const list = Array.isArray(obj.proposals) ? obj.proposals : [];
  const proposals = list.map((p) => validateProposal(p, ids)).filter(Boolean).slice(0, MAX_PROPOSALS);
  return { reply: reply || '(no reply)', proposals };
}

/* ------------------------------------------------------------------ */
/*  How a proposal reads to a person                                    */
/* ------------------------------------------------------------------ */
/* Lives here rather than in the view so that adding an action means touching
   one file for the contract and one for the effect. `names` resolves ids to
   the titles only the app knows. */

export function describeProposal(p, names = {}) {
  const bn = (id) => bName(blockById(id));
  // Name the date, not just the weekday: the target may be in another week,
  // and "Saturday" alone would read as the Saturday already on screen.
  const dn = (iso) => { const d = parseISO(iso); return d && !Number.isNaN(d.getTime()) ? `${wdFull(d.getDay())} ${d.getDate()} ${mon(d.getMonth())}` : '?'; };
  const q = (s) => `“${s}”`;
  const T = (id) => q(names.task?.(id) || '?');
  const P = (id) => q(names.pool?.(id) || '?');
  const H = (id) => q(names.habit?.(id) || '?');
  const J = (id) => q(names.project?.(id) || '?');
  const R = (id) => q(names.recurring?.(id) || '?');
  const when = (x) => `${dn(x.date)} · ${bn(x.block)}`;
  const at = (x) => (x.start ? ` · ${fmtTime(x.start)}${x.end ? `–${fmtTime(x.end)}` : ''}` : '');

  switch (p.kind) {
    case 'add_task': return `${tx('Add', 'أضف')} ${q(p.title)} → ${when(p)}${at(p)}${p.project ? ` · ${J(p.project)}` : ''}`;
    case 'add_task_series': {
      const days = seriesDates(p);
      const cadence = p.weekdays && p.weekdays.length
        ? p.weekdays.join('/')
        : (p.everyDays || 1) === 1 ? tx('daily', 'يوميًا')
          : (p.everyDays === 7 ? tx('weekly', 'أسبوعيًا') : `${tx('every', 'كل')} ${p.everyDays} ${tx('days', 'أيام')}`);
      // The count and the real range, because "until" was very likely a
      // default this person never typed.
      const range = days.length ? `${dn(days[0])} → ${dn(days[days.length - 1])}` : '?';
      return `${tx('Add', 'أضف')} ${q(p.title)} ×${days.length} · ${cadence} · ${range} · ${bn(p.block)}${at(p)}${p.project ? ` · ${J(p.project)}` : ''}`;
    }
    case 'move_task': return `${tx('Move', 'انقل')} ${T(p.taskId)} → ${when(p)}`;
    case 'edit_task': {
      const bits = [];
      if (p.title) bits.push(`${tx('rename to', 'غيّر الاسم إلى')} ${q(p.title)}`);
      if (p.start || p.end) bits.push(`${tx('set to', 'اضبط على')} ${fmtTime(p.start || '')}${p.end ? `–${fmtTime(p.end)}` : ''}`);
      if (p.label) bits.push(`${tx('label', 'وسم')} ${q(p.label)}`);
      return `${tx('Edit', 'عدّل')} ${T(p.taskId)}: ${bits.join(tx(', ', '، '))}`;
    }
    case 'complete_task': return `${tx('Mark done', 'علّم كمنجز')}: ${T(p.taskId)}`;
    case 'reopen_task': return `${tx('Reopen', 'أعد فتح')}: ${T(p.taskId)}`;
    case 'delete_task': return `${tx('Delete', 'احذف')}: ${T(p.taskId)}`;
    case 'task_to_backlog': return `${tx('To backlog', 'إلى قائمة الانتظار')}: ${T(p.taskId)}`;
    case 'add_step': return `${tx('Add step', 'أضف خطوة')} ${q(p.title)} → ${T(p.taskId)}`;
    case 'complete_step': return `${tx('Tick step', 'علّم الخطوة')} #${p.step} ${tx('of', 'في')} ${T(p.taskId)}`;

    case 'add_backlog': return `${tx('To backlog', 'إلى قائمة الانتظار')}: ${q(p.title)}`;
    case 'backlog_to_day': return `${tx('Schedule', 'جدولة')} ${P(p.poolId)} → ${when(p)}`;
    case 'complete_backlog': return `${tx('Mark done', 'علّم كمنجز')}: ${P(p.poolId)}`;
    case 'delete_backlog': return `${tx('Delete from backlog', 'احذف من قائمة الانتظار')}: ${P(p.poolId)}`;

    case 'add_recurring': return `${tx('New reusable recurring task', 'مهمة متكررة قابلة لإعادة الاستخدام')} ${q(p.title)} · ${bn(p.block)}${at(p)}`;
    case 'recurring_to_day': return `${tx('Place', 'ضع')} ${R(p.recurringId)} → ${dn(p.date)}${p.block ? ` · ${bn(p.block)}` : ''}`;
    case 'delete_recurring': return `${tx('Delete recurring task', 'احذف المهمة المتكررة')}: ${R(p.recurringId)}`;

    case 'add_habit': return `${tx('Track habit', 'تتبّع عادة')} ${q(p.name)} · ${bn(p.block)}`;
    case 'mark_habit': return `${tx('Mark habit', 'علّم العادة')} ${H(p.habitId)} → ${dn(p.date)}`;
    case 'delete_habit': return `${tx('Stop tracking', 'أوقف تتبّع')}: ${H(p.habitId)}`;
    case 'mark_prayer': return `${tx('Mark prayed', 'علّم الصلاة')}: ${bn(p.prayer)} · ${dn(p.date)}`;

    case 'add_project': return `${tx('New project', 'مشروع جديد')} ${q(p.name)}${p.target ? ` · ${p.target} ${p.unit || ''}`.trimEnd() : ''}`;
    case 'log_project': return `${tx('Log', 'سجّل')} ${p.amount > 0 ? '+' : ''}${p.amount} → ${J(p.projectId)}`;
    case 'complete_project': return `${tx('Complete project', 'أنهِ المشروع')}: ${J(p.projectId)}`;

    case 'move_card': return `${tx('Move', 'انقل')} ${T(p.taskId)} → ${q(p.column)}`;
    case 'open_board': return `${tx('Open the board for', 'افتح لوحة')} ${J(p.project)}`;
    case 'add_column': return `${tx('New column', 'عمود جديد')} ${q(p.name)} → ${J(p.project)}`;
    case 'rename_column': return `${tx('Rename column', 'أعد تسمية العمود')} ${q(p.column)} → ${q(p.name)} · ${J(p.project)}`;
    case 'delete_column': return `${tx('Delete column', 'احذف العمود')} ${q(p.column)} · ${J(p.project)}`;

    case 'add_reward': return `${tx('New reward', 'مكافأة جديدة')} ${q(p.name)} · ${p.cost}`;

    case 'slot_day': return `${tx('Slot the day', 'وزّع اليوم')}: ${dn(p.date)}`;
    case 'clear_slots': return `${tx('Clear slotted times', 'امسح التوزيع')}: ${dn(p.date)}`;
    case 'start_focus': return `${tx('Focus on', 'ركّز على')} ${T(p.taskId)}${p.minutes ? ` · ${p.minutes}${tx('m', 'د')}` : ''}`;
    case 'set_alarm': return `${tx('Wake alarm at', 'منبه الساعة')} ${fmtTime(p.at)}${p.label ? ` — ${p.label}` : ''}`;
    case 'cancel_alarm': return tx('Cancel the wake alarm', 'ألغِ المنبه');
    case 'overdue_to_today': return tx('Move everything overdue to today', 'انقل كل المتأخرات إلى اليوم');

    case 'go_to_date': return `${tx('Go to', 'اذهب إلى')} ${dn(p.date)}`;
    case 'open_view': return `${tx('Open', 'افتح')} ${p.view}`;
    case 'set_language': return `${tx('Switch language to', 'غيّر اللغة إلى')} ${p.lang === 'ar' ? 'العربية' : 'English'}`;
    case 'set_theme': return `${tx('Theme', 'المظهر')}: ${p.theme}`;
    case 'set_option': return `${p.option === 'time24' ? tx('24-hour clock', 'نظام ٢٤ ساعة') : tx('Prayer gate', 'بوابة الصلاة')} → ${p.on ? tx('on', 'مفعّل') : tx('off', 'معطّل')}`;

    default: return p.kind;
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

/* Provider call — mirrors the brain-dump sorter's shapes. */
/* Transport: Gemini primary, Groq fallback — the Loqma playbook.

   One provider dimension fewer is the point. The old provider toggle was a
   trap: enter a Gemini key while the toggle sat on Anthropic (the default)
   and every feature sent the wrong key to the wrong API and died with a 401 —
   "the AI features don't work" with nothing to say why. Now there is exactly
   one primary (Gemini, free tier) and one optional backup (Groq, free tier,
   different infrastructure, so the two rarely fail together).

   The fallback fires ONLY on outage-type failures — unreachable, 429,
   5xx — never on config errors: a 401 means the key is wrong, and hiding
   that behind a fallback would just move the confusion. */
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-120b';

const rateError = () => { const e = new Error('rate'); e.code = 'rate'; return e; };
/* The pool refusing a token is the one failure a person can actually fix, and
   "HTTP 401" tells them nothing about which of the two credentials on the
   Settings page is wrong. Worth knowing: the two providers disagree usefully
   here — a bad Gemini key comes back 400 INVALID_ARGUMENT, while the broker
   answers 401 broker_auth. So a 401 is always the pool, never the key. */
const poolAuthError = () => { const e = new Error('pool auth'); e.code = 'pool_auth'; return e; };

export async function callAssistant({ apiKey, groqKey, broker, system, messages, maxTokens = 1500 }) {
  const post = (url, key, model) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages] }),
  });
  const read = async (res) => { const data = await res.json(); return data.choices?.[0]?.message?.content || ''; };

  const groq = async () => {
    const res = await post(GROQ_URL, groqKey, GROQ_MODEL);
    if (res.status === 429) throw rateError();
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
    return read(res);
  };

  /* The shared key pool speaks the same OpenAI-shaped API, so it is one more
     URL rather than another code path. It is tried first when configured: it
     rotates thirty-seven keys and knows which the other apps have spent. Only
     an outage — network, 5xx, or the worker not being there — sends the call
     back to the keys on this device. A 401 or a 400 means the same thing on
     both, so those are reported rather than retried. */
  if (broker?.url && broker?.token) {
    try {
      const res = await post(`${broker.url}/v1/chat/completions`, broker.token, 'gemini-flash-lite-latest');
      if (res.ok) return read(res);
      // A rejected token is a settings mistake, not an outage. It still falls
      // through to this device's own keys when there are any — but if there
      // are not, it must say what is actually wrong.
      if (res.status === 401 || res.status === 403) throw poolAuthError();
      if (res.status !== 404 && res.status < 500 && res.status !== 429) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (!apiKey && !groqKey) throw e;
    }
    if (!apiKey && !groqKey) throw new Error('pool unavailable');
  }

  if (!apiKey) {
    if (groqKey) return groq(); // Groq-only setup is a fine way to run
    throw new Error('no API key');
  }

  let res;
  try {
    // "-latest" tracks the newest Flash-Lite so model retirements can't
    // silently break this call; the pinned name covers the alias being down.
    res = await post(GEMINI_URL, apiKey, 'gemini-flash-lite-latest');
    if (res.status === 404 || res.status === 400) res = await post(GEMINI_URL, apiKey, 'gemini-2.5-flash-lite');
  } catch (e) {
    if (groqKey) return groq(); // network failure — the definition of an outage
    throw new Error('offline');
  }
  if (res.status === 429 || res.status >= 500) {
    if (groqKey) { try { return await groq(); } catch { /* report Gemini's failure below */ } }
    if (res.status === 429) throw rateError();
    throw new Error(`HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`); // 401/403: config, not outage — no fallback
  return read(res);
}
