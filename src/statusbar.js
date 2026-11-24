/* The iPad's status bar (iOS only).

   The iOS shell draws the page under the status bar — the sky runs to the top
   edge of the glass, and styles.css keeps the header clear of the clock with
   env(safe-area-inset-top). What the page cannot do from CSS is choose the
   colour of the clock itself. Left alone it follows the SYSTEM's light or dark
   mode, and Dawam's dark theme follows the planner (a setting, or nightfall by
   the prayer times): an iPad in light mode after Isha would show a black
   clock on a black sky.

   So the app says which it is on. In the plugin's words, Style.Dark is "light
   text for dark backgrounds".

   Android is left out on purpose: its status bar is not drawn over, so there
   is nothing to match.

   IRON RULE (see notify.js): the plugin proxy is found synchronously and never
   awaited; only its methods are. */
import { StatusBar, Style } from '@capacitor/status-bar';
import { onIOS } from './platform.js';

function get() {
  if (!onIOS()) return null;
  try {
    const g = typeof window !== 'undefined' ? window.Capacitor : null;
    const p = g && g.Plugins && g.Plugins.StatusBar;
    if (p && typeof p.setStyle === 'function') return p;
  } catch { /* fall through */ }
  return StatusBar;
}

/* Never throws and never blocks: a clock in the wrong colour is the worst
   this can do, and that is not worth an unhandled rejection. */
export function matchStatusBar(dark) {
  const sb = get();
  if (!sb) return;
  try {
    const r = sb.setStyle({ style: dark ? Style.Dark : Style.Light });
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch { /* the bridge refused; nothing to do */ }
}
