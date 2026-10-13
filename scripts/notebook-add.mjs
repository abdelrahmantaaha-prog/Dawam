#!/usr/bin/env node
/* Drop a topic into one of Rhythm's notebooks from outside the app.
 *
 *   node scripts/notebook-add.mjs "Topic" ["one line of detail"] [--notebook "To look into"]
 *
 * Writes notebook-add-<time>.json into Documents\Rhythm backups, which the
 * desktop app watches (desktop/src/main.js, notebook drop-offs). The app files
 * it as a bullet at the end of that notebook — creating and pinning the
 * notebook the first time — and deletes the file. With Rhythm closed the file
 * waits and is filed at the next launch, so nothing here needs the app running.
 *
 * Documents, not AppData: a write to AppData from the Claude app's shells
 * lands in its private container copy, which Rhythm never sees.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DIR = process.env.RHYTHM_DROP_DIR || path.join(os.homedir(), 'Documents', 'Rhythm backups');

const args = process.argv.slice(2);
let notebook = '';
const words = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--notebook') notebook = args[++i] || '';
  else words.push(args[i]);
}
const [topic, detail] = words;
if (!topic || !topic.trim()) {
  console.error('usage: node scripts/notebook-add.mjs "Topic" ["detail"] [--notebook "Name"]');
  process.exit(2);
}

const name = `notebook-add-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
const file = path.join(DIR, name);
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(`${file}.part`, JSON.stringify({ notebook, items: [{ topic, detail: detail || '' }] }), 'utf8');
fs.renameSync(`${file}.part`, file);   // the app only ever sees a whole file

// The running app takes it within a second or two; give it a few.
const t0 = Date.now();
while (Date.now() - t0 < 5000 && fs.existsSync(file)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
console.log(fs.existsSync(file)
  ? `queued: ${file}\nRhythm will file it when it is open (and that notebook is not open in the editor).`
  : `filed into "${notebook || 'To look into'}"`);
