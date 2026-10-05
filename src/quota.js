/* ------------------------------------------------------------------ */
/*  A project with a number on it, read as today's share of it.        */
/*                                                                     */
/*  "Finish the book by March" is not something a person can do today.  */
/*  "Eleven pages, this morning" is. A project that carries a target,   */
/*  a deadline and the days you actually work on it can say the second  */
/*  sentence, and that is the whole feature: a project becomes a habit  */
/*  with an end date, appearing in Plan and in Now on its own days at   */
/*  its own hour, and going quiet the moment the day's share is logged. */
/*                                                                     */
/*  The pace divides by WORK days, not calendar days.                   */
/*                                                                     */
/*  This is the part that has to be right. A hundred pages in ten days  */
/*  is ten a day only if you work all ten; someone who writes on        */
/*  Tuesdays and Thursdays has three sittings, not ten, and telling     */
/*  them "ten pages" every Tuesday quietly sets them up to miss by a    */
/*  factor of three. Dividing by the sittings that are actually left is */
/*  the difference between a number that guides and a number that lies. */
/* ------------------------------------------------------------------ */
import { addDays, BLOCKS, fmtISO, minutesOf, parseISO } from './core.jsx';

/* project.plan = { days:[0..6], block:'morning', start:'09:00',
                    sittings:[{ block, start }, …] }
   No `days` means every day — the same "mid-edit is not a silent stop" rule
   the recurrence schedules use.

   `sittings` splits the day's share into chunks — eleven pages as four after
   Fajr, four after Dhuhr and three at Isha, rather than eleven pages some time
   in the morning. One sitting is the old shape, and `block`/`start` are kept
   equal to the first sitting so a build that has never heard of sittings still
   asks at the right hour. */
const blockRank = (id) => { const i = BLOCKS.findIndex((b) => b.id === id); return i < 0 ? 1 : i; };
const sittingOrder = (a, b) => (blockRank(a.block) - blockRank(b.block))
  || ((minutesOf(a.start) ?? -1) - (minutesOf(b.start) ?? -1));
export const sortSittings = (list) => [...list].sort(sittingOrder);

