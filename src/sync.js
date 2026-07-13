/* ------------------------------------------------------------------ */
/*  Cross-device sync — Supabase, per-key last-write-wins.              */
/*                                                                      */
/*  Design: every planner key (settings, pool, templates, week:<ISO>)   */
/*  is one row in a `kv` table scoped to the signed-in user by RLS.     */
/*  Local edits stamp a timestamp and join a persistent dirty queue;    */
/*  syncNow() pulls all remote rows, applies any that are newer than    */
/*  the local copy, then pushes local keys that are newer (or that the  */
/*  remote has never seen). Conflicts resolve per key: last write wins. */
/*  For one person on two or three devices this is the right amount of  */
/*  machinery; it is deliberately not a collaborative CRDT.             */
/*                                                                      */
/*  The Supabase client is injected (clientFactory) so the whole merge  */
/*  can be unit-tested against a mock — the live round-trip needs a     */
/*  real project (see README → Cross-device sync).                      */
/* ------------------------------------------------------------------ */
import { createClient } from '@supabase/supabase-js';

const META_KEY = 'rhythm:sync:meta';    // { plannerKey: msTimestamp } — when we last wrote each key
const DIRTY_KEY = 'rhythm:sync:dirty';  // [plannerKey] — edited locally, not yet pushed

const readJSON = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const isSyncable = (k) => k.startsWith('planner:') && k !== 'planner:__probe' && !k.startsWith('planner:prayers:');

export function createSync({ getConfig, onRemote, clientFactory = createClient, now = Date.now }) {
  let client = null;
  let clientKey = '';

  const meta = () => readJSON(META_KEY, {});
  const setMeta = (m) => localStorage.setItem(META_KEY, JSON.stringify(m));
  const dirty = () => new Set(readJSON(DIRTY_KEY, []));
  const setDirty = (s) => localStorage.setItem(DIRTY_KEY, JSON.stringify([...s]));

  const ensureClient = () => {
    const { url, anonKey } = getConfig() || {};
    if (!url || !anonKey) { client = null; clientKey = ''; return null; }
    const key = `${url}|${anonKey}`;
    if (!client || clientKey !== key) { client = clientFactory(url, anonKey); clientKey = key; }
    return client;
  };

  const getUser = async () => {
    const c = ensureClient(); if (!c) return null;
    try {
      let { data } = await c.auth.getSession();
      // After an OAuth redirect lands back on the app, supabase-js exchanges the
      // code asynchronously — give it a moment before concluding "signed out".
      if (!data?.session && typeof window !== 'undefined' && /[?#&](code|access_token)=/.test(window.location.href)) {
        for (let i = 0; i < 6 && !data?.session; i++) {
          await new Promise((r) => setTimeout(r, 350));
          ({ data } = await c.auth.getSession());
        }
      }
      return data?.session?.user || null;
    } catch { return null; }
  };

  /* Called (via the storage save hook) on every local write. */
  const markDirty = (key) => {
    if (!isSyncable(key)) return;
    const m = meta(); m[key] = now(); setMeta(m);
    const d = dirty(); d.add(key); setDirty(d);
  };

  /* Full two-way sync. Returns { pulled, pushed } or throws with a readable message. */
  const syncNow = async () => {
    const c = ensureClient();
    if (!c) return { pulled: 0, pushed: 0, skipped: 'not configured' };
    const user = await getUser();
    if (!user) return { pulled: 0, pushed: 0, skipped: 'signed out' };

    const { data: rows, error: selErr } = await c.from('kv').select('key,value,updated_at');
    if (selErr) throw new Error(selErr.message || 'sync: could not read from Supabase');

    const m = meta();
    const d = dirty();
    const remoteT = {};
    let pulled = 0;

    for (const row of rows || []) {
      remoteT[row.key] = Date.parse(row.updated_at) || 0;
      const localT = m[row.key] || 0;
      if (remoteT[row.key] > localT) {
        // Remote is newer: adopt it. Write storage directly (not saveKey) so this
        // application does not re-enter the dirty queue and echo back.
        localStorage.setItem(row.key, row.value);
        m[row.key] = remoteT[row.key];
        d.delete(row.key);
        pulled++;
        try { onRemote && onRemote(row.key, row.value); } catch (e) { console.error('sync apply failed for', row.key, e); }
      }
    }

    // Push: dirty keys that are still at-least-as-new as remote, plus any local
    // key the remote has never seen (seeds a fresh account from this device).
    const candidates = new Set(d);
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && isSyncable(k) && !(k in remoteT)) candidates.add(k);
    }
    const toPush = [];
    for (const k of candidates) {
      const v = localStorage.getItem(k);
      if (v == null) { d.delete(k); continue; }
      const localT = m[k] || now();
      if (localT >= (remoteT[k] || 0)) {
        m[k] = localT;
        toPush.push({ user_id: user.id, key: k, value: v, updated_at: new Date(localT).toISOString() });
      } else {
        d.delete(k); // remote won this key above
      }
    }
    if (toPush.length) {
      const { error: upErr } = await c.from('kv').upsert(toPush, { onConflict: 'user_id,key' });
      if (upErr) throw new Error(upErr.message || 'sync: could not write to Supabase');
      for (const r of toPush) d.delete(r.key);
    }
    setMeta(m); setDirty(d);
    return { pulled, pushed: toPush.length };
  };

  const signIn = async (email, password) => {
    const c = ensureClient(); if (!c) throw new Error('Enter the Supabase URL and anon key first.');
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return data.user;
  };
  const signUp = async (email, password) => {
    const c = ensureClient(); if (!c) throw new Error('Enter the Supabase URL and anon key first.');
    const { data, error } = await c.auth.signUp({ email, password });
    if (error) throw new Error(error.message);
    return data.user;
  };
  const signOut = async () => { const c = ensureClient(); if (c) await c.auth.signOut(); };
  // OAuth: navigates away to Google, then back to the app; the session is
  // detected from the URL on return (see getUser). Requires the Google provider
  // to be enabled in Supabase and this app's URL to be in Supabase's redirect
  // allowlist — steps in README → Google sign-in.
  const signInWithGoogle = async (extraScopes = '') => {
    const c = ensureClient(); if (!c) throw new Error('Enter the Supabase URL and anon key first.');
    const opts = { redirectTo: window.location.origin };
    if (extraScopes) { opts.scopes = extraScopes; opts.queryParams = { access_type: 'offline', prompt: 'consent' }; }
    const { error } = await c.auth.signInWithOAuth({ provider: 'google', options: opts });
    if (error) throw new Error(error.message);
  };
  // The Google access token (for calling Google APIs) is present on the session
  // only right after an OAuth sign-in, and is short-lived.
  const getProviderToken = async () => {
    const c = ensureClient(); if (!c) return null;
    try { const { data } = await c.auth.getSession(); return data?.session?.provider_token || null; } catch { return null; }
  };

  return { markDirty, syncNow, signIn, signUp, signOut, signInWithGoogle, getProviderToken, getUser, _internals: { meta, dirty } };
}
