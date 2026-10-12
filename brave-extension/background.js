/* Rhythm Bubbles — the worker.

   Rhythm (the desktop app) runs a small server on this computer that says
   what bubble is running. This worker keeps a question open to it — "tell me
   when the bubble changes" — and turns the answer into Brave's own blocking
   rules, so a page outside the bubble is swapped for blocked.html before it
   loads. When the bubble ends, the rules go and the swapped tabs go back to
   where they were (blocked.js does that part).

   If Rhythm is not running there is no bubble, and Brave is left alone. */

importScripts('rules.js');

const PORTS = [47615, 47616, 47617];
const BLOCKED = chrome.runtime.getURL('blocked.html');

let base = null;        // http://127.0.0.1:<port> once Rhythm is found
let version = -1;       // the bubble version last seen; the server holds the question until it changes
let rulesKey = null;    // the rules currently installed, to skip needless rewrites
let lastSweep = null;
let looping = false;

async function findRhythm() {
  for (const p of PORTS) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/bubble?since=-1`, { cache: 'no-store', signal: AbortSignal.timeout(1500) });
      if (r.ok) return `http://127.0.0.1:${p}`;
    } catch { /* not this port */ }
  }
  return null;
}

/* Brave's own blocking: every page redirects to blocked.html, except the
   bubble's sites, the sign-in pages, and addresses with a keyword in them.
   Higher priority wins, so the allow rules beat the catch-all. */
async function installRules(rules) {
  const key = JSON.stringify(rules || null);
  if (key === rulesKey) return false;
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  const add = [];
  if (rules) {
    add.push({
      id: 1, priority: 1,
      action: { type: 'redirect', redirect: { regexSubstitution: `${BLOCKED}#\\0` } },
      condition: { regexFilter: '^https?://.*', resourceTypes: ['main_frame'] }
    });
    const domains = [...(rules.domains || []), ...(rules.signIn || [])];
    if (domains.length) {
      add.push({ id: 2, priority: 2, action: { type: 'allow' }, condition: { requestDomains: domains, resourceTypes: ['main_frame'] } });
    }
    (rules.keywords || []).map((k) => String(k).replace(/[*|^]/g, '').trim()).filter(Boolean).forEach((k, i) => {
      add.push({ id: 10 + i, priority: 2, action: { type: 'allow' }, condition: { urlFilter: k, resourceTypes: ['main_frame'] } });
    });
  }
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map((r) => r.id), addRules: add });
  rulesKey = key;
  return true;
}

// Tabs already open on a page outside the bubble are swapped the same way.
async function sweep(rules) {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (t.url && /^https?:/.test(t.url) && !urlAllowed(t.url, rules)) {
      try { await chrome.tabs.update(t.id, { url: `${BLOCKED}#${t.url}` }); } catch { /* tab closed meanwhile */ }
    }
  }
}

async function apply(state) {
  const rules = state && state.active ? state.rules : null;
  // Storage is also what the popup and blocked.js read. Writing it is an
  // extension call, which keeps this worker awake between questions.
  await chrome.storage.session.set({ bubble: state || null, connected: !!state, at: Date.now() });
  const changed = await installRules(rules);
  const nudged = state && state.sweep !== lastSweep;
  if (state) lastSweep = state.sweep;
  if (rules && (changed || nudged)) await sweep(rules);
  version = state ? state.v : -1;
}

async function loop() {
  if (looping) return;
  looping = true;
  try {
    for (;;) {
      if (!base) base = await findRhythm();
      if (!base) { await apply(null); return; }   // Rhythm is not running: no bubble
      try {
        const r = await fetch(`${base}/bubble?since=${version}`, { cache: 'no-store', signal: AbortSignal.timeout(25000) });
        await apply(await r.json());
      } catch {
        base = null;                              // look for it again
      }
    }
  } finally {
    looping = false;
  }
}

// Workers sleep. Every way this one wakes up re-opens the question.
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('rhythm', { periodInMinutes: 0.5 }); loop(); });
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('rhythm', { periodInMinutes: 0.5 }); loop(); });
chrome.alarms.onAlarm.addListener(() => loop());
chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'wake') loop(); });
loop();
