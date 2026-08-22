/* End-to-end check of the seam between the planner and the focus suite.

   Everything else in this repo is unit-testable, but the thing worth proving
   here is not a pure function — it is that a round started from the planner
   window actually runs in the main process, and that when it ends the planner
   is told, with the task id and the measured time it needs to tick the task
   off and learn what it cost. That only holds if all three processes are real,
   so this launches the app and drives it over the DevTools protocol.

   Run:  npm run desktop:smoke     (from the repo root; builds first)
   The app must not already be running — the single-instance lock would send
   this one straight back out.

   It takes about 45 seconds: a stopped round is only logged when it ran for
   more than 30, and that logging is exactly what is under test. */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 9222;
/* Its own userData directory. The test starts and stops real rounds, and
   those get written to history — which has no business landing in the
   history of the person running the test. */
const DATA_DIR = path.join(HERE, '.smoke-data');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const electron = spawn(
  path.join(HERE, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron'),
  ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${DATA_DIR}`],
  { cwd: HERE, stdio: 'ignore', shell: process.platform === 'win32' }
);
const bail = (msg) => { console.error(msg); try { electron.kill(); } catch {} process.exit(1); };

async function plannerTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const t = list.find((x) => x.type === 'page' && x.url.startsWith('rhythm://'));
      if (t) return t;
    } catch { /* not listening yet */ }
    await sleep(500);
  }
  bail('The planner window never appeared. Is Rhythm already running? Quit it from the tray and try again.');
}

const target = await plannerTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res) => (ws.onopen = res));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

/* Runtime.evaluate has no top-level await, so anything needing one is wrapped
   in an async IIFE and resolved through awaitPromise. */
const ev = async (raw) => {
  const expression = raw.includes('await ') ? `(async () => (${raw}))()` : raw;
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description || JSON.stringify(ex));
  return r.result?.result?.value;
};

/* The planner shows a plain "Loading your day…" node until its week is read
   out of storage, so the first checks have to wait for the real app rather
   than race it. */
const waitFor = async (expr, ms = 10000) => {
  const until = Date.now() + ms;
  for (;;) {
    if (await ev(expr) === true) return true;
    if (Date.now() > until) return false;
    await sleep(250);
  }
};

const results = [];
const check = (name, val) => {
  const pass = val === true;
  results.push({ name, pass, val });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `  → ${JSON.stringify(val)}`}`);
};

try {
  check('the bridge reaches the planner', await ev('!!window.rhythmFocus && window.rhythmFocus.desktop === true'));
  check('the planner rendered', await waitFor('!!document.querySelector(".rhythm")'));

  // Anything left over from a previous run would make the next checks lie.
  await ev('window.rhythmFocus.stop()');
  // Chair detection would pause the round the moment the camera cannot see a
  // face — which is the normal state of a machine running a test — and a
  // paused round never accumulates the 30 seconds that make it worth logging.
  // The blackout screens are switched off for the same reason: a test has no
  // business covering the person's displays.
  await ev('window.rhythmFocus.saveSettings({ chairDetect: false, breakScreen: false, nudgeSound: false, blocklist: [] })');
  await sleep(800);

  check('the focus tab exists', await ev('[...document.querySelectorAll(".navbtn")].some((b) => /Focus|تركيز/.test(b.textContent))'));
  await ev('[...document.querySelectorAll(".navbtn")].find((b) => /Focus|تركيز/.test(b.textContent)).click()');
  await sleep(600);
  check('the focus view renders', await ev('!!document.querySelector(".focus-view")'));
  check('the start form is there when idle', await ev('document.querySelectorAll(".focus-view .field input").length > 0'));

  await ev('window.rhythmFocus.startWork({ task: "Smoke test round", workMin: 1, allowed: [], taskId: "smoke-1" })');
  await sleep(1500);
  check('the round runs in the main process', await ev('(await window.rhythmFocus.getState()).phase === "work"'));
  check('the task id travels with it', await ev('(await window.rhythmFocus.getState()).taskId === "smoke-1"'));
  check('the live card replaced the form', await ev('!!document.querySelector(".focus-live")'));
  check('the clock is counting', await ev('/^\\d\\d:\\d\\d$/.test((document.querySelector(".focus-clock")?.textContent || "").trim())'));

  await ev('window.rhythmFocus.pause()');
  await sleep(700);
  check('pause reaches the session', await ev('(await window.rhythmFocus.getState()).paused === true'));
  await ev('window.rhythmFocus.resume()');
  await sleep(700);
  check('resume reaches the session', await ev('(await window.rhythmFocus.getState()).paused === false'));

  await ev('window.__ended = null; window.rhythmFocus.onRoundEnded((e) => { window.__ended = e; });');
  console.log('      …letting the round run past the 30s a stopped round needs to count');
  await sleep(34000);
  await ev('window.rhythmFocus.stop()');
  await sleep(1500);

  const ended = await ev('window.__ended');
  check('the planner is told the round ended', !!ended);
  check('it carries the task id', ended?.taskId === 'smoke-1');
  check('it carries the measured time', typeof ended?.focusedSec === 'number' && ended.focusedSec > 25);
  check('the session went back to idle', await ev('(await window.rhythmFocus.getState()).phase === "idle"'));
  check('the round is in the history', await ev('(await window.rhythmFocus.getData()).history.some((h) => h.task === "Smoke test round")'));
} catch (err) {
  console.error('\nsmoke test threw:', err.message);
  results.push({ name: 'ran to completion', pass: false });
}

const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `\n${failed} FAILED of ${results.length}` : `\nAll ${results.length} checks passed.`);
ws.close();
try { electron.kill(); } catch {}
await sleep(500);
try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* Windows may still hold it; harmless */ }
process.exit(failed ? 1 : 0);
