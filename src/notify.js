/* ------------------------------------------------------------------ */
/*  Android notifications (Capacitor local notifications).             */
/*                                                                      */
/*  Two jobs:                                                           */
/*    1. Reminders that fire when a timed task's window opens. These    */
/*       are real Android alarms — they fire with the app closed, with  */
/*       no server and no push infrastructure.                          */
/*    2. An ongoing notification mirroring whatever the Now page is     */
/*       showing, so the next thing is glanceable from the shade.       */
/*                                                                      */
/*  EVERY export here is a no-op on the web. Rhythm stays a PWA: the    */
/*  browser build never calls a Capacitor API, and the plugin is only   */
/*  imported once we know we're running inside the Android shell.       */
/*                                                                      */
/*  Known ceiling: local notifications carry fixed text set at schedule */
/*  time — nothing of ours runs in the background. So the ongoing card  */
/*  is refreshed while the app is open or resumed, and otherwise shows  */
/*  what it last knew. Making it update live with the app closed needs  */
/*  a native foreground service, which is a bigger lift.                */
/* ------------------------------------------------------------------ */

const ONGOING_ID = 1;            // fixed id: rescheduling replaces it in place
const REMINDER_BASE = 1000;      // task reminders live above this
// Channel ids are VERSIONED. Android freezes a channel's importance at creation
// and ignores later changes, so correcting importance means publishing a new id
// — otherwise a device that already made the old channel keeps the old
// behaviour forever (short of reinstalling).
const CH_REMIND = 'rhythm-reminders-v2';
const CH_ONGOING = 'rhythm-now-v2';

/* Imported STATICALLY on purpose. These were behind dynamic import() to keep
   them out of the web bundle, but a failed chunk load then rejected out of
   get() — which callers awaited outside their try/catch — and the UI hung on
   "checking" forever with only an unhandled rejection to show for it. A few kB
   in the web bundle is a fair price for removing that whole failure class;
   isNative() still gates every call, so nothing here ever runs in a browser. */
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

/* Are we inside the Android shell? False in any browser, including an
   installed PWA — which is exactly what keeps the web build untouched. */
export async function isNative() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

async function get() {
  return (await isNative()) ? LocalNotifications : null;
}

/* No bridge call may hang the UI. If the native side never answers we resolve
   to a marker instead of leaving a promise (and the caller) pending forever. */
function withTimeout(promise, ms, onTimeout) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(onTimeout), ms)),
  ]);
}

/* Stable positive 32-bit id from a task id — Android wants integers, and the
   id must be reproducible so rescheduling replaces rather than duplicates. */
function idFor(taskId) {
  let h = 0;
  for (let i = 0; i < taskId.length; i++) h = ((h << 5) - h + taskId.charCodeAt(i)) | 0;
  return REMINDER_BASE + (Math.abs(h) % 1_000_000);
}

/* Check WITHOUT prompting — used by the scheduling effects, which must never
   pop a system dialog on their own. Returns 'granted' | 'denied' | 'prompt'. */
export async function permissionState() {
  try {
    const ln = await get();
    if (!ln) return 'unsupported';
    const r = await withTimeout(ln.checkPermissions(), 4000, null);
    return r ? r.display : 'timeout';
  } catch (e) {
    // Surface it rather than swallowing — this string is shown in Settings.
    return `error: ${e && e.message ? e.message : e}`;
  }
}

/* Create the channels. MUST run before anything is posted: on Android 8+ a
   notification aimed at a channel that doesn't exist is dropped silently — no
   error, no notification. This used to live only in ensurePermission(), which
   meant that on Android <= 12 (where POST_NOTIFICATIONS is auto-granted, so the
   Settings button is never needed) the channels were never created and every
   single notification vanished. Idempotent: Android ignores repeat creates. */
let channelsReady = false;
async function ensureChannels(ln) {
  if (channelsReady) return;
  try {
    // 4 = IMPORTANCE_HIGH: reminders must cut through.
    await ln.createChannel({ id: CH_REMIND, name: 'Task reminders', importance: 4, visibility: 1 });
    // 2 = IMPORTANCE_LOW: silent, but still shown with a status-bar icon.
    // (1 = MIN hides the icon and collapses it, which reads as "nothing".)
    await ln.createChannel({ id: CH_ONGOING, name: 'Now', importance: 2, visibility: 1 });
    channelsReady = true;
  } catch { /* channels are Android-only; harmless elsewhere */ }
}

/* Ask — call this from a real user gesture (the Settings button).
   Returns true when we may post notifications. */
export async function ensurePermission() {
  const ln = await get();
  if (!ln) return false;
  let s = await ln.checkPermissions();
  if (s.display === 'prompt' || s.display === 'prompt-with-rationale') s = await ln.requestPermissions();
  if (s.display !== 'granted') return false;
  await ensureChannels(ln);
  return true;
}

/* Post one notification right now. Purely a diagnostic for the Settings
   screen — if this doesn't appear, the problem is permission/channels/OS, not
   the scheduling logic. Returns a short string describing what happened. */
export async function testNotification() {
  const ln = await get();
  if (!ln) return 'not the Android app';
  const state = (await ln.checkPermissions()).display;
  if (state !== 'granted') return `permission is "${state}"`;
  await ensureChannels(ln);
  try {
    await ln.schedule({ notifications: [{ id: 99, title: 'Rhythm', body: 'Notifications are working.', channelId: CH_REMIND }] });
    return 'sent';
  } catch (e) { return `failed: ${e && e.message ? e.message : e}`; }
}

/* Replace all pending task reminders with the given set.
   `items`: [{ id, title, at: Date }] — only future times are scheduled. */
export async function syncReminders(items) {
  const ln = await get();
  if (!ln) return;
  await ensureChannels(ln);
  try {
    const pending = await ln.getPending();
    const stale = (pending.notifications || []).filter((n) => n.id >= REMINDER_BASE);
    if (stale.length) await ln.cancel({ notifications: stale.map((n) => ({ id: n.id })) });

    const now = Date.now();
    const due = items
      .filter((it) => it.at instanceof Date && it.at.getTime() > now + 1000)
      .map((it) => ({
        id: idFor(it.id),
        title: it.title,
        body: it.body || 'Starting now.',
        channelId: CH_REMIND,
        schedule: { at: it.at, allowWhileIdle: true }, // punch through Doze
      }));
    if (due.length) await ln.schedule({ notifications: due });
  } catch (e) { console.warn('reminder sync failed', e); }
}

/* How many reminders Android currently holds for us — the honest answer to
   "is anything actually scheduled?". */
export async function pendingCount() {
  try {
    const ln = await get();
    if (!ln) return null;
    const p = await withTimeout(ln.getPending(), 4000, null);
    if (!p) return null;
    return (p.notifications || []).filter((n) => n.id >= REMINDER_BASE).length;
  } catch { return null; }
}

/* Post/refresh the ongoing "what's on Now" card. `null` clears it. */
export async function setOngoing(text) {
  const ln = await get();
  if (!ln) return;
  await ensureChannels(ln);
  try {
    if (!text) { await ln.cancel({ notifications: [{ id: ONGOING_ID }] }); return; }
    await ln.schedule({
      notifications: [{
        id: ONGOING_ID,
        title: text.title,
        body: text.body || '',
        channelId: CH_ONGOING,
        ongoing: true,      // sticky: not swipe-dismissible
        autoCancel: false,  // tapping it opens the app without clearing it
      }],
    });
  } catch (e) { console.warn('ongoing notification failed', e); }
}
