/* The points ledger.

   Every point that appears or disappears is an entry. Nothing anywhere
   stores a balance — the balance is the sum of the ledger, always. That is
   deliberate: half the value of a reward system is being able to look back
   and see that you actually cashed in, and a bare number can't show you
   that. It also means a bug can never silently mint points; it can only
   write an entry you can see and delete.

   ONE DAY PER KEY. `planner:points:2026-08-13` rather than one big document,
   because sync merges per key by last-write-wins: with a single document,
   earning on your phone while your laptop is open loses one of them
   outright. Per-day keys shrink that window to two devices earning on the
   same day, which is the same exposure every week document already has.

   IDEMPOTENT BY `ref`. Ticking a task, unticking it and ticking it again
   must not pay twice, so every entry carries a ref that names its source
   (`task:<id>`, `sub:<taskId>:<subId>`, `habit:<habitId>:<iso>`) and an
   award for a ref that is already present is dropped. Unticking removes the
   entry rather than writing a negative one — an untick means "that didn't
   happen", and the ledger should read as though it never did. Spends are
   the exception: those are real events and stay. */

import { rawList, loadKey, saveKey, rawDelete } from './storage.js';

const PREFIX = 'planner:points:';
const dayKey = (iso) => `${PREFIX}${iso}`;

/* Read the whole ledger, newest last. Small enough to hold in memory: a busy
   year is a few thousand entries of about eighty bytes. */
export async function readLedger() {
  const keys = (await rawList(PREFIX)) || [];
  const out = [];
  for (const k of keys.slice().sort()) {
    const doc = await loadKey(k);
    for (const e of (doc && doc.entries) || []) out.push({ ...e, day: k.slice(PREFIX.length) });
  }
  return out.sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

export const balanceOf = (entries) => (entries || []).reduce((n, e) => n + (Number(e.amount) || 0), 0);

/* Add an entry to `iso`'s page. Returns the entry, or null when `ref` has
   already been paid (anywhere in the ledger — a task ticked yesterday and
   re-ticked today must not pay twice). */
export async function award(ledger, { iso, ref, kind, amount, title, meta }) {
  const n = Math.round(Number(amount) || 0);
  if (!n || !ref) return null;
  if ((ledger || []).some((e) => e.ref === ref)) return null;
  const entry = { ref, kind, amount: n, title: title || '', ts: Date.now(), ...(meta ? { meta } : {}) };
  const key = dayKey(iso);
  const doc = (await loadKey(key)) || { entries: [] };
  await saveKey(key, { ...doc, entries: [...(doc.entries || []), entry] });
  return { ...entry, day: iso };
}

/* Undo an award. Removes every entry with this ref wherever it landed, and
   returns how many points went away so the caller can say so. */
export async function revoke(ledger, ref) {
  const hits = (ledger || []).filter((e) => e.ref === ref);
  if (!hits.length) return 0;
  const days = [...new Set(hits.map((e) => e.day))];
  for (const iso of days) {
    const key = dayKey(iso);
    const doc = await loadKey(key);
    if (!doc) continue;
    const rest = (doc.entries || []).filter((e) => e.ref !== ref);
    // Drop the page entirely when it empties, so an untick doesn't leave a
    // trail of empty documents for sync to carry around forever.
    if (rest.length) await saveKey(key, { ...doc, entries: rest });
    else await rawDelete(key);
  }
  return hits.reduce((n, e) => n + (Number(e.amount) || 0), 0);
}

/* Cashing in. Always allowed to be recorded — refusing to log a spend you
   have already taken would just make the ledger lie. The caller is what
   decides whether the balance covers it. */
export async function spend(iso, { title, cost, rewardId }) {
  const n = Math.round(Number(cost) || 0);
  if (n <= 0) return null;
  const entry = { ref: `spend:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, kind: 'spend', amount: -n, title: title || '', ts: Date.now(), ...(rewardId ? { meta: { rewardId } } : {}) };
  const key = dayKey(iso);
  const doc = (await loadKey(key)) || { entries: [] };
  await saveKey(key, { ...doc, entries: [...(doc.entries || []), entry] });
  return { ...entry, day: iso };
}

/* Remove any single entry by ref — used to correct a mis-logged spend. */
export const forget = (ledger, ref) => revoke(ledger, ref);
