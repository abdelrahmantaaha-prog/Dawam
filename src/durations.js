/* Duration memory — what the person has already told us a task takes.

   One map, keyed by normalized task title: "Email the client" learned once
   is sized right every week after, with no key, no network and no model.
   The stored key is `planner:durations`, so it rides account sync like
   everything else.

   PRECEDENCE IS THE POINT. There are three ways a duration gets learned,
   and they are not equally trustworthy:
     manual — the person typed the times themselves. Ground truth.
     kept   — an auto-slotted task completed without the slot being touched.
              Acceptance by behaviour; good, but softer.
     ai     — a model's guess, cached.
   A weaker source never overwrites a stronger one: once you have said
   "this takes 40 minutes", no amount of model opinion changes it. Saying
   it again — manually — always can. */

import { loadKey, saveKey } from './storage.js';

const KEY = 'planner:durations';
const RANK = { manual: 3, kept: 2, ai: 1 };

/* Title → key. Case, stray whitespace and punctuation at the edges carry no
   intent; "Email the client " and "email the client" are the same task. */
export const normTitle = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

let cache = null; // { [normTitle]: { m, src, at } }

export async function loadDurations() {
  cache = (await loadKey(KEY)) || {};
  return cache;
}

/* Minutes remembered for this title, or null. Synchronous on purpose — it is
   consulted in the middle of slotting, and the map is already in memory. */
export function durationFor(title) {
  const e = cache && cache[normTitle(title)];
  return e && Number.isFinite(e.m) ? e.m : null;
}

/* Learn. Returns true when something was actually written. */
export async function rememberDuration(title, minutes, src = 'manual') {
  const k = normTitle(title);
  const m = Math.round(Number(minutes) || 0);
  if (!k || m < 5 || m > 480) return false; // under 5min or over 8h is noise, not a duration
  if (!cache) await loadDurations();
  const prev = cache[k];
  if (prev && (RANK[prev.src] || 0) > (RANK[src] || 0)) return false; // weaker never overwrites stronger
  if (prev && prev.m === m && prev.src === src) return false;         // nothing new — don't churn sync
  cache = { ...cache, [k]: { m: Math.min(480, m), src, at: Date.now() } };
  await saveKey(KEY, cache);
  return true;
}

export async function forgetDuration(title) {
  const k = normTitle(title);
  if (!cache) await loadDurations();
  if (!cache[k]) return false;
  const next = { ...cache }; delete next[k];
  cache = next;
  await saveKey(KEY, cache);
  return true;
}
