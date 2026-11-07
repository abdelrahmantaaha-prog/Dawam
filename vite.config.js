import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { mergeState, migrate } from './shared/model.js';

/* Dev-only sync backend: `RHYTHM_DEV_SYNC=1 npm run dev`.

   Runs the real merge from shared/model.js against an in-memory store, with a
   fixed pretend user and no Auth.js or Postgres. It exists so the sync loop can
   be exercised on a laptop — in particular the failure this whole design is
   shaped around, where an unchanged document is pushed over and over. Never
   part of a build: `apply` only mounts in serve mode behind the flag. */
function devSyncApi() {
  let row = null; // { rev, doc }
  const read = (req) => new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b)); });
  return {
    name: 'rhythm-dev-sync',
    apply: 'serve',
    configureServer(server) {
      if (!process.env.RHYTHM_DEV_SYNC) return;
      let pushes = 0;
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (!url.startsWith('/api/')) return next();
        const json = (code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
        if (url === '/api/me') return json(200, { sync: true, auth: true, db: true, user: { id: 'dev:1', name: 'Dev', email: 'dev@localhost' } });
        if (url === '/api/__stats') return json(200, { pushes, rev: row ? row.rev : 0 });
        if (url === '/api/sync' && req.method === 'GET') return json(200, row ? { rev: row.rev, doc: row.doc } : { rev: 0, doc: null });
        if (url === '/api/sync' && req.method === 'POST') {
          const body = JSON.parse((await read(req)) || '{}');
          const incoming = migrate(body.doc);
          row = row ? { rev: row.rev + 1, doc: mergeState(row.doc, incoming) } : { rev: 1, doc: incoming };
          pushes++;
          return json(200, { rev: row.rev, doc: row.doc });
        }
        if (url === '/api/sync' && req.method === 'DELETE') { row = null; return json(200, { ok: true }); }
        return json(404, { error: 'not-found' });
      });
    },
  };
}

/* The desktop shell serves this build from rhythm://app, a registered scheme
   rather than http. Service workers refuse to register on anything but http(s),
   so the PWA plugin is left out of that build entirely — an installable app has
   no use for it, and its registration only ever produced a console error. */
const DESKTOP = !!process.env.RHYTHM_DESKTOP;

export default defineConfig({
  plugins: [
    devSyncApi(),
    react(),
    ...(DESKTOP ? [] : [VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Dawam — plan your day around the day',
        short_name: 'Dawam',
        description: 'A prayer-time-anchored daily planner. Local-only.',
        theme_color: '#3E8A6C',
        background_color: '#F4FAF6',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The Auth.js sign-in flow ends in a top-level GET navigation to
        // /api/auth/callback/google. Without this the service worker's
        // navigation fallback answers it with index.html, the callback never
        // reaches the server, and sign-in fails in a way that only happens
        // once the app has been installed — the worst kind to debug.
        navigateFallbackDenylist: [/^\/api\//],
        // Cache Google Fonts so the app's typography works fully offline.
        runtimeCaching: [
          { urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i, handler: 'CacheFirst', options: { cacheName: 'google-fonts-css', expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 } } },
          { urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i, handler: 'CacheFirst', options: { cacheName: 'google-fonts-files', expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 } } },
        ],
      },
    })]),
  ],
});
