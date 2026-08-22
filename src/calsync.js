/* ------------------------------------------------------------------ */
/*  Calendar feeds — where the text comes from, and where it is kept.   */
/*                                                                      */
/*  Parsing lives in calendar.js and is the same everywhere. Fetching    */
/*  is not: a browser cannot read a Google feed directly (no CORS        */
/*  header on it), the desktop shell can read anything, and the          */
/*  deployed site has a server that can be asked to relay. So this file  */
/*  is three transports behind one function, and the app above never     */
/*  learns which one answered.                                          */
/*                                                                      */
/*  Read-only, always. Rhythm never writes to your calendar.             */
/* ------------------------------------------------------------------ */

import { loadKey, saveKey } from './storage.js';
import { parseICS, expandEvents, busyForDay } from './calendar.js';

const FEEDS_KEY = 'planner:calendars';
const cacheKey = (id) => `planner:calcache:${id}`;

/* How much of the calendar is kept: enough back to explain a day that has
   already happened, enough forward for the planner's own window. */
const BACK_DAYS = 14;
const AHEAD_DAYS = 70;
const STALE_MS = 30 * 60 * 1000;

export const uid = () => (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36));

/* Google hands out a "Secret address in iCal format" that some browsers and
   most calendar apps offer as webcal://. It is the same URL over https. */
export function normalizeFeedUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  if (/^webcal:\/\//i.test(u)) u = u.replace(/^webcal:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

export const feedLooksSecret = (url) => /\/private-[^/]+\/basic\.ics$/i.test(String(url || ''));

/* ---------- the feed list (syncs like everything else) ---------- */
export async function loadFeeds() {
  const raw = await loadKey(FEEDS_KEY);
  return Array.isArray(raw) ? raw : [];
}
export async function saveFeeds(feeds) {
  await saveKey(FEEDS_KEY, feeds);
  return feeds;
}
export const newFeed = (url, name = '') => ({
  id: uid(),
  kind: 'ics',
  url: normalizeFeedUrl(url),
  name: name || '',
  enabled: true,
  addedAt: Date.now(),
});

/* ---------- transports ---------- */
const desktopBridge = () => (typeof window !== 'undefined' && window.rhythmFocus && window.rhythmFocus.calendar) || null;

async function fetchViaDesktop(url) {
  const r = await desktopBridge().fetchIcs(url);
  if (!r || !r.ok) throw new Error((r && r.error) || 'fetch-failed');
  return r.text;
}

async function fetchDirect(url) {
  // Worth one try: a self-hosted or Nextcloud feed often does send CORS, and
  // when it does this is the shortest path and needs no server at all.
  const r = await fetch(url, { credentials: 'omit', redirect: 'follow' });
  if (!r.ok) throw new Error(`http-${r.status}`);
  return r.text();
}

async function fetchViaProxy(url, apiBase = '') {
  const r = await fetch(`${apiBase}/api/ics?url=${encodeURIComponent(url)}`, { credentials: 'omit' });
  if (!r.ok) {
    let detail = `http-${r.status}`;
    try { const j = await r.json(); if (j && j.error) detail = j.error; } catch { /* not JSON */ }
    throw new Error(detail);
  }
  return r.text();
}

/* One feed's text, by whatever route this build actually has.

   The order is deliberate: the shell first because it has no CORS problem at
   all, then straight at the source, then the relay. A relayed request is the
   only one that shows a third party the URL, and for a secret feed address
   that URL IS the credential — so it is the last resort, not the first. */
export async function fetchFeedText(url, { apiBase = '' } = {}) {
  const clean = normalizeFeedUrl(url);
  if (!clean) throw new Error('no-url');
  if (desktopBridge()) return fetchViaDesktop(clean);
  try {
    return await fetchDirect(clean);
  } catch (direct) {
    try {
      return await fetchViaProxy(clean, apiBase);
    } catch (proxied) {
      // Report the failure the person can act on. "Failed to fetch" from the
      // direct attempt is almost always CORS, which they cannot fix; the
      // relay's answer says whether the URL or the deployment is the problem.
      const e = new Error(proxied.message || direct.message || 'fetch-failed');
      e.direct = direct.message;
      throw e;
    }
  }
}

/* ---------- cache ----------
   Instances, already expanded, per feed. Device-local by design: it is
   derived from someone else's calendar, it is large, and shipping it through
   the sync document would push a megabyte of other people's meetings between
   devices to save one HTTP request. `shared/model.js` excludes the key. */
export async function readCache(feedId) {
  const c = await loadKey(cacheKey(feedId));
  return c && Array.isArray(c.instances) ? c : null;
}

export function windowMs(now = Date.now()) {
  const d = new Date(now);
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - BACK_DAYS).getTime();
  const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + AHEAD_DAYS).getTime();
  return [from, to];
}

