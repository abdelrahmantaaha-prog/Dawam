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
const CH_REMIND = 'rhythm-reminders';
const CH_ONGOING = 'rhythm-now';

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

/* Ask — call this from a real user gesture (the Settings button).
   Returns true when we may post notifications. */
export async function ensurePermission() {
  const ln = await get();
  if (!ln) return false;
  let s = await ln.checkPermissions();
  if (s.display === 'prompt' || s.display === 'prompt-with-rationale') s = await ln.requestPermissions();
  if (s.display !== 'granted') return false;
  // Android 8+ needs channels. Reminders are high importance (they must cut
  // through); the ongoing card is low so it never buzzes.
  try {
    await ln.createChannel({ id: CH_REMIND, name: 'Task reminders', importance: 4, visibility: 1 });
    await ln.createChannel({ id: CH_ONGOING, name: 'Now', importance: 1, visibility: 1 });
  } catch { /* channels are Android-only; harmless elsewhere */ }
  return true;
}

/* Replace all pending task reminders with the given set.
   `items`: [{ id, title, at: Date }] — only future times are scheduled. */
export async function syncReminders(items) {
  const ln = await get();
  if (!ln) return;
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

/* Post/refresh the ongoing "what's on Now" card. `null` clears it. */
export async function setOngoing(text) {
  const ln = await get();
  if (!ln) return;
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
