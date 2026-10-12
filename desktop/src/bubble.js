/* What is inside a bubble, and whether the window in front of you is.

   A bubble is a focus mode made of things rather than words. A focus mode
   used to be a list of keywords matched anywhere in "title + app + domain",
   which leaked both ways: allowing "docs" let in a video called "React docs",
   and allowing "code" let in anything that said code. A bubble item is an
   identity instead:

     app    a program, known by the file it runs from. Dropped as an .exe or a
            shortcut, or picked from the windows that are open. A browser
            dropped as an app means that browser with any site in it.
     site   a domain. docs.google.com allows docs.google.com and anything
            under it, and nothing else of Google.
     word   the old keyword, kept so focus modes made before bubbles keep
            working exactly as they did. Matched the old way.

   Everything here is pure — no Electron, no Windows — so the rules can be
   tested without either. */

const path = require('path');

const BROWSERS = ['chrome', 'msedge', 'brave', 'firefox', 'opera', 'vivaldi', 'arc', 'zen', 'iron', 'librewolf'];

// Domains a sign-in bounces through. A bubble holding docs.google.com has to
// let the Google sign-in page load, or the site in the bubble is unusable.
// Only the sign-in hosts themselves, never the products around them.
const SIGN_IN_HOSTS = [
  'accounts.google.com', 'accounts.youtube.com', 'login.microsoftonline.com', 'login.live.com',
  'login.microsoft.com', 'appleid.apple.com', 'idmsa.apple.com', 'github.com/login'
];

const lc = (s) => String(s == null ? '' : s).toLowerCase().trim();
const bare = (host) => lc(host).replace(/^(www|m)\./, '');
const exeBase = (p) => lc(path.win32.basename(lc(p))).replace(/\.exe$/, '');

/* This computer's own addresses. Local apps (Corpus, for one) serve their
   pages here, and "localhost" and 127.0.0.1 are the same place. */
const LOCAL = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;

/* A host as { name, port }: "www." dropped, every local spelling made one. */
function splitHost(h) {
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(lc(h));
  if (!m) return { name: '', port: '' };
  const name = bare(m[1]);
  return { name: LOCAL.test(name) ? '127.0.0.1' : name, port: m[2] || '' };
}
const isLocalSite = (domain) => splitHost(domain).name === '127.0.0.1';

/* A site out of whatever was dropped or typed: a full URL, a bare host,
   "www." and a path included. Null when there is no site in it.

   A public site is its domain, and its port is dropped. A local one keeps
   its port — 127.0.0.1:5400 is Corpus and 127.0.0.1:3000 is whatever else
   happens to be running, and letting one in must not let in the other. */
