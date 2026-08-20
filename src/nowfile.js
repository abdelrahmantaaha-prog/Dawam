/* now.json — the plan, written where another app can read it.

   Bawwab gates the phone by the clock. It has never known what an hour was
   *for*, so a refusal there is subtraction and nothing else — which is the
   point Newport says a declutter fails at. This closes that: Bawwab offers
   whatever Now is pointing at instead of stopping at no.

   Rhythm's plan lives in the WebView's localStorage and nothing outside can
   read it, so the bridge is a file. Same payload the home widget already gets,
   written to Documents, where Bawwab is pointed once through the system folder
   picker. No permission is asked for on either side and nothing else in there
   is exposed — the owner hands over one folder deliberately.

   IRON RULE (see notify.js and widget.js): never let a Capacitor plugin proxy
   pass through promise machinery it did not create. Filesystem is a normal
   async plugin so awaiting it is fine, but the platform probe stays synchronous
   for the same reason it is in widget.js. */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

const FILE = 'now.json';
const FOLDER = 'Rhythm';

function nativeNow() {
  try {
    const g = typeof window !== 'undefined' ? window.Capacitor : null;
    if (g && typeof g.isNativePlatform === 'function') return g.isNativePlatform();
    if (g && typeof g.getPlatform === 'function') return g.getPlatform() !== 'web';
    return Capacitor.isNativePlatform();
  } catch { return false; }
}

let last = '';

/* Write the current Now summary out.

   Idempotent and cheap: an unchanged payload never reaches the disk. This runs
   on the same key the widget does, which changes only when Now actually moves,
   but a file write is worth guarding more carefully than a bridge call.

   Failure is swallowed on purpose. A planner that will not start because it
   could not write an optional file for a different app would be a bad trade,
   and the reader treats a missing file as simply having no plan. */
export async function writeNowFile(payload) {
  if (!nativeNow()) return;               // browser: no shared filesystem

  const now = {
    // Bawwab ignores anything older than a day rather than sending you off to
    // do something that stopped being true — so the stamp is load-bearing, not
    // decoration.
    updatedAt: Date.now(),
    now: payload && payload.title
      ? { title: payload.title, note: (payload && payload.body) || '' }
      : null,
    next: payload && payload.upcoming ? { title: payload.upcoming } : null,
  };

  const body = JSON.stringify(now, null, 2);
  const key = `${now.now ? now.now.title : ''}|${now.now ? now.now.note : ''}|${now.next ? now.next.title : ''}`;
  if (key === last) return;
  last = key;

  try {
    // recursive so the first write creates the folder rather than failing on
    // a phone that has never had one.
    await Filesystem.writeFile({
      path: `${FOLDER}/${FILE}`,
      data: body,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  } catch (e) {
    console.warn('now.json write failed', e);
  }
}

/* Where to point Bawwab, for the settings screen to show. */
export const NOW_FILE_LOCATION = `Documents/${FOLDER}/${FILE}`;
