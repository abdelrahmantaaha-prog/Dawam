/* ------------------------------------------------------------------ */
/*  The fifteen-minute lock.                                           */
/*                                                                     */
/*  Every `everyMin` minutes in which nothing at all was finished, the  */
/*  app stops being an app. Not a nudge, not a banner behind which the  */
/*  planner keeps working: the Now page and one instruction, and no way */
/*  past it except to tick a task or a subtask off.                     */
/*                                                                     */
/*  That is a deliberately unpleasant thing to build, so three rules    */
/*  keep it from becoming a trap:                                       */
/*                                                                     */
/*    it is OFF unless asked for.  A commitment device nobody consented */
/*      to is just a broken app, and it lives behind a switch in        */
/*      Settings with the sentence above next to it.                    */
/*                                                                     */
/*    it never fires with nothing to do.  Locking someone out of an     */
/*      empty day is punishing them for being finished. No unchecked    */
/*      work means no lock, and finishing the day dismisses one that is */
/*      already up.                                                     */
/*                                                                     */
/*    any completion clears it.  A subtask counts. The two-minute       */
/*      version of a habit counts. The bar is "you moved", not "you     */
/*      moved enough" — a lock that demands a big task is a lock that   */
/*      gets solved by force-quitting the app.                          */
/*                                                                     */
/*  The clock runs from the last thing you finished, not from when the  */
/*  app opened, so a productive stretch is never interrupted and a      */
/*  dismissed lock does not come straight back.                         */
/* ------------------------------------------------------------------ */

export const DEFAULT_EVERY_MIN = 15;

const MIN = 60000;

/* Normalise the setting. An interval under a minute would fire on every tick;
   one over four hours has stopped being a commitment device. */
export function lockEvery(settings) {
  const raw = Number(settings && settings.nowLock && settings.nowLock.everyMin);
  const n = Number.isFinite(raw) ? Math.round(raw) : DEFAULT_EVERY_MIN;
  return Math.max(1, Math.min(240, n || DEFAULT_EVERY_MIN));
}

export const lockOn = (settings) => !!(settings && settings.nowLock && settings.nowLock.on);

/* Should the screen be locked at this instant?
 *
 *   since     when the last completion happened (ms), or the session start.
 *   now       the current instant (ms).
 *   pending   how much unfinished work today still holds.
 *
 * Returns a plain boolean rather than a state machine, because the caller
 * already re-renders on a timer and there is nothing here worth remembering
 * between calls that `since` does not already say. */
export function lockDue({ settings, since, now, pending }) {
  if (!lockOn(settings)) return false;
  if (!(pending > 0)) return false;                 // nothing left to demand
  if (!Number.isFinite(since) || !Number.isFinite(now)) return false;
  return now - since >= lockEvery(settings) * MIN;
}

/* How long until the next lock, in whole minutes — for the line in Settings
   that says what the switch is actually doing right now. Null when it is off
   or already due. */
export function minutesToLock({ settings, since, now, pending }) {
  if (!lockOn(settings) || !(pending > 0)) return null;
  if (!Number.isFinite(since) || !Number.isFinite(now)) return null;
  const left = lockEvery(settings) * MIN - (now - since);
  return left <= 0 ? null : Math.ceil(left / MIN);
}