function domainOf(input) {
  let s = lc(input);
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const { name, port } = splitHost(s.split(/[/?#\s]/)[0]);
  if (name === '127.0.0.1') return port ? `127.0.0.1:${port}` : '127.0.0.1';
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(name) ? name : null;
}

function isBrowserProcess(proc) {
  return BROWSERS.includes(exeBase(proc));
}

/* One item in its stored shape, or null for anything unusable. Unknown fields
   (an icon, a launch target) ride along untouched. */
function normalizeItem(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') return wordOrSite(raw);
  const kind = raw.kind;
  if (kind === 'site') {
    const domain = domainOf(raw.domain || raw.url || raw.name);
    return domain ? { ...raw, kind: 'site', domain, name: String(raw.name || domain) } : null;
  }
  if (kind === 'app') {
    const exe = String(raw.exe || '').trim();
    if (!exe) return null;
    return { ...raw, kind: 'app', exe, name: String(raw.name || exeBase(exe)) };
  }
  if (kind === 'word') {
    const text = lc(raw.text || raw.name);
    return text ? { kind: 'word', text } : null;
  }
  return null;
}

// A typed line: a domain if it is one, else the old keyword.
function wordOrSite(s) {
  const text = lc(s);
  if (!text) return null;
  const domain = /[./]/.test(text) ? domainOf(text) : null;
  return domain ? { kind: 'site', domain, name: domain } : { kind: 'word', text };
}

function normalizeItems(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const it = normalizeItem(raw);
    if (!it) continue;
    const key = itemKey(it);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function itemKey(it) {
  if (it.kind === 'app') return `app:${lc(it.exe)}`;
  if (it.kind === 'site') return `site:${it.domain}`;
  return `word:${it.text}`;
}

/* The focus modes saved before bubbles hold only `allowed`, a list of
   keywords. They become word items one for one — not sites, even when a line
   looks like a domain, because a word also matched the window title and
   quietly narrowing what an old mode lets through would be a surprise. */
function itemsOfMode(mode) {
  if (!mode) return [];
  if (Array.isArray(mode.items)) return normalizeItems(mode.items);
  return (Array.isArray(mode.allowed) ? mode.allowed : [])
    .map((w) => lc(w)).filter(Boolean).map((text) => ({ kind: 'word', text }));
}

/* The keywords a mode still answers to, for anything that only speaks the old
   language (the planner's text field, an older planner build). */
function wordsOfItems(items) {
  return normalizeItems(items).map((it) => (
    it.kind === 'app' ? exeBase(it.exe) : it.kind === 'site' ? it.domain : it.text
  ));
}

function siteMatches(domain, host) {
  const d = splitHost(domain), h = splitHost(host);
  if (!h.name) return false;
  if (d.name === '127.0.0.1') return h.name === '127.0.0.1' && (!d.port || d.port === h.port);
  return h.name === d.name || h.name.endsWith(`.${d.name}`);
}

/* Is this the window called `name`? Its title starts with the name as a
   whole word — "Corpus" and "Corpus — Inbox", not "Corpuscle". */
function titled(title, name) {
  const t = lc(title), n = lc(name);
  return n.length >= 3 && t.startsWith(n) && !/[a-z0-9؀-ۿ]/i.test(t.charAt(n.length));
}

function signingIn(host) {
  const h = bare(host);
  return !!h && SIGN_IN_HOSTS.some((s) => !s.includes('/') && (h === s || h.endsWith(`.${s}`)));
}

/* Is this window inside the bubble?

   sample: { title, process, path, host } from the foreground watcher.
   items:  the bubble's items.
   words:  extra keywords allowed under every bubble (Always allowed).

   A browser window is judged by its site. Its program only counts when the
   browser itself was put in the bubble — "Brave, any site". When the address
   cannot be read the title is the only evidence there is, and it is used:

     - a site is looked for by its name (what it was called when it went in)
       or, for a public site, by its main word (github for github.com);
     - an app is looked for by its name. This is the app window a local
       program opens in a browser — Corpus's launcher shows Corpus in a Brave
       window with no address bar, titled "Corpus". That window IS the app in
       the bubble, and the browser's name on the process must not hide it. */
function inBubble(sample, items, words = []) {
  const title = String(sample.title || '');
  const proc = lc(sample.process);
  const exe = lc(sample.path);
  const host = lc(sample.host);
  const hay = `${title} ${proc} ${host}`.toLowerCase();
  const list = Array.isArray(items) ? items : [];
  const browser = isBrowserProcess(proc);

  for (const it of list) {
    if (it.kind === 'word') { if (hay.includes(it.text)) return true; continue; }
    /* By the program's file name rather than its whole path: apps that update
       themselves (Discord, Slack, Teams) move to a new versioned folder every
       week, and the item dropped last month must still be the same app. */
    if (it.kind === 'app') {
      if (exeBase(exe || proc) === exeBase(it.exe)) return true;
      if (browser && !host && titled(title, it.name)) return true;
      continue;
    }
    if (it.kind === 'site') {
      if (browser && host && siteMatches(it.domain, host)) return true;
      if (browser && !host) {
        if (it.name && it.name !== it.domain && titled(title, it.name)) return true;
        const word = isLocalSite(it.domain) ? '' : it.domain.split('.').slice(-2, -1)[0];
        if (word && hay.includes(word)) return true;
      }
    }
  }
  if (browser && host && list.some((it) => it.kind === 'site') && signingIn(host)) return true;
  return (words || []).some((k) => k && hay.includes(lc(k)));
}

/* The sites a bubble lets a browser open, for the browsers that enforce it
   themselves: Rhythm's own bubble browser and the Brave extension. Null means
   no limit at all — the bubble has no sites and no keywords that could name
   one, so a browser in it is not judged by address. */
function siteRules(items, words = []) {
  const list = normalizeItems(items);
  const domains = list.filter((it) => it.kind === 'site').map((it) => it.domain);
  const keywords = [...list.filter((it) => it.kind === 'word').map((it) => it.text), ...(words || []).map(lc).filter(Boolean)];
  const anyBrowser = list.some((it) => it.kind === 'app' && isBrowserProcess(exeBase(it.exe)));
  if (anyBrowser) return null;
  return { domains, keywords, signIn: SIGN_IN_HOSTS.filter((s) => !s.includes('/')) };
}

/* The same decision for a URL rather than a window: does this address belong
   in the bubble? Keywords are matched against the whole address, the nearest
   thing a URL has to a title. */
function urlAllowed(url, rules) {
  if (!rules) return true;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return true;   // file:, data:, about:, extension pages
  const host = bare(u.hostname);
  if (rules.domains.some((d) => siteMatches(d, u.host))) return true;
  if (rules.signIn.some((s) => host === s || host.endsWith(`.${s}`))) return true;
  const hay = lc(url);
  return rules.keywords.some((k) => hay.includes(k));
}

module.exports = {
  BROWSERS,
  SIGN_IN_HOSTS,
  domainOf,
  isLocalSite,
  exeBase,
  isBrowserProcess,
  normalizeItem,
  normalizeItems,
  itemKey,
  itemsOfMode,
  wordsOfItems,
  inBubble,
  siteRules,
  urlAllowed,
};
