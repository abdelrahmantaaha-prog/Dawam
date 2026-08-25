/* Client half of account sync.

   Shape of the deal: localStorage stays the source of truth for the UI and
   keeps working with no network and no account. Sync is a background
   reconciliation — pull, merge, adopt, push — that never blocks a render and
   never makes you wait to tick something off.

   Sign-in goes through Auth.js's own endpoints with a real form POST rather
   than fetch, because the flow ends in a cross-origin redirect to Google that
   only a top-level navigation can complete.

   THE BUG THIS FILE IS BUILT AROUND: deciding "has anything changed?" with
   JSON.stringify compares key ORDER, which is an artefact of how an object was
   built — the server builds the merged document one way and migrate() rebuilds
   it another. An unchanged document then compares unequal on every round trip,
   so the client pushes, adopts, sees a difference, and pushes again, forever.
   Every comparison here goes through fingerprint(); none use JSON.stringify. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mergeState, fingerprint, sameDoc, migrate, isSyncable, DOC_VERSION } from '../shared/model.js';
import { rawList, rawGet, rawSet, rawDelete } from './storage.js';

/* Where the API lives.

   On the web this is same-origin and empty is right. Inside the Android shell
   the page is served from https://localhost — the WebView's own asset server —
   so a relative "/api/me" never leaves the phone, and sync silently reports
   "no backend" no matter what the deployment has configured. VITE_API_BASE
   points the calls at a real deployment for builds that need it.

   Note this only fixes the data calls. Cookie-based sign-in from a different
   origin is a separate problem (see README → Sync in the APK). */
const BASE = (import.meta.env && import.meta.env.VITE_API_BASE) || '';
export const apiBase = () => BASE;

const API = {
  me: `${BASE}/api/me`,
  sync: `${BASE}/api/sync`,
  csrf: `${BASE}/api/auth/csrf`,
  signIn: `${BASE}/api/auth/signin/google`,
  signOut: `${BASE}/api/auth/signout`,
};

/* ---------- transport ----------
   On the desktop every API call goes through the Electron main process: the
   planner's origin is rhythm://app, so a renderer fetch could never carry the
   deployment's session cookie. The bridge answers with { ok, status, body };
   this wraps it back into a Response-shaped object so the callers cannot tell
   the difference. Everywhere else it is fetch(), with credentials included
   when the API lives on another origin. */
const desktopSync = () => (typeof window !== 'undefined' && window.rhythmFocus && window.rhythmFocus.sync) || null;

async function apiFetch(url, init = {}) {
  const ds = desktopSync();
  if (ds) {
    const path = url.startsWith('/') ? url : new URL(url, 'http://x').pathname + new URL(url, 'http://x').search;
    const r = await ds.request(path, { method: init.method, headers: init.headers, body: init.body });
    if (r.status === 0) throw new Error(r.error || 'network');
    return { ok: r.ok, status: r.status, json: async () => JSON.parse(r.body || 'null'), text: async () => r.body };
  }
  return fetch(url, { credentials: BASE ? 'include' : 'same-origin', ...init });
}

/* Local bookkeeping. `meta` is when this device last wrote each key, and it is
   what gives the merge its timestamps; `tombs` remembers keys deleted here so a
   prune isn't undone by the next pull. */
const META_KEY = 'rhythm:sync:meta';
const TOMB_KEY = 'rhythm:sync:tombs';

const readJSON = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } };

export const syncMeta = () => readJSON(META_KEY, {});
export const setSyncMeta = (m) => writeJSON(META_KEY, m);
const tombs = () => readJSON(TOMB_KEY, {});
const setTombs = (t) => writeJSON(TOMB_KEY, t);

/* Called from the storage save hook on every local write. */
export function markDirty(key, now = Date.now()) {
  if (!isSyncable(key)) return;
  const m = syncMeta(); m[key] = now; setSyncMeta(m);
  const t = tombs(); if (t[key]) { delete t[key]; setTombs(t); } // re-created
}

/* Called when a key is deliberately removed (the week pruner). Without this the
   server hands the pruned week straight back on the next pull and the device
   prunes and re-downloads it forever. */
export function markDeleted(key, now = Date.now()) {
  if (!isSyncable(key)) return;
  const t = tombs(); t[key] = now; setTombs(t);
  const m = syncMeta(); delete m[key]; setSyncMeta(m);
}

/* ---------- local <-> document ---------- */

/* Build the document from whatever is in storage right now. */
export async function readLocalDoc() {
  const doc = { v: DOC_VERSION, keys: {} };
  const m = syncMeta();
  const keys = await rawList('planner:');
  for (const k of keys) {
    if (!isSyncable(k)) continue;
    const value = await rawGet(k);
    if (value == null) continue;
    // A key with no recorded time predates sync bookkeeping (or arrived by
    // import). Stamp it at 1 rather than now, so a remote copy with a real
    // timestamp wins instead of this device silently claiming to be newest.
    doc.keys[k] = { value, updatedAt: m[k] || 1 };
  }
  for (const [k, at] of Object.entries(tombs())) {
    if (isSyncable(k) && !doc.keys[k]) doc.keys[k] = { deletedAt: at };
  }
  return doc;
}

