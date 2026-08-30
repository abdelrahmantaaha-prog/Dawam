/* ------------------------------------------------------------------ */
/*  Preparing for a meeting Rhythm cannot change.                      */
/*                                                                     */
/*  A calendar entry stays read-only: Rhythm never writes back to       */
/*  Google or to an .ics. But everything AROUND it is Rhythm's to keep  */
/*  — whether you attended, what it is for, and the page of notes you   */
/*  wrote before walking in.                                            */
/*                                                                     */
/*  Three different lifetimes, so three different homes:                */
/*                                                                     */
/*    which project    per SERIES  (calproj.js)  — a standing fact      */
/*    attended         per DAY     (caldone.js)  — Monday says nothing  */
/*                                                about Wednesday       */
/*    what it is for   per SERIES  (here)        — the standing agenda  */
/*    this one's notes per OCCURRENCE (notebooks) — one meeting's page  */
/*                                                                     */
/*  The short description is per series on purpose. "Weekly sync with   */
/*  the desk — bring the numbers" is true every week, and asking for it */
/*  again each Monday would mean it never gets written at all.          */
/* ------------------------------------------------------------------ */
import { loadKey, saveKey } from './storage.js';
import { calSeriesKey } from './calproj.js';

const KEY = 'planner:calprep';

export async function loadCalPrep() {
  const doc = await loadKey(KEY);
  return (doc && doc.map) || {};
}

/* One description. An empty string clears the entry rather than storing a
   blank, so the map does not fill with keys that mean nothing. */
export async function setCalPrep(map, seriesKey, desc) {
  const next = { ...(map || {}) };
  const clean = String(desc == null ? '' : desc).trim().slice(0, 500);
  if (clean) next[seriesKey] = clean;
  else delete next[seriesKey];
  await saveKey(KEY, { map: next });
  return next;
}

export const prepFor = (map, ev) => (map || {})[calSeriesKey(ev)] || '';

/* The meetings a board should show for its project: assigned to it, within a
   window, soonest first.
 *
 * Past meetings are included only as far back as `backDays`, because a board
 * is a place to work from and last month's standup is not work — but the one
 * you had yesterday, whose notes you are still writing up, is. */
export function meetingsForProject(instances, calProjects, projectId, now = Date.now(), { backDays = 3, forwardDays = 28 } = {}) {
  if (!projectId) return [];
  const from = now - backDays * 86400000;
  const to = now + forwardDays * 86400000;
  return (instances || [])
    .filter((e) => !e.allDay && e.endMs > from && e.startMs < to && (calProjects || {})[calSeriesKey(e)] === projectId)
    .sort((a, b) => a.startMs - b.startMs);
}

/* Has this occurrence already finished? Used to tell "prepare for" from
   "write up", which are different jobs with the same card. */
export const isPast = (ev, now = Date.now()) => !!ev && ev.endMs <= now;
