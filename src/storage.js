/* ------------------------------------------------------------------ */
/*  Storage — localStorage, wrapped in the same async API the app      */
/*  already speaks (get/set/delete/list). The async shape is kept so   */
/*  the app code and any future backend swap stay unchanged.           */
/* ------------------------------------------------------------------ */

/* THE BUG THIS FILE IS BUILT AROUND, since 2026-09-03: a write that did not
   land must never look like a write that did.

   `rawSet` used to swallow a quota error with a console.error and return
   nothing, so every caller — the whole app, and sync — carried on as if the
   value were saved. Three things followed, and they cost a person their
   tasks on two devices at once:

     1. The task was in React state, so the UI showed it. Storage still held
        the old value, so a reload lost it and an export never contained it.
     2. saveKey ran the save hook anyway, which marked the key DIRTY. The
        device then told the server that the OLD value was its newest edit.
     3. The server took that at its word and handed it to the other device,
        which dutifully replaced its own good copy with the stale one.

   A full store on one device could therefore roll back a healthy one. So:
   every write reports whether it landed, saveKey marks nothing dirty when it
   did not, and the failure latches into a state the UI shows and sync refuses
   to push through. Silence is the one thing this file may not do. */

const memCache = {}; // fallback if localStorage is unavailable (private mode edge cases)

import { SETTINGS_KEY, stampSettings } from '../shared/model.js';

const hasLS = () => {
  try { const k = '__rhythm_probe__'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; }
  catch { return false; }
};
const LS = hasLS();

/* Note this probe proves only that localStorage EXISTS. It writes one byte and
   takes it straight back, which a store sitting at 99.99% of its quota passes
   happily — which is exactly why a boot-time probe was never going to catch
   the failure above. Write health is observed, not predicted. */

let failing = false;      // latched by the first refused write, cleared by the first accepted one
let lastError = null;     // { key, name, message, bytes, at }
const watchers = new Set();

const announce = () => { for (const fn of watchers) { try { fn({ failing, lastError }); } catch { /* a watcher must not break a write */ } } };

/* Subscribe to write health. Returns an unsubscribe. */
export const onStorageHealth = (fn) => { watchers.add(fn); return () => watchers.delete(fn); };
export const writesFailing = () => failing;
export const lastStorageError = () => lastError;

export async function rawGet(key) {
  if (!LS) return key in memCache ? memCache[key] : null;
  const v = localStorage.getItem(key);
  return v == null ? null : v;
}

/* Returns true when the value is actually in the store afterwards. */
export async function rawSet(key, value) {
  if (!LS) { memCache[key] = value; return true; }
  try {
    localStorage.setItem(key, value);
    if (failing) { failing = false; lastError = null; announce(); }
    return true;
  } catch (e) {
    lastError = { key, name: e && e.name, message: String((e && e.message) || e), bytes: String(value || '').length, at: Date.now() };
    if (!failing) { failing = true; announce(); }
    console.error('storage.set refused (quota?)', key, e);
    return false;
  }
}

export async function rawDelete(key) {
  if (!LS) { delete memCache[key]; return true; }
  try { localStorage.removeItem(key); return true; } catch { return false; }
}

export async function rawList(prefix) {
  if (!LS) return Object.keys(memCache).filter((k) => k.startsWith(prefix));
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) out.push(k);
  }
  return out;
}

export const loadKey = async (k) => { const r = await rawGet(k); if (r == null) return null; try { return JSON.parse(r); } catch { return null; } };

// Optional post-save observer (used by sync to mark keys dirty). One subscriber is enough.
let saveHook = null;
export const setSaveHook = (fn) => { saveHook = fn; };

/* The hook runs ONLY on a write that landed. Marking a refused write dirty is
   what let a full device push its stale copy over a healthy one.

   Settings are stamped field by field against what is stored (see
   stampSettings in shared/model.js), and the hook is handed the same clock
   reading so the sync meta and the stamp inside the value agree — that match
   is how a merge knows the stamps can be trusted. */
export const saveKey = async (k, o) => {
  const at = Date.now();
  let value = o;
  if (k === SETTINGS_KEY) {
    let prev = null;
    try { const r = await rawGet(k); prev = r == null ? null : JSON.parse(r); } catch { prev = null; }
    value = stampSettings(prev, o, at);
  }
  const ok = await rawSet(k, JSON.stringify(value));
  if (ok) { try { saveHook && saveHook(k, at); } catch { /* observers must not break saves */ } }
  return ok;
};

export const storageAvailable = () => LS;

/* Re-test write health for real. The failure latch is cleared by the next
   ACCEPTED write, which means that after clearing space the warning would
   otherwise hang around until the person happened to save something — looking
   for all the world like the clearing had not worked. A probe big enough to be
   a fair question (16 KB, the size of a busy week) settles it now, and is
   removed again either way. */
export async function recheckWrites() {
  if (!LS) return false;
  const ok = await rawSet('planner:__probe', 'x'.repeat(8 * 1024));
  await rawDelete('planner:__probe');
  return ok;
}

/* ---------- what is actually in there ----------
   A person who is told "storage is full" needs to be told BY WHAT. Sizes are
   in UTF-16 code units, which is how browsers charge for localStorage. */
export async function storageStats(prefix = '') {
  if (!LS) return { available: false, keys: 0, bytes: 0, top: [] };
  const rows = [];
  let bytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k == null || !k.startsWith(prefix)) continue;
    const v = localStorage.getItem(k) || '';
    const b = (k.length + v.length) * 2;
    bytes += b;
    rows.push({ key: k, bytes: b });
  }
  rows.sort((a, b) => b.bytes - a.bytes);
  return { available: true, keys: rows.length, bytes, top: rows.slice(0, 8) };
}

/* Write until it is refused, to find the ceiling this browser is enforcing.
   Everything written is removed again. Used only by the storage readout —
   there is no other honest way to ask localStorage how much room is left. */
export async function storageHeadroom(maxProbeBytes = 12 * 1024 * 1024) {
  if (!LS) return 0;
  const PROBE = '__rhythm_headroom__';
  const CHUNK = 64 * 1024; // 128 KB of UTF-16 per step
  const blob = 'x'.repeat(CHUNK);
  let held = '';
  try {
    while (held.length * 2 < maxProbeBytes) {
      const next = held + blob;
      try { localStorage.setItem(PROBE, next); } catch { break; }
      held = next;
    }
    return held.length * 2;
  } finally {
    try { localStorage.removeItem(PROBE); } catch { /* nothing else to do */ }
  }
}
