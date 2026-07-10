/* ------------------------------------------------------------------ */
/*  Storage — localStorage, wrapped in the same async API the app      */
/*  already speaks (get/set/delete/list). Local-only by design: no     */
/*  cloud, no sync. The async shape is kept so the app code and any    */
/*  future backend swap stay unchanged.                                */
/* ------------------------------------------------------------------ */
const memCache = {}; // fallback if localStorage is unavailable (private mode edge cases)

const hasLS = () => {
  try { const k = '__rhythm_probe__'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; }
  catch { return false; }
};
const LS = hasLS();

export async function rawGet(key) {
  if (!LS) return key in memCache ? memCache[key] : null;
  const v = localStorage.getItem(key);
  return v == null ? null : v;
}
export async function rawSet(key, value) {
  if (!LS) { memCache[key] = value; return; }
  try { localStorage.setItem(key, value); }
  catch (e) { console.error('storage.set failed (quota?)', e); }
}
export async function rawDelete(key) {
  if (!LS) { delete memCache[key]; return; }
  try { localStorage.removeItem(key); } catch { /* ignore */ }
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
export const saveKey = async (k, o) => { await rawSet(k, JSON.stringify(o)); };
export const storageAvailable = () => LS;
