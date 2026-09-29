/* ------------------------------------------------------------------ */
/*  Habits, read the way Atomic Habits argues they should be.          */
/*                                                                     */
/*  A streak alone is a bad scoreboard, and it fails in the exact       */
/*  moment that matters. Miss one day after twenty-nine and it reads    */
/*  zero — the number says "you have nothing", which is both false and  */
/*  the worst possible thing to tell someone deciding whether to        */
/*  bother today. So the streak stays (the chain is genuinely           */
/*  motivating) but it is no longer the only number:                    */
/*                                                                     */
/*    consistency  how many of the last thirty days were kept. Survives */
/*                 a slip, which is the point.                          */
/*    best         the longest chain so far, so a broken streak is a    */
/*                 record rather than a loss.                           */
/*    never miss   the one rule the book leans hardest on: the first    */
/*      twice      miss is an accident, the second is the start of a    */
/*                 new habit. Missing yesterday is the only state this  */
/*                 app has any business making loud.                    */
/*                                                                     */
/*  And the two-minute rule: a habit carries a scaled-down version, and */
/*  keeping THAT still keeps the chain. A day marked tiny is recorded   */
/*  as tiny rather than being quietly rounded up to a full day —        */
/*  showing up is the habit, but the log should not lie about which     */
/*  kind of day it was.                                                 */
/* ------------------------------------------------------------------ */
import { addDays, fmtISO, parseISO } from './core.jsx';

export const FULL = 1;
export const TINY = 2;

export const markOf = (h, iso) => (h && h.log ? h.log[iso] : undefined);
export const doneOn = (h, iso) => !!markOf(h, iso);
export const wasTiny = (h, iso) => markOf(h, iso) === TINY;

/* A habit is only answerable for days it has existed. Counting the weeks
   before it was created as misses would open every new habit at 3%. */