/* Apply a merged document to storage. Returns the keys that actually changed,
   so the caller only re-reads state when something really moved. */
export async function applyDoc(doc, { onKey } = {}) {
  const clean = migrate(doc);
  const m = syncMeta();
  const t = tombs();
  const touched = [];
  for (const [k, e] of Object.entries(clean.keys)) {
    if (e.deletedAt) {
      const existing = await rawGet(k);
      if (existing != null) { await rawDelete(k); touched.push(k); }
      t[k] = e.deletedAt;
      delete m[k];
      continue;
    }
    const local = await rawGet(k);
    if (local === e.value) { m[k] = e.updatedAt; continue; } // already identical
    await rawSet(k, e.value);           // raw write: does NOT re-enter the dirty queue
    m[k] = e.updatedAt;
    delete t[k];
    touched.push(k);
    if (onKey) { try { onKey(k, e.value); } catch (err) { console.warn('apply failed for', k, err); } }
  }
  setSyncMeta(m); setTombs(t);
  return touched;
}

/* ---------- Auth.js handshake ---------- */
async function csrfToken() {
  const r = await apiFetch(API.csrf);
  if (!r.ok) throw new Error('csrf-failed');
  const j = await r.json();
  return j.csrfToken;
}

/* Auth.js expects a form POST carrying its CSRF token; the response is a 302
   to Google, so this has to be a top-level navigation, not fetch. */
async function postForm(action, fields) {
  const token = await csrfToken();
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action;
  form.style.display = 'none';
  const add = (name, value) => {
    const i = document.createElement('input');
    i.type = 'hidden'; i.name = name; i.value = value;
    form.appendChild(i);
  };
  add('csrfToken', token);
  add('callbackUrl', window.location.origin + window.location.pathname);
  Object.entries(fields || {}).forEach(([k, v]) => add(k, v));
  document.body.appendChild(form);
  form.submit();
}

/* On the desktop the OAuth round trip runs in a shell window against the
   deployment itself; a reload afterwards re-probes /api/me and picks the
   session up. On the web it is Auth.js's own form POST. */
export const signIn = async () => {
  const ds = desktopSync();
  if (ds) { await ds.signIn(); window.location.reload(); return; }
  return postForm(API.signIn);
};
export const signOut = async () => {
  const ds = desktopSync();
  if (ds) { await ds.signOut(); window.location.reload(); return; }
  return postForm(API.signOut);
};

/* ---------- transport ---------- */
async function pullDoc() {
  const r = await apiFetch(API.sync, { headers: { Accept: 'application/json' } });
  if (r.status === 401) return { signedOut: true };
  if (!r.ok) throw new Error('pull-' + r.status);
  return r.json();
}

async function pushDoc(doc) {
  const r = await apiFetch(API.sync, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc }),
  });
  if (r.status === 401) return { signedOut: true };
  if (r.status === 413) throw new Error('doc-too-large');
  if (!r.ok) throw new Error('push-' + r.status);
  return r.json();
}

export async function disconnect() {
  const r = await apiFetch(API.sync, { method: 'DELETE' });
  if (!r.ok) throw new Error('disconnect-failed');
  return r.json();
}

/* 4s, not 2.5s. The old value fired while a burst of edits was still going and,
   with the JSON.stringify comparison, turned into a permanent every-few-seconds
   loop. Even with that fixed, a longer debounce keeps a run of taps to one
   round trip. */
const PUSH_DEBOUNCE = 4000;

/* Never sync out from under someone who is mid-edit. Adopting the server's copy
   while a task editor is open makes the app feel like it is fighting you.
   Rhythm's editors and dialogs all sit inside `.overlay`.

   Deliberately NOT `.gate`. The prayer gate and the focus lock also cover the
   screen, but they are locks rather than edit forms: nothing is being typed
   behind them, and the prayer gate in particular can stay up for fifteen
   minutes or more. Treating those as "mid-edit" meant a fresh launch deferred
   its first sync indefinitely — the app looked signed in and idle while never
   syncing at all. */
function userIsEditing() {
  if (typeof document === 'undefined') return false;
  return !!document.querySelector('.overlay');
}

