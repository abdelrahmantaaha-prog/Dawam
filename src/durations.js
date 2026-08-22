/* Duration memory — what the person has already told us a task takes.

   One map, keyed by normalized task title: "Email the client" learned once
   is sized right every week after, with no key, no network and no model.
   The stored key is `planner:durations`, so it rides account sync like
   everything else.

   PRECEDENCE IS THE POINT. There are three ways a duration gets learned,
   and they are not equally trustworthy:
     manual — the person typed the times themselves. Ground truth.
     kept   — an auto-slotted task completed without the slot being touched,
              or a focus round that actually ran. Acceptance by behaviour;
              good, but softer.
     ai     — a model's guess, cached.
   A weaker source never overwrites a stronger one: once you have said
   "this takes 40 minutes", no amount of model opinion changes it.

   WITHIN a source, the remembered number is a ROLLING AVERAGE of the recent
   times, not the last one. Last-one-wins made the estimate hostage to a
   single odd afternoon: one Tuesday where the email took ten minutes because
   it was already half written, and every future Tuesday gets ten minutes.
   Averaging the last few says what the task usually costs, which is what a
   slot is for, and it still moves — five sittings from now the odd one has
   aged out entirely.

   What is deliberately NOT averaged in: the clock time a slot was placed at.
   Only its LENGTH is learned. "This takes 40 minutes" travels to next week;
   "you did this at 9:15 last Tuesday" does not, because it was true about
   one Tuesday and not about the task. */

import { loadKey, saveKey } from './storage.js';

const KEY = 'planner:durations';
const RANK = { manual: 3, kept: 2, ai: 1 };
/* How many sittings make an average. Five is enough for one outlier to lose
   its grip and few enough that a task genuinely getting longer is followed
   within a month of weekly work. */
const KEEP = 5;
/* Two identical writes this close together are one event reported twice. */
const DEDUPE_MS = 60 * 1000;

/* Title → key. Case, stray whitespace and punctuation at the edges carry no
   intent; "Email the client " and "email the client" are the same task. */
export const normTitle = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

let cache = null; // { [normTitle]: { m, src, at, samples: [{ m, src, at }] } }

/* Entries written before durations were averaged hold a single number. It is
   a real observation, so it becomes the first sample rather than being
   thrown away — the average simply starts from what was already known. */
function withSamples(e) {
  if (!e || !Number.isFinite(e.m)) return null;
  if (Array.isArray(e.samples) && e.samples.length) return e;
  return { ...e, samples: [{ m: e.m, src: e.src || 'manual', at: e.at || 0 }] };
}

const strongestSrc = (samples) =>
  samples.reduce((best, s) => ((RANK[s.src] || 0) > (RANK[best] || 0) ? s.src : best), null);

/* What the map should report: the average of the recent samples from the
   best source present. Samples from weaker sources stay in the list — they
   are still true, and they matter again if the stronger ones are forgotten —
   but they never dilute a number the person set by hand. */
function effective(samples) {
  const src = strongestSrc(samples);
  const mine = samples.filter((s) => s.src === src).slice(-KEEP);
  if (!mine.length) return null;
  const avg = mine.reduce((n, s) => n + s.m, 0) / mine.length;
  return { m: Math.round(avg), src, at: mine[mine.length - 1].at, n: mine.length };
}

export async function loadDurations() {
  const raw = (await loadKey(KEY)) || {};
  cache = {};
  for (const k of Object.keys(raw)) {
    const e = withSamples(raw[k]);
    if (e) cache[k] = e;
  }
  return cache;
}

/* Minutes remembered for this title, or null. Synchronous on purpose — it is
   consulted in the middle of slotting, and the map is already in memory. */
export function durationFor(title) {
  const e = cache && cache[normTitle(title)];
  return e && Number.isFinite(e.m) ? e.m : null;
}

/* The reasoning behind the number, for anywhere that wants to explain it:
   which source it came from and how many sittings it averages. */
export function durationDetail(title) {
  const e = cache && cache[normTitle(title)];
  if (!e) return null;
  const eff = effective(e.samples || []);
  return eff ? { minutes: eff.m, source: eff.src, sittings: eff.n } : null;
}

/* Learn. Returns true when something was actually written. */
export async function rememberDuration(title, minutes, src = 'manual') {
  const k = normTitle(title);
  const m = Math.round(Number(minutes) || 0);
  if (!k || m < 5 || m > 480) return false; // under 5min or over 8h is noise, not a duration
  if (!RANK[src]) return false;
  if (!cache) await loadDurations();

  const prev = cache[k] || null;
  const prevSamples = (prev && prev.samples) || [];
  const prevBest = strongestSrc(prevSamples);
  if (prevBest && (RANK[prevBest] || 0) > (RANK[src] || 0)) return false; // weaker never overwrites stronger

  /* Two sittings that both took 40 minutes are two pieces of evidence, and
     under an average they must both count — a repeat is no longer a no-op the
     way it was under last-write-wins.

     What still has to be swallowed is the same event arriving twice: finishing
     a task from a focus round records the slot's length and then the measured
     length within the same instant. Same source, same number, seconds apart —
     that is one sitting being written twice, not two sittings. */
  const at = Date.now();
  const lastOfSrc = prevSamples.filter((s) => s.src === src).slice(-1)[0];
  if (lastOfSrc && lastOfSrc.m === m && at - (lastOfSrc.at || 0) < DEDUPE_MS) return false;
  // Trim per source, not across the list: one manual number must not be
  // pushed out of memory by a run of model guesses.
  const kept = [];
  for (const source of Object.keys(RANK)) {
    const mine = prevSamples.filter((s) => s.src === source);
    if (source === src) mine.push({ m, src, at });
    kept.push(...mine.slice(-KEEP));
  }
  kept.sort((a, b) => (a.at || 0) - (b.at || 0));

  const eff = effective(kept);
  if (!eff) return false;
  cache = { ...cache, [k]: { m: eff.m, src: eff.src, at, samples: kept } };
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
