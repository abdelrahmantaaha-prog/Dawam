/* Does dictation actually work in the Electron shell?

   The mic renders only when the shell can offer one of the two engines
   (`speechSupported() || recordingSupported()`), so "no button" and "no
   microphone API" look identical from the outside. This launches the real
   app and asks the real window, because that question cannot be answered
   from the unit tests: jsdom has neither API either.

   It also starts a real SpeechRecognition. Electron *defines*
   webkitSpeechRecognition — the interface is part of Blink — but the
   open-source Chromium it is built from carries no Google speech
   credentials, so the recognition itself fails once started. "Defined" and
   "usable" are different questions and only the second one matters.

   Run:  node desktop/mic-probe.mjs      (build first — it serves dist/)
   The app must not already be running; the single-instance lock would send
   this one straight back out.  */

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 9223;
const DATA_DIR = path.join(HERE, '.probe-data');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const electron = spawn(
  path.join(HERE, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron'),
  ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${DATA_DIR}`],
  { cwd: HERE, stdio: 'ignore', shell: process.platform === 'win32' }
);

function stop() {
  try {
    if (process.platform === 'win32' && electron.pid) {
      spawnSync('taskkill', ['/pid', String(electron.pid), '/T', '/F'], { stdio: 'ignore' });
    }
    electron.kill();
  } catch { /* already gone */ }
}

async function plannerTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const t = list.find((x) => x.type === 'page' && x.url.startsWith('rhythm://'));
      if (t) return t;
    } catch { /* not listening yet */ }
    await sleep(500);
  }
  console.error('The planner window never appeared. Is Rhythm already running?');
  stop();
  process.exit(1);
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
const ev = async (raw) => {
  const expression = raw.includes('await ') ? `(async () => (${raw}))()` : raw;
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description || JSON.stringify(ex));
  return r.result?.result?.value;
};
const waitFor = async (expr, ms = 15000) => {
  const until = Date.now() + ms;
  for (;;) {
    if (await ev(expr) === true) return true;
    if (Date.now() > until) return false;
    await sleep(250);
  }
};

try {
  await waitFor('!!document.querySelector(".rhythm")');

  console.log('--- what the shell offers ---');
  console.log('isSecureContext        ', await ev('window.isSecureContext'));
  console.log('origin                 ', await ev('location.origin'));
  console.log('SpeechRecognition      ', await ev('!!(window.SpeechRecognition || window.webkitSpeechRecognition)'));
  console.log('getUserMedia           ', await ev('!!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)'));
  console.log('MediaRecorder          ', await ev('!!window.MediaRecorder'));
  console.log('OfflineAudioContext    ', await ev('!!(window.OfflineAudioContext || window.webkitOfflineAudioContext)'));

  console.log('--- does Web Speech actually run? ---');
  const speech = await ev(`await new Promise((resolve) => {
    const C = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!C) return resolve('undefined');
    let r;
    try { r = new C(); } catch (e) { return resolve('construct threw: ' + e.message); }
    let settled = false;
    const log = [];
    const done = (v) => { if (!settled) { settled = true; try { r.abort(); } catch {} resolve(v); } };
    r.onerror = (e) => log.push('error:' + e.error);
    r.onstart = () => log.push('start');
    r.onresult = () => log.push('result');
    r.onaudiostart = () => log.push('audiostart');
    r.onspeechstart = () => log.push('speechstart');
    r.onend = () => done(log.join(' -> ') + ' -> end');
    try { r.start(); } catch (e) { done('start threw: ' + e.message); }
    setTimeout(() => done(log.join(' -> ') + ' -> (still open after 20s)'), 20000);
  })`);
  console.log('SpeechRecognition.start', speech);

  console.log('--- what the person sees ---');
  console.log('assistant button       ', await ev('!!document.querySelector("[aria-label=\\"Planning assistant\\"]")'));
  await ev('document.querySelector("[aria-label=\\"Planning assistant\\"]").click()');
  await sleep(600);
  console.log('assistant panel open   ', await ev('!!document.querySelector(".chat-modal")'));
  console.log('MIC BUTTON PRESENT     ', await ev('!!document.querySelector(".mic-btn")'));
  console.log('chat placeholder       ', await ev('(document.querySelector(".chat-input")||{}).placeholder'));

  // The real thing: press the mic and see where the app ends up. On this shell
  // the live lane must retire itself and hand over to the recorder — an
  // 'unavailable' banner here means the fallback never fired.
  await ev('document.querySelector(".mic-btn").click()');
  await sleep(14000);
  console.log('mic class after press  ', await ev('(document.querySelector(".mic-btn")||{}).className'));
  console.log('error shown            ', await ev('((document.querySelector(".chat-body .hint-text")||{}).textContent) || "(none)"'));
} catch (e) {
  console.error('probe failed:', e.message);
} finally {
  stop();
}
