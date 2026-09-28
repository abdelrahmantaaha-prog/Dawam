/* ------------------------------------------------------------------ */
/*  The time lock.                                                     */
/*                                                                     */
/*  A task with both a start and an end has been given its time. Two   */
/*  rules follow from that, and they are the same rule seen from each  */
/*  side:                                                              */
/*                                                                     */
/*    when its time comes, Rhythm is covered until you are focusing on */
/*      it. Not ticking it, not looking at it — a round on that task,  */
/*      running. Ending the round early brings the cover back for as   */
/*      long as the window is still open.                              */
/*                                                                     */
/*    outside its time, no round can be started on it. Working on the  */
/*      nine o'clock task at eleven is how the eleven o'clock one gets */
/*      eaten, so the app refuses rather than helps.                   */
/*                                                                     */
/*  While a window is open the second rule widens: the task whose time */
/*  it is, is the only thing a round can be started on — not a habit,  */
/*  not an untimed task, not a meeting.                                */
/*                                                                     */
/*  Tasks without a window (untimed, or a start with no end) have no   */
/*  allocated time to be outside of, so they are free whenever nothing */
/*  timed is running.                                                  */
/* ------------------------------------------------------------------ */

import { tStartMin, tEndMin, inWindow } from './core.jsx';

export const timeLockOn = (settings) => !(settings && settings.timeLock === false);

/* Start and end in minutes, or null when the task was not given a window. */
export function taskWindow(t) {
  if (!t || typeof t !== 'object') return null;
  const st = tStartMin(t), en = tEndMin(t);
  return st != null && en != null ? { st, en } : null;
}

/* The tasks whose time is now: today's, unfinished, clock inside the window. */
export function liveTasks(todayTasks, curMin) {
  return (todayTasks || []).filter((t) => {
    if (!t || t.done) return false;
    const w = taskWindow(t);
    return !!w && inWindow(w.st, w.en, curMin);
  });
}

/* May a round be started on `task` right now?
 *
 *   task      what the round would be for ({ id, start/end/time... }).
 *   isToday   whether the task is planned for today.
 *   live      liveTasks() for right now.
 *   curMin    minutes since midnight.
 *
 * Returns { ok: true } or { ok: false, reason, task } where reason is
 *   'live'     another task's time is now (`task` is that task);
 *   'outside'  this task has a window and it is not open now. */
export function focusVerdict({ settings, task, isToday, live, curMin }) {
  if (!timeLockOn(settings)) return { ok: true };
  const id = task && task.id;
  const now = live || [];
  if (now.length) {
    const mine = now.find((t) => t.id === id);
    return mine ? { ok: true } : { ok: false, reason: 'live', task: now[0] };
  }
  const w = taskWindow(task);
  if (!w) return { ok: true };
  if (isToday && inWindow(w.st, w.en, curMin)) return { ok: true };
  return { ok: false, reason: 'outside', task };
}

/* Should the app be covered? Yes while any task's time is now and the round
   in progress (if any) is not on one of them. `roundTaskIds` are the ids of
   whatever rounds are running — the web countdown and the desktop session. */
export function timeLockDue({ settings, live, roundTaskIds }) {
  if (!timeLockOn(settings)) return false;
  if (!live || !live.length) return false;
  const ids = new Set((roundTaskIds || []).filter(Boolean));
  return !live.some((t) => ids.has(t.id));
}
