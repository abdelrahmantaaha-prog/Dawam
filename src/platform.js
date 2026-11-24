/* Which shell this is: 'android', 'ios', or 'web'.

   Until the iPad build, "native" meant Android and every bridge module asked
   only isNativePlatform(). That question is still right for what both shells
   have (notifications, files, the share sheet, the deployment as API base),
   and wrong for what only Android has: lock task mode, the home-screen
   widget, Bawwab's now.json, the ongoing card in the shade. On an iPad those
   would each find a plugin proxy with nothing behind it and report themselves
   supported.

   Read from the injected global first, for the reason notify.js gives: the
   bridge's own object is the authority, and @capacitor/core may have decided
   "web" before the bridge existed. Synchronous, like every platform probe
   here. */
import { Capacitor } from '@capacitor/core';

export function shellPlatform() {
  try {
    const g = typeof window !== 'undefined' ? window.Capacitor : null;
    if (g && typeof g.getPlatform === 'function') return g.getPlatform();
    return Capacitor.getPlatform();
  } catch { return 'web'; }
}

export const onAndroid = () => shellPlatform() === 'android';
export const onIOS = () => shellPlatform() === 'ios';
