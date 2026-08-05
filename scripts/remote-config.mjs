/* Point the APK's WebView at a deployment.

   WHY THIS EXISTS: the APK serves the bundled build from https://localhost —
   its own WebView asset server. That is what makes Rhythm work with no network,
   but it also means a relative "/api/me" never leaves the phone, so sync can
   never see a backend however the deployment is configured. Setting a
   server.url makes the origin the deployment itself, so the API, the session
   cookie and the Google OAuth round trip all line up with no CORS and no
   cross-site cookies.

   It patches android/app/src/main/assets/capacitor.config.json — the copy the
   app actually reads at runtime, written by `cap sync` and gitignored — rather
   than the committed source, so a remote build never dirties the tree.

   Run AFTER `cap sync`:
       RHYTHM_REMOTE_URL=https://your-app.vercel.app npm run android:remote

   No env var: does nothing, and the build stays local-first and offline.

   THE TRADE, stated plainly: localStorage is per ORIGIN. Moving from
   https://localhost to your domain makes the existing on-device planner
   invisible. Export a backup from Settings BEFORE installing such a build and
   import it afterwards. First launch also needs the network (the service
   worker covers later ones). */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const TARGET = 'android/app/src/main/assets/capacitor.config.json';
const url = (process.env.RHYTHM_REMOTE_URL || '').trim();

if (!url) {
  console.log('remote-config: RHYTHM_REMOTE_URL not set — leaving the build local-first (bundled, offline).');
  process.exit(0);
}
if (!/^https:\/\//i.test(url)) {
  console.error(`remote-config: refusing "${url}" — must be https://, or the WebView loses secure context (service worker and notifications both need it).`);
  process.exit(1);
}
if (!existsSync(TARGET)) {
  console.error(`remote-config: ${TARGET} not found. Run \`npx cap sync android\` first — this patches the synced copy, not the source.`);
  process.exit(1);
}

/* Sign-in leaves the app's own origin. Capacitor hands any navigation it does
   not recognise to the system browser, and Google's callback would then land
   there — setting the session cookie in Chrome's jar, not the WebView's, so the
   app would come back still signed out. Listing the OAuth hosts keeps the whole
   round trip inside the WebView, where the cookie lands somewhere useful. */
const OAUTH_HOSTS = ['accounts.google.com', 'accounts.youtube.com'];

const cfg = JSON.parse(readFileSync(TARGET, 'utf8'));
cfg.server = {
  ...(cfg.server || {}),
  url,
  androidScheme: 'https',
  cleartext: false,
  allowNavigation: [...new Set([...(cfg.server?.allowNavigation || []), ...OAUTH_HOSTS])],
};
writeFileSync(TARGET, JSON.stringify(cfg, null, 2));
console.log(`remote-config: APK will load ${url}`);
console.log('remote-config: reminder — different origin, so export a backup before installing and import after.');
console.log('remote-config: if Google answers "disallowed_useragent", sign-in needs a token handoff — see README → Sync in the APK.');