export function normalizePlan(p) {
  const plan = (p && p.plan) || {};
  const days = [...new Set((plan.days || [])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
  // `perDay` is what a project with no deadline falls back to — carried through
  // rather than normalised away, since there is no pace to compute without it.
  const perDay = Number(plan.perDay) > 0 ? Number(plan.perDay) : null;
  const given = Array.isArray(plan.sittings) ? plan.sittings.filter((s) => s && typeof s === 'object') : [];
  const sittings = given.length
    ? sortSittings(given.map((s) => ({ block: BLOCKS.some((b) => b.id === s.block) ? s.block : 'morning', start: s.start || '' })))
    : [{ block: plan.block || 'morning', start: plan.start || '' }];
  return { on: !!plan.on, days, block: sittings[0].block, start: sittings[0].start, perDay, sittings };
}

/* The plan to store after the sittings change: sorted, and with the legacy
   `block`/`start` pointing at the first one. Never empty — removing the last
   sitting is not a way to switch the reminder off; the toggle is. */
export function withSittings(plan, sittings) {
  const list = sortSittings((sittings || []).length ? sittings : [{ block: plan.block || 'morning', start: plan.start || '' }]);
  return { ...plan, sittings: list, block: list[0].block, start: list[0].start };
}

/* A day's share cut into `n` pieces, the larger ones first: 11 in three is
   4, 4, 3. Front-loaded on purpose — the sitting most likely to happen is the
   first one, and a day that runs out early should have done the most. A share
   smaller than the number of sittings leaves the late ones at zero rather than
   inventing fractions of a page. */
export function splitShare(need, n) {
  const k = Math.max(1, Math.floor(Number(n) || 1));
  const total = Math.max(0, Math.ceil(Number(need) || 0));
  const base = Math.floor(total / k);
  const extra = total - base * k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

/* Each sitting with its piece of today's share.
 *
 *   amount   this sitting's piece.
 *   upTo     what the day should have reached by the end of this sitting.
 *   met      whether today's log already covers it.
 *
 * Judged against the running total, not per sitting: four pages written at
 * Fajr toward an eleven-page day cover the first sitting whenever they were
 * typed in, and eight written in one go cover the first two. With no number to
 * divide (no deadline, no rate) there are no pieces — the sittings still say
 * when, and each just reports progress. */
export function sittingsFor(project, quota) {
  const plan = normalizePlan(project);
  const parts = quota && quota.need != null ? splitShare(quota.need, plan.sittings.length) : null;
  let upTo = 0;
  return plan.sittings.map((s, i) => {
    const amount = parts ? parts[i] : null;
    if (parts) upTo += amount;
    return { ...s, index: i, count: plan.sittings.length, amount, upTo: parts ? upTo : null,
      met: parts ? quota.done >= upTo : !!(quota && quota.met) };
  });
}

/* What is owed by now, given which sittings have arrived (the caller knows the
   clock and the period; this file does not). Missed sittings roll forward — a
   share you owe does not stop being owed because its hour went by. Returns
   null when nothing has arrived yet, and the sitting to name otherwise. */
export function owedNow(project, quota, hasArrived) {
  const sits = sittingsFor(project, quota).filter((s) => s.amount == null || s.amount > 0);
  const arrived = sits.filter(hasArrived);
  if (!arrived.length) return null;
  const last = arrived[arrived.length - 1];
  if (last.upTo == null) return { sitting: last, owed: null, sittings: sits };
  return { sitting: last, owed: Math.max(0, last.upTo - quota.done), sittings: sits };
}

/* Does this project ask anything of this date? It has to have a number to
   reach, the reminder has to be switched on, and the date has to be a working
   day inside the project's own window. */
export function worksOn(project, date) {
  if (!project || !(Number(project.target) > 0)) return false;
  const plan = normalizePlan(project);
  if (!plan.on) return false;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  if (plan.days.length && !plan.days.includes(date.getDay())) return false;
  const start = project.startDate ? parseISO(project.startDate) : null;
  const end = project.deadline ? parseISO(project.deadline) : null;
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

/* Working days from `from` through `to` inclusive. Capped rather than looped
   open-ended: a deadline typed as 2126 should cost a few hundred iterations,
   not a few hundred thousand. */
export function workDaysBetween(from, to, days) {
  if (!(from instanceof Date) || !(to instanceof Date)) return 0;
  const a = new Date(from); a.setHours(0, 0, 0, 0);
  const b = new Date(to); b.setHours(0, 0, 0, 0);
  if (b < a) return 0;
  const span = Math.round((b - a) / 86400000) + 1;
  if (span > 3660) return days && days.length ? Math.round((span / 7) * days.length) : span;
  let n = 0;
  for (let i = 0; i < span; i++) {
    const d = addDays(a, i);
    if (!days || !days.length || days.includes(d.getDay())) n++;
  }
  return n;
}

/* How much of a project was logged on one date. */
export const loggedOn = (project, iso) => ((project && project.entries) || [])
  .filter((e) => e.date === iso)
  .reduce((n, e) => n + (Number(e.amount) || 0), 0);

/* Everything a card needs about today.
 *
 *   need   what today asks for, rounded up — a third of a page is a page you
 *          have to open, and rounding down would let the number reach the
 *          deadline while the work does not.
 *   done   what has been logged today.
 *   met    whether the card can go quiet.
 *
 * With no deadline there is no pace to compute, so the project falls back to
 * whatever daily rate it was given (`plan.perDay`) and, failing that, asks for
 * nothing and simply reports progress. */
export function todayQuota(project, date) {
  const iso = fmtISO(date);
  const plan = normalizePlan(project);
  const target = Number(project && project.target) || 0;
  const total = ((project && project.entries) || []).reduce((n, e) => n + (Number(e.amount) || 0), 0);
  const remaining = Math.max(0, target - total);
  const done = loggedOn(project, iso);
  const end = project && project.deadline ? parseISO(project.deadline) : null;
  // The share is fixed by where the day STARTED. Dividing what is left after
  // today's own log moved the goalposts while you worked — eleven pages became
  // ten after the first five — and with the day cut into sittings it reshuffled
  // the pieces under your feet.
  const owedAtStart = Math.max(0, target - (total - done));
  let need = null;
  if (owedAtStart <= 0) need = 0;
  else if (end) {
    const today = new Date(date); today.setHours(0, 0, 0, 0);
    // Today counts as a sitting when it is one — otherwise the whole remainder
    // gets divided among the days after it and today is told to do nothing.
    const sittings = Math.max(1, workDaysBetween(today, end, plan.days));
    need = Math.ceil(owedAtStart / sittings);
  } else if (Number(plan.perDay) > 0) need = Math.ceil(Number(plan.perDay));
  const met = need == null ? false : done >= need;
  return { iso, need, done, met, remaining, total, target, unit: (project && project.unit) || '' };
}

/* On pace or not, as one verdict the Plan and Now pages and the project card
 * can all say the same way.
 *
 *   key     'done' | 'ahead' | 'on' | 'behind' | 'far' | 'waiting' | 'unknown'
 *   gap     how far from where you should be today, in the project's unit —
 *           positive is ahead, negative is behind. null when there is no line
 *           to be measured against.
 *
 * 'far' is behind by more than an eighth of the whole target — the same
 * threshold the project card has always drawn in red. 'unknown' means there
 * is nothing to be on pace WITH: no numeric target, or no start and deadline.
 * `pace` is projectPace(p) from core.jsx, passed in so this file stays free of
 * the date-of-today it reads. */
export function paceStatus(project, pace) {
  const target = Number(project && project.target) || 0;
  if (project && project.completedAt) return { key: 'done', gap: null };
  if (!(target > 0) || !pace) return { key: 'unknown', gap: null };
  if (pace.remaining <= 0) return { key: 'done', gap: null };
  if (pace.notStarted) return { key: 'waiting', gap: null };
  if (pace.onPace == null || pace.expected == null) return { key: 'unknown', gap: null };
  const gap = pace.done - pace.expected;
  if (pace.onPace) return { key: gap >= 1 ? 'ahead' : 'on', gap };
  return { key: -gap / target > 0.12 ? 'far' : 'behind', gap };
}

/* The projects that want a word today, in the order their blocks run. Sorted
   by the caller's block order so the reminders sit where the day does. */
export function dueProjects(projects, date, { blockOrder } = {}) {
  const list = (projects || [])
    .filter((p) => !p.completedAt && worksOn(p, date))
    .map((p) => { const quota = todayQuota(p, date); return { project: p, plan: normalizePlan(p), quota, sittings: sittingsFor(p, quota) }; })
    .filter((x) => x.quota.need == null || x.quota.need > 0 || !x.quota.met);
  if (blockOrder) list.sort((a, b) => blockOrder(a.plan.block) - blockOrder(b.plan.block));
  return list;
}
