/* ------------------------------------------------------------------ */
/*  Focus time, tallied by project.                                    */
/*                                                                     */
/*  A task's own focus log (task.focusLog) answers "did this task get   */
/*  its hour today". This answers the other question: where did the     */
/*  week's attention actually go. A round started on a task counts for   */
/*  that task's project (or its tag's — see tagproject.js), and a round  */
/*  started from nothing but a typed title can name a project itself.    */
/*                                                                     */
/*  Stored on the project as minutes per date — `project.focus =        */
/*  { "2026-09-27": 95 }` — rather than on the tasks, for two reasons:   */
/*  weeks are pruned after about a month and the tally must outlive     */
/*  them, and a round with no task still happened. One number per day    */
/*  keeps it small enough to live in settings with everything else.      */
/* ------------------------------------------------------------------ */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/* Add minutes to a project's day. Returns a NEW project, or the same one when
   there is nothing to add, so callers can hand it straight to setState. */
export function addProjectFocus(project, iso, minutes) {
  const n = Math.round(Number(minutes) || 0);
  if (!project || !ISO.test(String(iso || '')) || n <= 0) return project;
  const focus = { ...(project.focus || {}) };
  focus[iso] = (Number(focus[iso]) || 0) + n;
  return { ...project, focus };
}

/* Minutes in [fromISO, toISO], either end open. ISO dates compare as strings. */
export function projectFocusBetween(project, fromISO, toISO) {
  const log = (project && project.focus) || {};
  let n = 0;
  for (const [iso, m] of Object.entries(log)) {
    if (!ISO.test(iso)) continue;
    if (fromISO && iso < fromISO) continue;
    if (toISO && iso > toISO) continue;
    n += Number(m) || 0;
  }
  return Math.round(n);
}

export const projectFocusTotal = (project) => projectFocusBetween(project, null, null);
export const projectFocusOn = (project, iso) => Math.round(Number(((project && project.focus) || {})[iso]) || 0);

/* "2h 05m", "45m", "0m". Hours past a day stay hours — "31h" is clearer than
   "1d 7h" for a tally that only ever grows. */
export function fmtFocus(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${String(r).padStart(2, '0')}m` : `${h}h`;
}

/* Per-project minutes from a list of finished rounds (the desktop's history),
   for the focus page's "today" breakdown. Rounds with no project are summed
   under `null`. */
export function roundsByProject(rounds) {
  const out = new Map();
  for (const r of rounds || []) {
    const key = (r && r.projectId) || null;
    out.set(key, (out.get(key) || 0) + Math.round((Number(r && r.focusedSec) || 0) / 60));
  }
  return out;
}
