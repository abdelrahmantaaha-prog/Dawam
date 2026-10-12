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
    /* Public sites by domain. Local ones (this computer's address, port and
       all) cannot be said as a domain, so each gets a rule of its own that
       allows exactly that address — in both of its spellings. */
    const all = [...(rules.domains || []), ...(rules.signIn || [])];
    const domains = all.filter((d) => splitHost(d).name !== '127.0.0.1');
    if (domains.length) {
      add.push({ id: 2, priority: 2, action: { type: 'allow' }, condition: { requestDomains: domains, resourceTypes: ['main_frame'] } });
    }
    all.filter((d) => splitHost(d).name === '127.0.0.1').forEach((d, i) => {
      const { port } = splitHost(d);
      const at = port ? `:${port}` : '(:\\d+)?';
      add.push({ id: 500 + i, priority: 2, action: { type: 'allow' }, condition: { regexFilter: `^https?://(127\\.0\\.0\\.1|localhost)${at}(/|$)`, resourceTypes: ['main_frame'] } });
    });
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
  // Rules first: a blocked tab reloads its page as soon as storage says the
  // page is allowed, and it must not meet the old rules on the way.
  const changed = await installRules(rules);
  // Storage is also what the popup and blocked.js read. Writing it is an
  // extension call, which keeps this worker awake between questions.
  await chrome.storage.session.set({ bubble: state || null, connected: !!state, at: Date.now() });
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
chrome.runtime.onStartup.addListener(() => {
  // Brave just started: the tabs it brings back are not links from other apps.
  chrome.storage.session.set({ startedAt: Date.now() });
  chrome.alarms.create('rhythm', { periodInMinutes: 0.5 });
  loop();
});
chrome.alarms.onAlarm.addListener(() => loop());
/* "Let this site in" from blocked.html. Only this worker talks to Rhythm, and
   Rhythm only accepts it from an extension, with the header below. */
async function letIn(url) {
  if (!base) base = await findRhythm();
  if (!base) return { ok: false };
  try {
    const r = await fetch(`${base}/bubble/add`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Rhythm': '1' },
      body: JSON.stringify({ url }), signal: AbortSignal.timeout(4000)
    });
    return await r.json();
  } catch { return { ok: false }; }
}

/* Links from other apps, during a round.

   A link clicked in Corpus, Claude, an email or a PDF opens in Brave, the
   default browser. While a bubble runs, Rhythm would rather it opened in the
   bubble browser — so the tab is offered to Rhythm, and closed here if Rhythm
   took it. The rest of the time Brave is left to be Brave.

   What counts as "a link from another app": a page Brave opened because a
   program asked it to — Brave marks that navigation "start_page" (seen on
   this machine; Chromium documents "auto_toplevel" for the same thing, so
   both count) — in an ordinary window. Not a bookmark, not an address typed here, not a
   link followed inside Brave, not an app window (Corpus shows itself in
   one), not the tabs Brave brings back when it starts, and not a page Rhythm
   itself sent to Brave (Rhythm turns those down). */
async function offer(details) {
  if (details.frameId !== 0 || !['start_page', 'auto_toplevel'].includes(details.transitionType)) return;
  const { bubble, startedAt } = await chrome.storage.session.get(['bubble', 'startedAt']);
  if (!bubble || !bubble.active) return;
  if (startedAt && Date.now() - startedAt < 10000) return;
  let url = details.url;
  if (url.startsWith(BLOCKED)) url = decodeURIComponent(url.slice(BLOCKED.length + 1));
  if (!/^https?:/.test(url)) return;
  try {
    const tab = await chrome.tabs.get(details.tabId);
    const win = await chrome.windows.get(tab.windowId);
    if (win.type !== 'normal') return;
  } catch { return; }
  if (!base) base = await findRhythm();
  if (!base) return;
  try {
    const r = await fetch(`${base}/bubble/take`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Rhythm': '1' },
      body: JSON.stringify({ url }), signal: AbortSignal.timeout(4000)
    });
    const { taken } = await r.json();
    if (taken) await chrome.tabs.remove(details.tabId);
  } catch { /* Rhythm away: the tab stays in Brave */ }
}
chrome.webNavigation.onCommitted.addListener((d) => { offer(d); });

chrome.runtime.onMessage.addListener((m, _sender, reply) => {
  if (m && m.type === 'wake') loop();
  if (m && m.type === 'add') { letIn(m.url).then(reply); loop(); return true; }
  return false;
});
loop();
