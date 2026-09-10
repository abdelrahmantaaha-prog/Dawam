/* Holding the phone on the Now page (Android only).

   The Now lock draws over the app, and on the desktop that is the whole story
   because the shell owns every display. A phone is not like that: an app can
   cover itself as completely as it likes and Home still leaves. So the phone
   half of the lock is Android's own kiosk primitive — LOCK TASK MODE — which
   is the only thing that can take Home, Recents and the notification shade
   away from an app that asks for them.

   What it cannot do, said here rather than discovered later: an app cannot
   block the system Settings app, and it cannot single out the Accessibility
   screen inside it. The technique that used to — an accessibility service
   watching for that screen, or an overlay drawn on top of it — is precisely
   what Android hardened against, and Play policy restricts accessibility
   services to accessibility. Lock task mode is stronger for this purpose
   anyway: it does not block one screen of Settings, it blocks leaving Rhythm
   at all, Settings included.

   Two modes, and the app must not confuse them:

     pinned   ordinary. Android shows its own confirmation and the person can
              leave by holding Back and Overview. A speed bump with a name.
     locked   Rhythm is the device owner. Nothing leaves until the app says so.
              Provisioned once over adb (see android/README, and the comment in
              RhythmLockPlugin.java).

   IRON RULE (see notify.js and widget.js): never let a Capacitor plugin proxy
   pass through promise machinery on the way to being FOUND. Awaiting the
   lookup makes the engine probe `.then`, the proxy answers with a native
   invoker, and the promise never settles. Finding the plugin is synchronous;
   only its methods are awaited. */
import { Capacitor, registerPlugin } from '@capacitor/core';

const RhythmLock = registerPlugin('RhythmLock');

const OUT = { mode: 'none', held: false, escapable: true, supported: false };

function nativeNow() {
  try {
    const g = typeof window !== 'undefined' ? window.Capacitor : null;
    if (g && typeof g.isNativePlatform === 'function') return g.isNativePlatform();
    if (g && typeof g.getPlatform === 'function') return g.getPlatform() !== 'web';
    return Capacitor.isNativePlatform();
  } catch { return false; }
}

/* Synchronous — see the iron rule above. */
function get() {
  if (!nativeNow()) return null;
  try {
    const g = typeof window !== 'undefined' ? window.Capacitor : null;
    const p = g && g.Plugins && g.Plugins.RhythmLock;
    if (p && typeof p.start === 'function') return p;
  } catch { /* fall through */ }
  return RhythmLock;
}

export const lockSupported = () => !!get();

/* Whether the phone is currently held, and how firmly. Never throws: an OEM
   build that refuses lock task mode should leave the app's own overlay doing
   its job, not break the page that was meant to help. */
export async function lockStatus() {
  const l = get();
  if (!l) return OUT;
  try { return { ...OUT, supported: true, ...(await l.status()) }; }
  catch { return { ...OUT, supported: true }; }
}

export async function holdDevice() {
  const l = get();
  if (!l) return OUT;
  try { return { ...OUT, supported: true, ...(await l.start()) }; }
  catch { return { ...OUT, supported: true }; }
}

export async function releaseDevice() {
  const l = get();
  if (!l) return OUT;
  try { return { ...OUT, supported: true, ...(await l.stop()) }; }
  catch { return { ...OUT, supported: true }; }
}
