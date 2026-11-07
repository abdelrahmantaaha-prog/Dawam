/* ------------------------------------------------------------------ */
/*  Calendar events -> long-term projects.                             */
/*                                                                     */
/*  The feeds stay read-only. Dawam never writes back to Google or to  */
/*  an .ics, so "this meeting belongs to the book" is Dawam's own      */
/*  private note, kept beside the plan the same way calendar done-marks */
/*  are.                                                                */
/*                                                                     */
/*  Assignment is per SERIES, not per occurrence. A weekly standup      */
/*  belongs to a project as a standing fact, and asking someone to      */
/*  re-file every Monday would make the feature not worth using —       */
/*  which is the opposite of the done-marks next door, where the whole  */
/*  point is that attending Monday says nothing about Wednesday.        */
/*  The two identity schemes differ for that reason, deliberately:      */
/*  calKey pins the occurrence, calSeriesKey pins the series.           */
/* ------------------------------------------------------------------ */
import { loadKey, saveKey } from './storage.js';

const KEY = 'planner:calprojects';

/* uid is unique within a feed but nothing stops two feeds from colliding, so
   the feed rides along. Events with no uid at all (some exporters) fall back
   to their summary, which is what the done-marks do too. */
export const calSeriesKey = (e) => `${(e && e.feedId) || 'f'}|${(e && (e.uid || e.summary)) || 'ev'}`;

export async function loadCalProjects() {
  const doc = await loadKey(KEY);
  return (doc && doc.map) || {};
}

/* One assignment. `projectId` of null clears it. Returns the new map so the
   caller can hold it in state without a re-read. */
export async function setCalProject(map, seriesKey, projectId) {
  const next = { ...(map || {}) };
  if (projectId) next[seriesKey] = projectId;
  else delete next[seriesKey];
  await saveKey(KEY, { map: next });
  return next;
}

/* Assignments naming a project that no longer exists are dead weight, and
   worse, they make "unassigned" look assigned. Called after a project is
   deleted. */
export async function pruneCalProjects(map, projectIds) {
  const live = new Set(projectIds || []);
  const next = {};
  for (const [k, v] of Object.entries(map || {})) if (live.has(v)) next[k] = v;
  if (Object.keys(next).length !== Object.keys(map || {}).length) await saveKey(KEY, { map: next });
  return next;
}

export const projectOfEvent = (map, e) => (map || {})[calSeriesKey(e)] || null;

/* How much time each project actually took, over a range.
 *
 * Clipped to the range so a meeting straddling midnight counts its own half on
 * each side rather than twice. All-day events are skipped: a birthday is a note
 * on the day, not eight hours of project work, and counting it would swamp
 * every real number.  */
export function projectMinutes(instances, map, fromMs, toMs) {
  const out = {};
  for (const e of instances || []) {
    if (e.allDay) continue;
    const pid = projectOfEvent(map, e);
    if (!pid) continue;
    const s = Math.max(e.startMs, fromMs);
    const en = Math.min(e.endMs, toMs);
    if (en <= s) continue;
    out[pid] = (out[pid] || 0) + Math.round((en - s) / 60000);
  }
  return out;
}

/* Every distinct series in a set of instances, newest occurrence first, for a
   "file these" list. One row per series is the whole point — a weekly meeting
   should not appear fifty-two times in a picker. */
export function seriesIn(instances) {
  const byKey = new Map();
  for (const e of instances || []) {
    if (e.allDay) continue;
    const k = calSeriesKey(e);
    const prev = byKey.get(k);
    if (!prev) byKey.set(k, { key: k, summary: e.summary || '', count: 1, lastMs: e.startMs });
    else { prev.count += 1; prev.lastMs = Math.max(prev.lastMs, e.startMs); }
  }
  return [...byKey.values()].sort((a, b) => b.lastMs - a.lastMs);
}
