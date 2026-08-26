/* Done-marks for calendar events.

   The calendar itself stays read-only — Rhythm never writes back to a feed or
   to Google. "Done" is Rhythm's own private mark that you attended the thing,
   so it lives in planner storage, one page per day (the same shape as the
   points ledger, for the same reason: sync merges per key last-write-wins, and
   per-day pages shrink the two-devices-same-window loss to a single day).

   Identity is `uid|startMs`. The uid alone is not enough — a recurring event
   carries one uid across every occurrence, and attending Monday's standup says
   nothing about Wednesday's. startMs pins the occurrence. */

import { loadKey, saveKey, rawList, rawDelete } from './storage.js';
import { markDeleted } from './sync.js';

const PREFIX = 'planner:caldone:';

export const calKey = (e) => `${e.uid || e.summary || 'ev'}|${e.startMs}`;

/* The done map for one day: { "<uid|startMs>": tickedAtMs }. */
export async function loadCalDone(iso) {
  const doc = await loadKey(PREFIX + iso);
  return (doc && doc.done) || {};
}

/* Flip one mark. Returns the new state. An empty page is deleted outright,
   with a tombstone, so an untick on the last meeting of a day doesn't leave a
   husk for sync to carry around forever. */
export async function toggleCalDone(iso, key) {
  const k = PREFIX + iso;
  const doc = (await loadKey(k)) || {};
  const done = { ...(doc.done || {}) };
  const next = !done[key];
  if (next) done[key] = Date.now(); else delete done[key];
  if (Object.keys(done).length) await saveKey(k, { ...doc, done });
  else { await rawDelete(k); markDeleted(k); }
  return next;
}

/* Ageing out, alongside the week pruner: a done-mark for a meeting months gone
   is dead weight on every sync. */
export async function pruneCalDone(beforeDate) {
  for (const k of await rawList(PREFIX)) {
    const d = new Date(k.slice(PREFIX.length) + 'T00:00:00');
    if (!isNaN(d) && d < beforeDate) { await rawDelete(k); markDeleted(k); }
  }
}
