/* Bring the iPad app down from GitHub:  npm run ios:fetch

   The .ipa can only be built on a Mac, so GitHub builds it
   (.github/workflows/ios.yml) and this fetches the newest successful build of
   the branch you are on into dist-ios/Dawam.ipa, ready for AltStore. Needs the
   GitHub CLI (`gh`), signed in. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
const runs = JSON.parse(run('gh', ['run', 'list', '--workflow', 'ios.yml', '--branch', branch,
  '--status', 'success', '--limit', '1', '--json', 'databaseId,headSha,createdAt']));
if (!runs.length) {
  console.error(`No successful "Build iPad app" run for ${branch} yet. Push a change under ios/, or run the workflow by hand, and wait for it.`);
  process.exit(1);
}

const { databaseId, headSha, createdAt } = runs[0];
const out = 'dist-ios';
mkdirSync(out, { recursive: true });
rmSync(join(out, 'Dawam.ipa'), { force: true });   // gh refuses to overwrite
execFileSync('gh', ['run', 'download', String(databaseId), '--name', 'dawam-ipa', '--dir', out], { stdio: 'inherit' });

const ipa = join(out, 'Dawam.ipa');
if (!existsSync(ipa)) { console.error('The run had no Dawam.ipa in it.'); process.exit(1); }
console.log(`${ipa}  (${(statSync(ipa).size / 1e6).toFixed(1)} MB, built ${createdAt} from ${headSha.slice(0, 7)})`);
console.log('Install it with AltStore: My Apps → + → this file.');
