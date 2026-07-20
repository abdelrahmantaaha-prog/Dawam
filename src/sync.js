/* ------------------------------------------------------------------ */
/*  Cross-device sync — per-key last-write-wins, backend-agnostic.      */
/*                                                                      */
/*  Design: every planner key (settings, pool, templates, week:<ISO>)   */
/*  is one record scoped to the signed-in account. Local edits stamp a  */
/*  timestamp and join a persistent dirty queue; syncNow() pulls all    */
/*  remote records, applies any newer than the local copy, then pushes  */
/*  local keys that are newer (or that the remote has never seen).      */
/*  Conflicts resolve per key: last write wins. For one person on two   */
/*  or three devices this is the right amount of machinery; it is       */
/*  deliberately not a collaborative CRDT.                              */
/*                                                                      */
/*  The BACKEND is injected as a `transport`, so the merge engine here  */
/*  is independent of who stores the bytes (and unit-testable against a */
/*  plain object). A transport is:                                      */
/*      list()        -> [{ key, value, updated_at }]                   */
/*      upsert(rows)  -> void      // rows: [{ key, value, updated_at }]*/
/*  getTransport() returning null means "no backend configured yet" —   */
/*  the app then runs fully local and every sync is a no-op.            */
/*                                                                      */
/*  Cadence: automatic sync runs at most twice a day (see AUTO_EVERY_MS)*/
/*  and is checked on launch and when the app returns to the            */
/*  foreground. A manual "Sync now" always runs immediately.            */
/* ------------------------------------------------------------------ */

const META_KEY = 'rhythm:sync:meta';    // { plannerKey: msTimestamp } — when we last wrote each key
const DIRTY_KEY = 'rhythm:sync:dirty';  // [plannerKey] — edited locally, not yet pushed
const AUTO_KEY = 'rhythm:sync:lastAuto'; // ms timestamp of the last automatic sync

export const AUTO_EVERY_MS = 12 * 60 * 60 * 1000; // twice a day

const readJSON = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const isSyncable = (k) => k.startsWith('planner:') && k !== 'planner:__probe' && !k.startsWith('planner:prayers:');

export function createSync({ getTransport, onRemote, now = Date.now }) {
  const meta = () => readJSON(META_KEY, {});
  const setMeta = (m) => localStorage.setItem(META_KEY, JSON.stringify(m));
  const dirty = () => new Set(readJSON(DIRTY_KEY, []));
  const setDirty = (s) => localStorage.setItem(DIRTY_KEY, JSON.stringify([...s]));

  const lastAuto = () => Number(localStorage.getItem(AUTO_KEY)) || 0;
  const markAuto = () => { try { localStorage.setItem(AUTO_KEY, String(now())); } catch { /* ignore */ } };
  /* Is an automatic sync due? "Never synced" is always due — checked explicitly
     rather than leaning on now() being a large epoch value. */
  const autoDue = () => { const last = lastAuto(); return last === 0 || now() - last >= AUTO_EVERY_MS; };

  /* Called (via the storage save hook) on every local write. */
  const markDirty = (key) => {
    if (!isSyncable(key)) return;
    const m = meta(); m[key] = now(); setMeta(m);
    const d = dirty(); d.add(key); setDirty(d);
  };

  /* Full two-way sync. `auto: true` respects the twice-a-day budget and is a
     no-op when one has already run inside the window. Returns { pulled, pushed }
     or { skipped } — throws only when the backend itself errors. */
  const syncNow = async ({ auto = false } = {}) => {
    const transport = getTransport && getTransport();
    if (!transport) return { pulled: 0, pushed: 0, skipped: 'not configured' };
    if (auto && !autoDue()) return { pulled: 0, pushed: 0, skipped: 'not due' };

    const rows = await transport.list();

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
        toPush.push({ key: k, value: v, updated_at: new Date(localT).toISOString() });
      } else {
        d.delete(k); // remote won this key above
      }
    }
    if (toPush.length) {
      await transport.upsert(toPush);
      for (const r of toPush) d.delete(r.key);
    }
    setMeta(m); setDirty(d);
    markAuto(); // any successful sync restarts the twice-a-day clock
    return { pulled, pushed: toPush.length };
  };

  return { markDirty, syncNow, autoDue, lastAuto, _internals: { meta, dirty } };
}