/* status: "unavailable" | "signed-out" | "idle" | "syncing" | "offline" | "error" */
export function useSync({ localVersion, onApplied, loaded }) {
  const [capability, setCapability] = useState({ checked: false, sync: false, auth: false, db: false });
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('unavailable');
  const [lastSync, setLastSync] = useState(null);
  const [error, setError] = useState(null);

  // Fingerprint of the document as the server last confirmed it. Comparing
  // against this is what stops adopt→push→adopt from looping forever.
  const settled = useRef(null);
  const busy = useRef(false);
  const timer = useRef(null);
  const deferred = useRef(false); // a sync was skipped because a dialog was open
  const onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;

  /* one capability probe on boot: does this deployment even have sync? */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const url = new URL(API.me, window.location.href).href;
      try {
        const r = await apiFetch(API.me);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        if (cancelled) return;
        setCapability({ checked: true, sync: !!j.sync, auth: !!j.auth, db: !!j.db, probe: url,
          why: j.sync ? '' : `deployment reports auth=${!!j.auth} db=${!!j.db}` });
        setUser(j.user || null);
        setStatus(!j.sync ? 'unavailable' : j.user ? 'idle' : 'signed-out');
      } catch (e) {
        // Running without a backend is a supported way to use Rhythm, so this
        // is not an error state — but it must not be SILENT either. Reporting
        // the URL that was actually tried is what distinguishes "this build has
        // no backend" from "this build is asking its own WebView for /api".
        if (!cancelled) setCapability({ checked: true, sync: false, auth: false, db: false, probe: url, why: String(e.message || e) });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const reconcile = useCallback(async (reason) => {
    if (!capability.sync || !user || busy.current) return;
    // a manual "Sync now" is an explicit request, so it overrides the guard
    if (reason !== 'manual' && userIsEditing()) { deferred.current = true; return; }

    busy.current = true;
    deferred.current = false;
    setStatus('syncing');
    setError(null);
    try {
      const before = await readLocalDoc();

      // A pull first means a device that has been away adopts remote edits
      // before overwriting anything, even if you never touch it.
      const remote = await pullDoc();
      if (remote.signedOut) { setUser(null); setStatus('signed-out'); return; }

      const merged = remote.doc ? mergeState(remote.doc, before) : before;

      let serverDoc;
      // Push only when the merge actually adds something the server lacks.
      if (!remote.doc || !sameDoc(merged, remote.doc)) {
        const saved = await pushDoc(merged);
        if (saved.signedOut) { setUser(null); setStatus('signed-out'); return; }
        serverDoc = saved.doc;
      } else {
        serverDoc = remote.doc;
      }

      // Whatever the server now holds is, by definition, settled.
      settled.current = fingerprint(serverDoc);

      /* Something may have been ticked off while the request was in flight.
         Adopting the server's copy blindly would throw that away, so fold the
         CURRENT local document back in. The fingerprint above still reflects
         only what the server has, which means the change detector notices the
         difference and pushes the straggler on the next tick. */
      const current = await readLocalDoc();
      const next = sameDoc(current, before) ? serverDoc : mergeState(serverDoc, current);

      const touched = await applyDoc(next);
      // Only disturb React when a key genuinely moved. Re-reading state after
      // an unchanged sync re-renders the whole tree for nothing.
      if (touched.length && onAppliedRef.current) onAppliedRef.current(touched);

      setLastSync(Date.now());
      setStatus('idle');
    } catch (e) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      setStatus(offline ? 'offline' : 'error');
      setError(e.message === 'doc-too-large' ? 'Your data is too large to sync.' : "Sync didn't complete — it'll retry.");
      if (reason !== 'retry') console.warn('sync failed', e);
    } finally {
      busy.current = false;
    }
  }, [capability.sync, user]);

  /* first reconcile once local data has loaded and we know who we are */
  const primed = useRef(false);
  useEffect(() => {
    if (!loaded || !capability.sync || !user || primed.current) return;
    primed.current = true;
    reconcile('boot');
  }, [loaded, capability.sync, user, reconcile]);

  /* Local edits schedule a push; the debounce keeps a burst to one round trip.
     `localVersion` ticks on every persisted change — cheaper than fingerprinting
     all of storage on every render, and the fingerprint check below is what
     actually decides whether anything is owed. */
  useEffect(() => {
    if (!loaded || !capability.sync || !user) return;
    if (settled.current === null) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const doc = await readLocalDoc();
      if (fingerprint(doc) === settled.current) return; // nothing owed — do not push
      reconcile('local-change');
    }, PUSH_DEBOUNCE);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [localVersion, loaded, capability.sync, user, reconcile]);

  /* Anything skipped while a dialog was open runs once it closes, so closing an
     editor is what commits it rather than an arbitrary timer. */
  useEffect(() => {
    if (!capability.sync || !user) return;
    const id = setInterval(() => {
      if (deferred.current && !userIsEditing()) reconcile('resumed');
    }, 1500);
    return () => clearInterval(id);
  }, [capability.sync, user, reconcile]);

  /* coming back to the app, or back online, is when another device's edits are
     most likely to be waiting */
  useEffect(() => {
    if (!capability.sync || !user) return;
    const onFocus = () => { if (document.visibilityState === 'visible') reconcile('focus'); };
    const onOnline = () => reconcile('retry');
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [capability.sync, user, reconcile]);

  const stopSync = useCallback(async () => {
    await disconnect();
    settled.current = null;
    await signOut();
  }, []);

  return useMemo(
    () => ({ capability, user, status, lastSync, error, syncNow: () => reconcile('manual'), signIn, signOut, stopSync }),
    [capability, user, status, lastSync, error, reconcile, stopSync]
  );
}
