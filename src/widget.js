/* Home-screen widget bridge (Android only).

   The widget shows a snapshot of whatever Now is pointing at. Native code
   cannot read the planner — it lives in the WebView's localStorage — so the
   web layer pushes a small summary in whenever Now changes, and the widget
   renders whatever it was last given. Two consequences worth knowing:
   the widget is only as fresh as the last time the app ran, and it cannot tick
   anything off (tapping opens the app, where the real state is).

   IRON RULE (see notify.js): never let a Capacitor plugin proxy pass through
   promise machinery. Awaiting it makes the engine probe `.then`, the proxy
   answers with a native invoker, and the promise never settles. get() is
   synchronous by design. */
import { Capacitor, registerPlugin } from '@capacitor/core';

const RhythmWidget = registerPlugin('RhythmWidget');

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
    const p = g && g.Plugins && g.Plugins.RhythmWidget;
    if (p && typeof p.update === 'function') return p;
  } catch { /* fall through */ }
  return RhythmWidget;
}

/* What the launch asked for, once.

   The widget's + puts an action on its launch intent; this collects it. Called
   on boot AND on every resume, because Android delivers a warm start's intent
   to an app that is already running — onNewIntent, not onCreate — and there is
   no other moment at which the app can notice.

   Answers null on an ordinary open, and on the web, where there is no widget
   and nothing to collect. */
export async function takeWidgetAction() {
  const w = get();
  if (!w || typeof w.takeAction !== 'function') return null;
  try { const r = await w.takeAction(); return (r && r.action) || null; }
  catch { return null; }
}

let last = '';

/* Push the current Now summary to the widget. Cheap and idempotent: an
   unchanged payload is dropped here rather than crossing the bridge and
   re-rendering every placed instance. */
export async function updateWidget(payload) {
  const w = get();
  if (!w) return;                       // web: nothing to do
  const body = {
    title: (payload && payload.title) || '',
    body: (payload && payload.body) || '',
    upcoming: (payload && payload.upcoming) || '',
  };
  const key = `${body.title}${body.body}${body.upcoming}`;
  if (key === last) return;
  last = key;
  try { await w.update(body); } catch (e) { console.warn('widget update failed', e); }
}
