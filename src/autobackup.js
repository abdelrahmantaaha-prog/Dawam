/* ------------------------------------------------------------------ */
/*  Automatic local backups.                                           */
/*                                                                     */
/*  The manual "Download backup" button is a backup nobody presses —    */
/*  the planner's whole history had one copy, in the same browser       */
/*  storage that a cleared profile, a reinstall or a bad sync takes     */
/*  with it. So once a day the app writes a full snapshot on its own,   */
/*  keeps the last KEEP of them, and offers each one back in Settings.   */
/*                                                                     */
/*  Where they go is chosen per platform, and never localStorage: the    */
/*  planner already lives there, it is small, and a copy that dies with  */
/*  the original is not a backup.                                       */
/*                                                                     */
/*    desktop  real files in Documents\Rhythm backups, through the      */
/*             shell's bridge. Visible, copyable, survive a reinstall.  */
/*    phone    the app's private files (Capacitor Filesystem, Data).    */
/*             Survive updates and cleared WebView storage; not an      */
/*             uninstall — the manual export is still the way off the   */
/*             phone.                                                   */
/*    browser  IndexedDB, which has its own and much larger quota.      */
/*                                                                     */
/*  Snapshots never go through sync. They are this device's history.     */
/* ------------------------------------------------------------------ */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

export const KEEP = 14;
const DAY_PREFIX = 'rhythm-auto-';
const PRE_PREFIX = 'rhythm-before-restore-';

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/* One daily file per date: a second write the same day replaces the first,
   so leaving the app open all day still costs one slot, holding the latest. */
export const dailyName = (d = new Date()) => `${DAY_PREFIX}${isoOf(d)}.json`;
export const preRestoreName = (d = new Date()) => `${PRE_PREFIX}${isoOf(d)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
export const isDaily = (name) => String(name).startsWith(DAY_PREFIX);

/* ---- which backend ---- */
const desktopBridge = () => {
  try { return (typeof window !== 'undefined' && window.rhythmFocus && window.rhythmFocus.backup) || null; } catch { return null; }
};
function nativeNow() {
  try {
    const g = typeof window !== 'undefined' ? window.Capacitor : null;
    if (g && typeof g.isNativePlatform === 'function') return g.isNativePlatform();
    return Capacitor.isNativePlatform();
  } catch { return false; }
}
/* Synchronous plugin lookup — see the iron rule in files.js: a Capacitor
   proxy must never pass through promise machinery. */
function fsPlugin() {
  try {
    const g = typeof window !== 'undefined' ? window.Capacitor : null;
    const p = g && g.Plugins && g.Plugins.Filesystem;
    if (p) return p;
  } catch { /* fall through */ }
  return Filesystem;
}

export const backupKind = () => (desktopBridge() ? 'desktop' : nativeNow() ? 'phone' : 'browser');

/* ---- browser: IndexedDB ---- */
const DB = 'rhythm-backups';
const STORE = 'snapshots';
function idb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'name' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
const browser = {
  write: async (name, text) => { await idbDo('readwrite', (s) => s.put({ name, text, at: Date.now(), bytes: text.length })); return { ok: true }; },
  list: async () => ((await idbDo('readonly', (s) => s.getAll())) || []).map(({ name, at, bytes }) => ({ name, at, bytes })),
  read: async (name) => { const r = await idbDo('readonly', (s) => s.get(name)); return r ? r.text : null; },
  remove: async (name) => { await idbDo('readwrite', (s) => s.delete(name)); return true; },
};

/* ---- phone: app-private files ---- */
const DIR = 'rhythm-backups';
const phone = {
  write: async (name, text) => {
    await fsPlugin().writeFile({ path: `${DIR}/${name}`, data: text, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
    return { ok: true };
  },
  list: async () => {
    try {
      const r = await fsPlugin().readdir({ path: DIR, directory: Directory.Data });
      return ((r && r.files) || [])
        .map((f) => (typeof f === 'string' ? { name: f } : f))
        .filter((f) => /\.json$/.test(f.name))
        .map((f) => ({ name: f.name, at: Number(f.mtime) || 0, bytes: Number(f.size) || 0 }));
    } catch { return []; }   // the folder does not exist until the first backup
  },
  read: async (name) => {
    try { const r = await fsPlugin().readFile({ path: `${DIR}/${name}`, directory: Directory.Data, encoding: Encoding.UTF8 }); return r ? r.data : null; }
    catch { return null; }
  },
  remove: async (name) => { try { await fsPlugin().deleteFile({ path: `${DIR}/${name}`, directory: Directory.Data }); return true; } catch { return false; } },
};

const backend = () => {
  const d = desktopBridge();
  if (d) return { write: d.write, list: d.list, read: d.read, remove: d.remove };
  return nativeNow() ? phone : browser;
};

/* Newest first. The file date is in the name for daily snapshots, which is
   the date that matters ("the planner as it was on the 24th"); `at` breaks
   ties and orders the pre-restore ones. */
export async function listBackups() {
  try {
    const rows = await backend().list();
    return (rows || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0) || String(b.name).localeCompare(String(a.name)));
  } catch { return []; }
}

export const readBackup = async (name) => { try { return await backend().read(name); } catch { return null; } };

/* Write one snapshot and trim the history to KEEP. Returns { ok, error? }.
   A failure is reported, never thrown: a backup that cannot be taken must
   not take the planner down with it. */
export async function writeBackup(name, text) {
  try {
    const r = await backend().write(name, text);
    if (!r || r.ok === false) return { ok: false, error: (r && r.error) || 'write refused' };
    await prune();
    return { ok: true, path: r.path || null };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

async function prune() {
  const all = await listBackups();
  const drop = all.slice(KEEP);
  for (const b of drop) { try { await backend().remove(b.name); } catch { /* next time */ } }
}

/* Has today's snapshot been taken? */
export async function hasDailyFor(d = new Date()) {
  const want = dailyName(d);
  return (await listBackups()).some((b) => b.name === want);
}

/* Where they are, in words a person can act on. */
export async function backupWhere() {
  const d = desktopBridge();
  if (d && d.where) { try { return await d.where(); } catch { /* fall through */ } }
  return nativeNow() ? 'phone' : 'browser';
}

export const openBackupFolder = () => { const d = desktopBridge(); return d && d.open ? d.open() : null; };
