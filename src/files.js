/* ------------------------------------------------------------------ */
/*  Saving a backup file, on the web and inside the Android shell.      */
/*                                                                      */
/*  On the web an <a download> + blob URL is all it takes. In an        */
/*  Android WebView that silently does NOTHING — there is no download   */
/*  manager wired to blob: URLs — so "Download .json" appeared to work  */
/*  in the APK and produced no file. Natively we write the file with    */
/*  the Filesystem plugin and hand it to the system share sheet, which  */
/*  lets you drop it in Drive/Files/anywhere.                           */
/*                                                                      */
/*  IRON RULE (learned the hard way, see notify.js): never let a        */
/*  Capacitor plugin proxy pass through promise machinery. Awaiting it  */
/*  makes the engine probe `.then`, the proxy answers with a native     */
/*  invoker, and the promise never settles. All getters here are        */
/*  synchronous by design.                                              */
/* ------------------------------------------------------------------ */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

function nativeNow() {
  try {
    const g = typeof window !== 'undefined' ? window.Capacitor : null;
    if (g && typeof g.isNativePlatform === 'function') return g.isNativePlatform();
    if (g && typeof g.getPlatform === 'function') return g.getPlatform() !== 'web';
    return Capacitor.isNativePlatform();
  } catch { return false; }
}
/* Synchronous — see the iron rule above. */
function plugin(name, fallback) {
  try {
    const g = typeof window !== 'undefined' ? window.Capacitor : null;
    const p = g && g.Plugins && g.Plugins[name];
    if (p) return p;
  } catch { /* fall through */ }
  return fallback;
}

export const canShareFiles = () => nativeNow();

/* Save `text` as `filename`. Returns a short status string for the UI:
   'downloaded' | 'shared' | 'saved:<path>' | 'error: …' */
export async function saveJson(filename, text) {
  if (!nativeNow()) {
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      // Revoke on a later tick: Safari cancels an in-flight download if the
      // object URL disappears synchronously.
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return 'downloaded';
    } catch (e) { return `error: ${e && e.message ? e.message : e}`; }
  }
  const fs = plugin('Filesystem', Filesystem);
  const sh = plugin('Share', Share);
  try {
    // Cache, not Documents: no storage permission needed on any API level, and
    // the share sheet is how the file actually reaches somewhere permanent.
    const res = await fs.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    try {
      await sh.share({ title: 'Rhythm backup', url: res.uri, dialogTitle: 'Save your Rhythm backup' });
      return 'shared';
    } catch (shareErr) {
      // Share cancelled or unavailable — the file still exists, so say where.
      return `saved:${res.uri}`;
    }
  } catch (e) { return `error: ${e && e.message ? e.message : e}`; }
}
