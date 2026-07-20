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

let plugin = null;               // resolved LocalNotifications, native only
let native = null;               // cached platform check

/* Are we inside the Android shell? False in any browser, including an
   installed PWA — which is exactly what keeps the web build untouched. */
export async function isNative() {
  if (native != null) return native;
  try {
    const { Capacitor } = await import('@capacitor/core');
    native = Capacitor.isNativePlatform();
  } catch { native = false; }
  return native;
}

async function get() {
  if (plugin) return plugin;
  if (!(await isNative())) return null;
  const mod = await import('@capacitor/local-notifications');
  plugin = mod.LocalNotifications;
  return plugin;
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
  const ln = await get();
  if (!ln) return 'unsupported';
  try { return (await ln.checkPermissions()).display; } catch { return 'denied'; }
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
  const ln = await get();
  if (!ln) return null;
  try {
    const p = await ln.getPending();
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
