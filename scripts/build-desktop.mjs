/* Build the planner for the Electron shell.

   Only difference from `npm run build`: RHYTHM_DESKTOP switches the PWA
   plugin off (see vite.config.js). It lives in a script rather than inline in
   package.json because setting an env var inline is not portable between
   cmd.exe and every shell this repo gets built from. */
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['vite', 'build'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, RHYTHM_DESKTOP: '1' },
});
process.exit(r.status ?? 1);
