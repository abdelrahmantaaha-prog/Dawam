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

/* The next mark for a day, cycling through the three states a day can be in.
   Returns undefined for "clear it", which is what the caller deletes on. */
export function nextMark(current, { hasTiny }) {
  if (!current) return FULL;
  if (current === FULL) return hasTiny ? TINY : undefined;
  return undefined;
}