export async function refreshFeed(feed, { apiBase = '', now = Date.now() } = {}) {
  const [from, to] = windowMs(now);
  let entry;

  if (feed.kind === 'google') {
    // Google expands the recurrence itself (singleEvents), exceptions and
    // moved instances included — its own data model knows those better than
    // anything re-deriving them from an RRULE. Only the shell can ask.
    const bridge = desktopBridge();
    if (!bridge) throw new Error('google-needs-desktop');
    const r = await bridge.listEvents(feed.calendarId, from, to);
    if (!r || !r.ok) throw new Error((r && r.error) || 'fetch-failed');
    entry = { fetchedAt: now, calName: feed.name || '', from, to, instances: r.instances };
  } else {
    const text = await fetchFeedText(feed.url, { apiBase });
    const parsed = parseICS(text);
    entry = { fetchedAt: now, calName: parsed.calName || '', from, to, instances: expandEvents(parsed, from, to) };
  }

  await saveKey(cacheKey(feed.id), entry);
  return entry;
}

/* Refresh whatever is stale, and never let one broken feed stop the others.
   Returns a per-feed report, because a calendar that silently stopped
   updating is worse than one that says it failed. */
export async function refreshAll(feeds, { apiBase = '', force = false, now = Date.now() } = {}) {
  const out = [];
  for (const feed of feeds) {
    if (!feed.enabled) { out.push({ id: feed.id, skipped: 'disabled' }); continue; }
    const cached = await readCache(feed.id);
    if (!force && cached && now - cached.fetchedAt < STALE_MS && cached.to > now) {
      out.push({ id: feed.id, skipped: 'fresh', count: cached.instances.length, calName: cached.calName });
      continue;
    }
    try {
      const entry = await refreshFeed(feed, { apiBase, now });
      out.push({ id: feed.id, ok: true, count: entry.instances.length, calName: entry.calName, fetchedAt: entry.fetchedAt });
    } catch (e) {
      out.push({ id: feed.id, ok: false, error: (e && e.message) || 'fetch-failed' });
    }
  }
  return out;
}

/* ---------- what the planner asks for ---------- */
export async function loadInstances(feeds) {
  const all = [];
  for (const feed of feeds) {
    if (!feed.enabled) continue;
    const c = await readCache(feed.id);
    if (!c) continue;
    for (const inst of c.instances) all.push({ ...inst, feedId: feed.id });
  }
  all.sort((a, b) => a.startMs - b.startMs);
  return all;
}

/* The busy intervals of one day, ready for structureDay: minutes from that
   day's midnight, an end past 1440 when an event runs into tomorrow. */
export function busyOn(instances, date, opts = {}) {
  return busyForDay(instances, date, opts);
}

/* Everything on one day, for showing rather than for slotting — all-day
   events included, since a person does want to SEE that it is a holiday even
   though it does not block a single hour. */
export function eventsOn(instances, date) {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayEnd = dayStart + 86400000;
  return instances
    .filter((e) => e.endMs > dayStart && e.startMs < dayEnd)
    .sort((a, b) => (a.allDay === b.allDay ? a.startMs - b.startMs : a.allDay ? -1 : 1));
}

export async function dropCache(feedId) {
  await saveKey(cacheKey(feedId), { fetchedAt: 0, instances: [] });
}