const startOf = (h) => {
  const d = h && h.createdAt ? parseISO(h.createdAt) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/* Kept days out of the last `days`, and the window actually judged. */
export function consistency(h, todayISO, days = 30) {
  const today = parseISO(todayISO);
  if (!today || Number.isNaN(today.getTime())) return { kept: 0, of: 0, pct: 0 };
  const created = startOf(h);
  let kept = 0, of = 0;
  for (let i = 0; i < days; i++) {
    const d = addDays(today, -i);
    if (created && d < created) break;
    of += 1;
    if (doneOn(h, fmtISO(d))) kept += 1;
  }
  return { kept, of, pct: of ? Math.round((kept / of) * 100) : 0 };
}

/* The longest chain the habit has ever had, so breaking today's streak costs
   the chain but not the achievement. */
export function bestStreak(h) {
  const days = Object.keys((h && h.log) || {}).filter((k) => h.log[k]).sort();
  let best = 0, run = 0, prev = null;
  for (const iso of days) {
    const d = parseISO(iso);
    if (!d || Number.isNaN(d.getTime())) continue;
    run = prev && Math.round((d - prev) / 86400000) === 1 ? run + 1 : 1;
    prev = d;
    if (run > best) best = run;
  }
  return best;
}

/* The state worth shouting about.
 *
 *   'safe'     kept today; nothing to say
 *   'open'     not yet today, and yesterday was fine — an ordinary open day
 *   'atRisk'   missed yesterday and not yet today. THE moment: one more miss
 *              and the habit is being replaced rather than broken
 *   'broken'   missed both yesterday and the day before; the chain is already
 *              gone and today is a restart, not a rescue
 *
 * A habit younger than the window it is being judged on cannot be at risk —
 * "you missed yesterday" is nonsense on the day you created it. */
export function riskState(h, todayISO) {
  if (doneOn(h, todayISO)) return 'safe';
  const today = parseISO(todayISO);
  if (!today || Number.isNaN(today.getTime())) return 'open';
  const created = startOf(h);
  const y = addDays(today, -1);
  if (created && y < created) return 'open';
  if (doneOn(h, fmtISO(y))) return 'open';
  const dby = addDays(today, -2);
  if (created && dby < created) return 'atRisk';
  return doneOn(h, fmtISO(dby)) ? 'atRisk' : 'broken';
}

/* Everything a card needs, in one pass. */
export function habitStats(h, todayISO, days = 30) {
  return {
    consistency: consistency(h, todayISO, days),
    best: bestStreak(h),
    risk: riskState(h, todayISO),
    doneToday: doneOn(h, todayISO),
    tinyToday: wasTiny(h, todayISO),
  };
}

/* ------------------------------------------------------------------ */
/*  Habit stacking                                                     */
/* ------------------------------------------------------------------ */
/* "After [CURRENT HABIT], I will [NEW HABIT]." The book's point is that a new
   habit needs an existing one to hang on, and the anchor has to be something
   that already happens without fail — which is why the five prayers are
   offerable as anchors here alongside real habits. They are the one thing in
   this app that genuinely happens every day at a known moment.

   Order matters as much as the label: a stacked habit listed above its own
   anchor is a stack you cannot follow. */

export const isPrayerAnchor = (id) => typeof id === 'string' && id.startsWith('prayer:');

/* Habits ordered so every one follows its anchor.
 *
 * Cycle-safe, and that is not hypothetical: two habits can each be set to
 * follow the other in two taps, and a naive walk would recurse until the stack
 * overflowed. Anything caught in a cycle is emitted in its original position
 * with its anchor ignored rather than dropped — losing a habit off the screen
 * would be far worse than showing it unstacked. */
export function stackOrder(habits) {
  const list = habits || [];
  const byId = new Map(list.map((h) => [h.id, h]));
  const out = [];
  const placed = new Set();
  const visiting = new Set();

  const place = (h) => {
    if (placed.has(h.id)) return;
    if (visiting.has(h.id)) return;      // a cycle: stop, the caller emits it
    visiting.add(h.id);
    const anchor = h.after && !isPrayerAnchor(h.after) ? byId.get(h.after) : null;
    if (anchor) place(anchor);
    visiting.delete(h.id);
    if (!placed.has(h.id)) { placed.add(h.id); out.push(h); }
  };

  for (const h of list) place(h);
  return out;
}

/* True when following this anchor would close a loop — used to keep the
   editor from offering a choice that cannot mean anything. */
export function wouldCycle(habits, id, anchorId) {
  if (!anchorId || isPrayerAnchor(anchorId)) return false;
  if (anchorId === id) return true;
  const byId = new Map((habits || []).map((h) => [h.id, h]));
  const seen = new Set();
  let cur = byId.get(anchorId);
  while (cur && cur.after && !isPrayerAnchor(cur.after)) {
    if (cur.after === id) return true;
    if (seen.has(cur.after)) return false;   // a pre-existing loop, not ours
    seen.add(cur.after);
    cur = byId.get(cur.after);
  }
  return false;
}

/* How a stack should be DRAWN, not just ordered.
 *
 * Each habit gets its depth in the chain and whether anything hangs off it, so
 * a card can show a connector into the one above rather than only saying
 * "After X" in words. A stack you can see is the point of stacking — the
 * sentence alone is just a label. Depth is capped so a pathological chain
 * cannot indent a card off the screen. */
export const MAX_STACK_DEPTH = 3;

export function stackShape(habits) {
  const list = stackOrder(habits);
  const byId = new Map(list.map((h) => [h.id, h]));
  const anchored = new Set();
  for (const h of list) if (h.after && !isPrayerAnchor(h.after) && byId.has(h.after)) anchored.add(h.after);

  const depthOf = (h, seen = new Set()) => {
    if (!h.after || isPrayerAnchor(h.after) || !byId.has(h.after)) return h.after ? 1 : 0;
    if (seen.has(h.id)) return 0;              // a cycle: stop rather than recurse
    seen.add(h.id);
    return Math.min(MAX_STACK_DEPTH, 1 + depthOf(byId.get(h.after), seen));
  };

  return list.map((h) => ({
    habit: h,
    depth: depthOf(h),
    hasAnchor: !!h.after,
    anchorsOthers: anchored.has(h.id),
  }));
}

/* ------------------------------------------------------------------ */
/*  Making the anchor real.                                            */
/*                                                                     */
/*  "After I pray Fajr, I will read ten pages" was, until now, a        */
/*  sentence printed on a card. Both habits sat in the queue at the     */
/*  same time, in whatever order their blocks ran, and the stack was a  */
/*  label on something the app was not actually doing.                  */
/*                                                                     */
/*  So a stacked habit now WAITS. It stays out of the Now queue until   */
/*  its anchor is done that day, and the moment the anchor is ticked it  */
/*  is the very next thing you see. That is the entire mechanism the    */
/*  book describes — the anchor is the cue, and a cue that fires at the  */
/*  wrong time is not a cue.                                            */
/*                                                                     */
/*  Three things it refuses to do, each of which would lose a habit:    */
/*                                                                     */
/*    a missing anchor    (deleted, or from an old backup) means ready. */
/*    a cycle             means ready — two habits set to follow each   */
/*                        other must not both vanish.                   */
/*    a chain             is walked, so a habit three deep waits for     */
/*                        everything above it, not just its parent.      */
/*                                                                     */
/*  `isDone` is supplied by the caller, because only the app knows       */
/*  whether Fajr was prayed today or what a habit's log says.           */
/* ------------------------------------------------------------------ */

/* Is this habit's anchor satisfied?
 *
 * The chain is collected FIRST and judged afterwards, rather than answering
 * "no" the moment one link is undone. Deciding as it walks looks equivalent
 * and is not: a pair of habits pointing at each other would both come back
 * unsatisfied and both disappear off the screen, because the loop is only
 * visible once you have been all the way round it. */
export function anchorReady(h, habits, isDone) {
  if (!h || !h.after) return true;
  const byId = new Map((habits || []).map((x) => [x.id, x]));
  const seen = new Set([h.id]);
  const chain = [];
  let cur = h;
  while (cur && cur.after) {
    if (isPrayerAnchor(cur.after)) { chain.push(cur.after); break; }
    const next = byId.get(cur.after);
    if (!next) break;                       // the anchor is gone; wait for nothing
    if (seen.has(next.id)) return true;     // a cycle; see the note above
    seen.add(next.id);
    chain.push(next.id);
    cur = next;
  }
  return chain.every((id) => !!isDone(id));
}

/* The habits that are actually available now, in stack order, and the ones
   still waiting — the queue takes the first list and a card can explain the
   second instead of it simply not being there. */
export function stackGate(habits, isDone) {
  const ordered = stackOrder(habits);
  const ready = [];
  const waiting = [];
  for (const h of ordered) (anchorReady(h, ordered, isDone) ? ready : waiting).push(h);
  return { ready, waiting };
}

/* What a waiting habit is waiting FOR, as something a card can print. */
export function anchorLabel(h, habits, { prayerName } = {}) {
  if (!h || !h.after) return '';
  if (isPrayerAnchor(h.after)) {
    const id = h.after.slice('prayer:'.length);
    return prayerName ? prayerName(id) : id;
  }
  const anchor = (habits || []).find((x) => x.id === h.after);
  return anchor ? anchor.name : '';
}

/* The next mark for a day, cycling through the three states a day can be in.
   Returns undefined for "clear it", which is what the caller deletes on. */
export function nextMark(current, { hasTiny }) {
  if (!current) return FULL;
  if (current === FULL) return hasTiny ? TINY : undefined;
  return undefined;
}

/* Dragging a habit into a new place. Order is simply where a habit sits in
   the saved list — the Habits page, the Plan timeline and the Now queue all
   read it that way — so a move is a splice. It only ever happens inside one
   day period: a drop on a habit from another period (or on a built-in prayer,
   which is not in the list at all) changes nothing, because moving a habit
   to another period is a decision the editor asks for by name. */
export function moveHabit(habits, id, targetId, after = false) {
  const list = habits || [];
  if (!id || id === targetId) return list;
  const from = list.findIndex((h) => h.id === id);
  const target = list.find((h) => h.id === targetId);
  if (from < 0 || !target) return list;
  const blockOf = (h) => h.block || 'morning';
  if (blockOf(list[from]) !== blockOf(target)) return list;
  const rest = list.filter((h) => h.id !== id);
  const at = rest.findIndex((h) => h.id === targetId) + (after ? 1 : 0);
  return [...rest.slice(0, at), list[from], ...rest.slice(at)];
}

/* Habits among the tasks. A habit happens every day but the tasks around it
   change, so its place in a period is kept as a count — `slot` is how many of
   that period's tasks come before it ("after the second thing this morning").
   With no slot it sits first, which is where habits always used to be.
   Several habits wanting the same spot keep their saved-list order.
   `tasks` is the period's list exactly as shown, finished ones included. */
export function mergeHabits(tasks, habits) {
  const ts = tasks || [];
  const hs = (habits || []).map((h, i) => ({ h, i, at: Math.max(0, Math.min(ts.length, Math.floor(Number(h.slot) || 0))) }))
    .sort((a, b) => (a.at - b.at) || (a.i - b.i));
  const rows = [];
  let hi = 0;
  for (let ti = 0; ti <= ts.length; ti++) {
    while (hi < hs.length && hs[hi].at === ti) rows.push({ kind: 'habit', h: hs[hi++].h });
    if (ti < ts.length) rows.push({ kind: 'task', t: ts[ti] });
  }
  return rows;
}

/* One drag inside a period's merged list: take the dragged row out, put it
   before/after the target row, and read back what that means — the tasks'
   new order, each habit's new slot, and the habits' order among themselves.
   Returns null when nothing sensible can be done (unknown rows). */
export function dropInMerged(rows, drag, target, after = false) {
  const key = (r) => (r.kind === 'habit' ? `h:${r.h.id}` : `t:${r.t.id}`);
  const dk = `${drag.kind === 'habit' ? 'h' : 't'}:${drag.id}`;
  const tk = target ? `${target.kind === 'habit' ? 'h' : 't'}:${target.id}` : null;
  if (dk === tk) return null;
  const moving = drag.row || rows.find((r) => key(r) === dk);
  if (!moving) return null;
  const rest = rows.filter((r) => key(r) !== dk);
  let at = rest.length;
  if (tk) { const i = rest.findIndex((r) => key(r) === tk); if (i < 0) return null; at = i + (after ? 1 : 0); }
  const out = [...rest.slice(0, at), moving, ...rest.slice(at)];
  const taskIds = [];
  const slots = {};
  const habitIds = [];
  for (const r of out) {
    if (r.kind === 'task') taskIds.push(r.t.id);
    else { slots[r.h.id] = taskIds.length; habitIds.push(r.h.id); }
  }
  return { taskIds, slots, habitIds };
}

/* Puts one period's habits in the given order and slots, leaving every other
   habit — and where each period's habits sit in the saved list — alone. */
export function applyHabitOrder(habits, habitIds, slots) {
  const list = habits || [];
  const want = new Set(habitIds);
  const seq = habitIds.map((id) => list.find((h) => h.id === id)).filter(Boolean);
  let k = 0;
  return list.map((h) => {
    if (!want.has(h.id)) return h;
    const next = seq[k++];
    return { ...next, slot: slots[next.id] ?? next.slot };
  });
}
