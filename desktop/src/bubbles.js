/* Bubbles — the main-process half.

   A bubble is a round in which only the things you put in it can be in front
   of you. session.js decides what is inside (with bubble.js); this file is
   everything around that decision:

     the wall      a calm backdrop over every screen while a bubble runs, with
                   the bubble's apps and sites on it to open. Not on top of
                   anything — the things in the bubble sit above it, and
                   everything else is put away behind it.
     the dock      opening an item: an app is brought forward if it is already
                   running and started if not; a site opens in the bubble
                   browser or in Brave.
     drops         turning whatever was dragged onto the planner (a program, a
                   shortcut, a link, an open window) into an item.
     the browser   Rhythm's own bubble browser. It never loads a page outside
                   the bubble — the page is refused before it is fetched, which
                   no amount of window-watching can do for another browser. It
                   can carry the extensions you use in Brave.
     the bridge    a tiny local server the Rhythm extension in Brave listens
                   to, so Brave holds itself to the bubble too.

   Nothing here reaches the internet. The bridge listens on 127.0.0.1 only and
   only ever says what the bubble is. */

const { BrowserWindow, WebContentsView, Menu, app, screen, session, shell, nativeImage, ipcMain, clipboard, dialog } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { normalizeItems, domainOf, isLocalSite, exeBase, isBrowserProcess, urlAllowed } = require('./bubble');

const BRIDGE_PORTS = [47615, 47616, 47617];
const BROWSER_PARTITION = 'persist:bubble';
const CHROME_H = 78; // the bubble browser's tab strip + toolbar, in px

function createBubbles({ store, sessions, enforcer, icon, preload, winFile, notify, showPlanner, isQuitting }) {
  /* ------------------------------------------------------------------ */
  /*  The wall                                                          */
  /* ------------------------------------------------------------------ */
  let wallWins = [];
  let roundItems = [];   // the running bubble's items, icons included

  const wallWanted = (s) => s.phase === 'work' && s.strict && store.data.settings.bubbleWall !== false;

  function showWall() {
    if (wallWins.length) return;
    const primary = screen.getPrimaryDisplay().id;
    for (const d of screen.getAllDisplays()) {
      const win = new BrowserWindow({
        ...d.workArea,
        frame: false, skipTaskbar: true, resizable: false, movable: false,
        minimizable: false, maximizable: false, fullscreenable: false,
        backgroundColor: '#0E1A17', icon: icon(), title: 'Rhythm bubble',
        show: false,
        webPreferences: { preload }
      });
      win.on('close', (e) => { if (!isQuitting()) e.preventDefault(); });
      win.loadFile(winFile('wall.html'), { query: { main: d.id === primary ? '1' : '0' } });
      win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show(); });
      wallWins.push(win);
    }
  }

  function hideWall() {
    for (const w of wallWins) if (!w.isDestroyed()) w.destroy();
    wallWins = [];
  }

  /* ------------------------------------------------------------------ */
  /*  The bubble bar, in place of the Windows taskbar                   */
  /*                                                                    */
  /*  While a bubble runs the taskbar is hidden on every screen and a    */
  /*  bar of the bubble's own takes its strip. Windows keeps that strip  */
  /*  reserved while the taskbar is hidden (checked on this machine: the */
  /*  work area does not move), so nothing maximized goes under the bar  */
  /*  and no Windows setting is touched — hiding a window is the whole   */
  /*  change. The taskbar comes back when the round ends; and because a  */
  /*  Rhythm that is killed mid-round cannot put it back, the fact that  */
  /*  it was hidden is written down, and the next launch restores it.    */
  /* ------------------------------------------------------------------ */
  let barWins = [];
  let barStrips = null;   // display id -> the strip the taskbar held, measured before hiding it
  let barTimer = null;
  const barWanted = (s) => s.phase === 'work' && s.strict && store.data.settings.bubbleTaskbar !== false;

  /* The part of a screen the taskbar reserves: whatever lies outside its
     work area, on whichever edge. A screen with no taskbar (or an auto-
     hiding one) has none; the main screen then gets a bar laid over its
     bottom edge instead. */
  function stripOf(d) {
    const b = d.bounds, w = d.workArea;
    if (w.y + w.height < b.y + b.height) return { x: b.x, y: w.y + w.height, width: b.width, height: b.y + b.height - (w.y + w.height), vertical: false };
    if (w.y > b.y) return { x: b.x, y: b.y, width: b.width, height: w.y - b.y, vertical: false };
    if (w.x > b.x) return { x: b.x, y: b.y, width: w.x - b.x, height: b.height, vertical: true };
    if (w.x + w.width < b.x + b.width) return { x: w.x + w.width, y: b.y, width: b.x + b.width - (w.x + w.width), height: b.height, vertical: true };
    return null;
  }

  function setTaskbarHidden(hidden) {
    enforcer.send(`taskbar ${hidden ? 'hide' : 'show'}`);
    if (!!store.data.settings.taskbarHiddenByRhythm !== hidden) {
      store.data.settings.taskbarHiddenByRhythm = hidden;
      store.save();
    }
  }

  function showBar() {
    if (barWins.length) return;
    const primary = screen.getPrimaryDisplay().id;
    if (!barStrips) {
      barStrips = new Map();
      for (const d of screen.getAllDisplays()) {
        const strip = stripOf(d) || (d.id === primary
          ? { x: d.bounds.x, y: d.bounds.y + d.bounds.height - 44, width: d.bounds.width, height: 44, vertical: false }
          : null);
        if (strip) barStrips.set(d.id, strip);
      }
    }
    for (const [, strip] of barStrips) {
      const win = new BrowserWindow({
        x: strip.x, y: strip.y, width: strip.width, height: strip.height,
        frame: false, skipTaskbar: true, resizable: false, movable: false,
        minimizable: false, maximizable: false, fullscreenable: false,
        alwaysOnTop: true, show: false, backgroundColor: '#0E1A17', icon: icon(), title: 'Rhythm bubble bar',
        webPreferences: { preload }
      });
      win.setAlwaysOnTop(true, 'pop-up-menu');
      win.on('close', (e) => { if (!isQuitting()) e.preventDefault(); });
      win.loadFile(winFile('bar.html'), { query: { vertical: strip.vertical ? '1' : '0' } });
      // Shown without taking the focus from whatever you were doing.
      win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive(); });
      barWins.push(win);
    }
    setTaskbarHidden(true);
    /* Every few seconds while the bar is up: which of the bubble's apps are
       open (for the marks under them), and the taskbar hidden again — File
       Explorer restarting brings a fresh one back. */
    barTimer = setInterval(async () => {
      enforcer.send('taskbar hide');
      const ans = await enforcer.ask('list', '', 4000);
      const open = [...new Set(((ans && ans.windows) || []).map((w) => exeBase(w.path || w.process)).filter(Boolean))];
      for (const w of barWins) if (!w.isDestroyed()) w.webContents.send('bar-running', open);
    }, 3000);
  }

  function hideBar() {
    clearInterval(barTimer);
    barTimer = null;
    for (const w of barWins) if (!w.isDestroyed()) w.destroy();
    barWins = [];
    barStrips = null;
    setTaskbarHidden(false);
  }

  function onState(s) {
    if (s.phase === 'idle') roundItems = [];
    if (wallWanted(s)) showWall(); else if (wallWins.length) hideWall();
    if (barWanted(s)) showBar(); else if (barWins.length) hideBar();
    for (const w of [...wallWins, ...barWins]) if (!w.isDestroyed()) w.webContents.send('state', s);
    applyRules();
  }

  /* Monitors changed: the walls and bars were sized for screens that may be
     gone. The strips are measured again only when the taskbar is showing —
     with it hidden, they are the ones measured before. */
  function refit() {
    const s = sessions.getState();
    if (wallWins.length) { hideWall(); if (wallWanted(s)) showWall(); }
    if (barWins.length) {
      for (const w of barWins) if (!w.isDestroyed()) w.destroy();
      barWins = [];
      clearInterval(barTimer);
      const known = barStrips;
      barStrips = known && new Map([...known].filter(([id]) => screen.getAllDisplays().some((d) => d.id === id)));
      if (barWanted(s)) showBar(); else setTaskbarHidden(false);
    }
  }

  // A previous Rhythm hid the taskbar and never got to show it again.
  function restoreTaskbar() {
    if (store.data.settings.taskbarHiddenByRhythm) setTaskbarHidden(false);
  }

  function startRound(items) {
    roundItems = normalizeItems(items);
  }

  /* Letting a site into the running bubble, from wherever the person is when
     they need it: the planner, the wall, or the "not in this bubble" page in
     either browser. The site — not the one page — goes in, like a dropped
     link. Null when there is no bubble running or no site in the input. */
  function addSite(input) {
    const site = resolveUrl(input);
    if (!site) return null;
    const fresh = sessions.addToRound([site]);
    if (fresh.length) roundItems = normalizeItems([...roundItems, ...fresh]);
    const s = sessions.getState();
    if (s.phase !== 'work' || !s.strict) return null;
    return site;
  }

  /* ------------------------------------------------------------------ */
  /*  Opening an item                                                   */
  /* ------------------------------------------------------------------ */
  function braveExe() {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const r of roots) {
      const p = path.join(r, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe');
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  async function openItem(raw) {
    const [item] = normalizeItems([raw]);
    if (!item) return { ok: false, error: 'unknown' };
    if (item.kind === 'site') return openSite(item.url || `${isLocalSite(item.domain) ? 'http' : 'https'}://${item.domain}`);
    if (item.kind !== 'app') return { ok: false, error: 'unknown' };

    // Running already: bring it forward rather than starting a second copy.
    const ans = await enforcer.ask('activate', exeBase(item.exe));
    if (ans && ans.ok) return { ok: true, how: 'focused' };

    const target = item.launch || item.exe;
    if (/^shell:/i.test(target)) {
      spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, how: 'started' };
    }
    /* Store apps live in a folder Windows will not start them from directly.
       Once one is open, the dock can bring it forward; it has to be opened
       from Start the first time. */
    if (/\\windowsapps\\/i.test(target)) {
      notify('Open it from Start', `${item.name} is a Store app — open it once from Start and the bubble will bring it forward after that.`);
      return { ok: false, error: 'store-app' };
    }
    const err = await shell.openPath(target);
    if (err) {
      notify('Could not open it', `${item.name}: ${err}`);
      return { ok: false, error: err };
    }
    return { ok: true, how: 'started' };
  }

  /* The browser the bubble's sites open in, opened to work in: Brave in a new
     window, or the bubble browser on its new-tab page (which lists the
     bubble's sites). */
  function openBrowserHome() {
    if (store.data.settings.bubbleSites === 'brave') {
      const exe = braveExe();
      if (exe) { spawn(exe, ['--new-window'], { detached: true, stdio: 'ignore' }).unref(); return; }
    }
    openBrowser();
  }

  async function browserIcon() {
    const exe = store.data.settings.bubbleSites === 'brave' ? braveExe() : null;
    return exe ? iconOf(exe) : null;
  }

  /* The sites, as a menu off the browser button: hovering the button opens
     it. A native menu, so it can rise above a 40-pixel bar, and Windows puts
     it above the button by itself when there is no room below. */
  function siteMenu(win, at) {
    const sites = (roundItems.length ? roundItems : sessions.getState().items || []).filter((it) => it.kind === 'site');
    const label = store.data.settings.bubbleSites === 'brave' ? 'Open Brave' : 'Open the bubble browser';
    const menu = Menu.buildFromTemplate([
      { label, click: openBrowserHome },
      ...(sites.length ? [{ type: 'separator' }] : []),
      ...sites.map((it) => ({
        label: it.name && it.name !== it.domain ? `${it.name}  —  ${it.domain}` : it.domain,
        click: () => openSite(it.url || `${isLocalSite(it.domain) ? 'http' : 'https'}://${it.domain}`)
      }))
    ]);
    menu.popup({ window: win, x: Math.round(at && at.x || 0), y: Math.round(at && at.y || 0) });
  }

  function openSite(url) {
    if (store.data.settings.bubbleSites === 'brave') {
      const exe = braveExe();
      if (exe) {
        spawn(exe, [url], { detached: true, stdio: 'ignore' }).unref();
        return { ok: true, how: 'brave' };
      }
    }
    openBrowser(url);
    return { ok: true, how: 'rhythm' };
  }

  /* ------------------------------------------------------------------ */
  /*  Drops                                                             */
  /* ------------------------------------------------------------------ */
  async function iconOf(file) {
    try {
      const img = await app.getFileIcon(file, { size: 'large' });
      return img.isEmpty() ? null : img.toDataURL();
    } catch { return null; }
  }

  const prettyName = (file) => path.win32.basename(file).replace(/\.(exe|lnk|url)$/i, '');

  // An Internet shortcut (.url) is a tiny INI file with the address in it.
  function readUrlFile(file) {
    try {
      const m = fs.readFileSync(file, 'utf8').match(/^URL=(.+)$/m);
      return m ? m[1].trim() : null;
    } catch { return null; }
  }

  async function appItem(exe, launch, name) {
    return { kind: 'app', exe, launch: launch || exe, name: name || prettyName(exe), icon: await iconOf(launch || exe) };
  }

  /* Each dropped file becomes an item, or a reason it could not. A shortcut is
     followed to its program, so the item matches the window the program opens
     — the shortcut itself is kept to start it, because shortcuts often carry
     the arguments that make the program start properly. */
  async function resolvePaths(paths) {
    const items = [], skipped = [];
    for (const p of Array.isArray(paths) ? paths : []) {
      const file = String(p || '');
      const ext = path.extname(file).toLowerCase();
      try {
        if (ext === '.exe') { items.push(await appItem(file)); continue; }
        if (ext === '.lnk') {
          const link = shell.readShortcutLink(file);
          const target = link && link.target;
          if (target && /\.exe$/i.test(target)) { items.push(await appItem(target, file, prettyName(file))); continue; }
          const site = target && domainOf(target);
          if (site) { items.push({ kind: 'site', domain: site, url: target, name: prettyName(file) }); continue; }
        }
        if (ext === '.url') {
          const url = readUrlFile(file);
          const site = url && domainOf(url);
          if (site) { items.push({ kind: 'site', domain: site, url, name: prettyName(file) }); continue; }
        }
      } catch { /* fall through to skipped */ }
      skipped.push(path.win32.basename(file));
    }
    return { items, skipped };
  }

  function resolveUrl(text) {
    const first = String(text || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    const domain = first && domainOf(first);
    if (!domain) return null;
    const url = /^https?:\/\//i.test(first) ? first : `${isLocalSite(domain) ? 'http' : 'https'}://${domain}`;
    return { kind: 'site', domain, url, name: domain };
  }

  /* The windows open right now, one per program, as items to drag in.
     Rhythm, the Windows shell and Task Manager are left out — they are never
     judged, so putting them in a bubble would mean nothing. */
  const NOT_OFFERED = new Set(['rhythm', 'electron', 'explorer', 'taskmgr', 'applicationframehost', 'searchhost', 'shellexperiencehost', 'textinputhost', 'systemsettings']);
  async function running() {
    const ans = await enforcer.ask('list', '', 6000);
    const wins = (ans && Array.isArray(ans.windows)) ? ans.windows : [];
    const seen = new Set();
    const out = [];
    for (const w of wins) {
      const base = exeBase(w.path || w.process);
      if (!base || NOT_OFFERED.has(base) || seen.has(base)) continue;
      seen.add(base);
      const name = (w.description && w.description.length <= 40 ? w.description : '') || prettyName(w.path || w.process);
      out.push({ ...(await appItem(w.path || w.process, w.path, name)), browser: isBrowserProcess(base) });
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /*  The bubble browser                                                */
  /* ------------------------------------------------------------------ */
  let browserWin = null;
  let tabs = [];        // { id, view }
  let activeTab = null;
  let nextTab = 1;
  let ses = null;
  let lastRulesKey = '';

  function bubbleSession() {
    if (ses) return ses;
    ses = session.fromPartition(BROWSER_PARTITION);
    // Sites that refuse "embedded" browsers (Google sign-in, for one) are told
    // the truth about the engine and nothing about the wrapper.
    ses.setUserAgent(ses.getUserAgent().replace(/Electron\/\S+\s?/, '').replace(/rhythm-desktop\/\S+\s?/, '').replace(/Rhythm\/\S+\s?/, ''));
    /* The heart of it: a page outside the bubble is refused before a byte of
       it is fetched. Only whole pages are judged (a tab's page, a frame's
       page is the site's own business); images, scripts and fonts come from
       wherever the allowed page needs them. */
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, cb) => {
      if (details.resourceType !== 'mainFrame') return cb({});
      const rules = sessions.siteRules();
      if (urlAllowed(details.url, rules)) return cb({});
      cb({ cancel: true });
      const tab = tabs.find((t) => !t.view.webContents.isDestroyed() && t.view.webContents.id === details.webContentsId);
      if (tab) setTimeout(() => showBlocked(tab, details.url), 0);
    });
    const ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'media', 'pointerLock']);
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOW.has(permission)));
    loadBraveExtensions();
    return ses;
  }

  function showBlocked(tab, url) {
    const s = sessions.getState();
    tab.view.webContents.loadFile(winFile('blocked.html'), {
      query: { u: url, name: s.bubbleName || s.task || '', site: domainOf(url) || url }
    });
  }

  function tabInfo(t) {
    const wc = t.view.webContents;
    let url = wc.getURL();
    // A refused page shows its own address, not the file it was swapped for.
    if (url.startsWith('file:') && url.includes('blocked.html')) {
      try { url = new URL(url).searchParams.get('u') || url; } catch { /* keep it */ }
    }
    return {
      id: t.id, title: wc.getTitle() || url || 'New tab', url,
      favicon: t.favicon || null, loading: wc.isLoading(),
      active: t.id === activeTab, back: wc.navigationHistory.canGoBack(), forward: wc.navigationHistory.canGoForward()
    };
  }

  function sendTabs() {
    if (!browserWin || browserWin.isDestroyed()) return;
    browserWin.webContents.send('bb-tabs', tabs.map(tabInfo));
    const t = tabs.find((x) => x.id === activeTab);
    browserWin.setTitle(t ? `${t.view.webContents.getTitle() || 'Bubble browser'} — Rhythm` : 'Bubble browser — Rhythm');
  }

  function layout() {
    if (!browserWin || browserWin.isDestroyed()) return;
    const [w, h] = browserWin.getContentSize();
    for (const t of tabs) {
      t.view.setBounds({ x: 0, y: CHROME_H, width: w, height: Math.max(0, h - CHROME_H) });
      t.view.setVisible(t.id === activeTab);
    }
  }

  const NEW_TAB_PAGE = () => winFile('newtab.html');

  function newTab(url, { activate = true } = {}) {
    if (!browserWin || browserWin.isDestroyed()) return null;
    const view = new WebContentsView({ webPreferences: { session: bubbleSession(), sandbox: true } });
    const t = { id: nextTab++, view, favicon: null };
    tabs.push(t);
    browserWin.contentView.addChildView(view);
    const wc = view.webContents;
    wc.setWindowOpenHandler(({ url: u }) => { newTab(u); return { action: 'deny' }; });
    for (const ev of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'did-navigate', 'did-navigate-in-page']) {
      wc.on(ev, sendTabs);
    }
    wc.on('page-favicon-updated', (_e, icons) => { t.favicon = icons && icons[0]; sendTabs(); });
    /* The refusal page has no bridge to Rhythm (it is a plain page in a
       sandboxed tab), so "let it in" is a navigation to a made-up address
       that is caught here and never leaves the tab. */
    wc.on('will-navigate', (e, url) => {
      if (!url.startsWith('rhythm-add:')) return;
      e.preventDefault();
      const target = decodeURIComponent(url.slice('rhythm-add:'.length));
      if (addSite(target)) wc.loadURL(target);
    });
    wc.on('before-input-event', (e, input) => { if (shortcut(input)) e.preventDefault(); });
    wc.on('context-menu', (_e, p) => contextMenu(t, p));
    if (activate) activeTab = t.id;
    layout();
    if (url) wc.loadURL(normalizeUrl(url)); else wc.loadFile(NEW_TAB_PAGE(), { query: { items: JSON.stringify(siteItemsForNewTab()) } });
    sendTabs();
    return t;
  }

  function siteItemsForNewTab() {
    return (roundItems.length ? roundItems : sessions.getState().items || [])
      .filter((it) => it.kind === 'site').map((it) => ({ name: it.name, url: it.url || `${isLocalSite(it.domain) ? 'http' : 'https'}://${it.domain}` }));
  }

  function normalizeUrl(input) {
    const s = String(input || '').trim();
    if (/^(https?|file|chrome-extension):/i.test(s)) return s;
    if (domainOf(s) && !/\s/.test(s)) return `${isLocalSite(domainOf(s)) ? 'http' : 'https'}://${s}`;
    return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`;
  }

  function closeTab(id) {
    const i = tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const [t] = tabs.splice(i, 1);
    try { browserWin.contentView.removeChildView(t.view); } catch { /* window going */ }
    try { t.view.webContents.close(); } catch { /* already gone */ }
    if (!tabs.length) { browserWin.close(); return; }
    if (activeTab === id) activeTab = tabs[Math.min(i, tabs.length - 1)].id;
    layout(); sendTabs();
  }

  function activate(id) {
    if (!tabs.some((t) => t.id === id)) return;
    activeTab = id; layout(); sendTabs();
    const t = tabs.find((x) => x.id === id);
    t.view.webContents.focus();
  }

  const active = () => tabs.find((t) => t.id === activeTab) || null;

  function shortcut(input) {
    if (input.type !== 'keyDown') return false;
    const k = String(input.key).toLowerCase();
    const t = active();
    if (input.control && k === 't') { newTab(); return true; }
    if (input.control && k === 'w') { if (t) closeTab(t.id); return true; }
    if (input.control && k === 'l') { browserWin.webContents.focus(); browserWin.webContents.send('bb-focus-address'); return true; }
    if ((input.control && k === 'r') || k === 'f5') { if (t) t.view.webContents.reload(); return true; }
    if (input.control && k === 'tab') {
      const i = tabs.findIndex((x) => x.id === activeTab);
      const n = tabs[(i + (input.shift ? tabs.length - 1 : 1)) % tabs.length];
      if (n) activate(n.id);
      return true;
    }
    if (input.alt && k === 'arrowleft') { if (t) t.view.webContents.navigationHistory.goBack(); return true; }
    if (input.alt && k === 'arrowright') { if (t) t.view.webContents.navigationHistory.goForward(); return true; }
    return false;
  }

  function contextMenu(t, p) {
    const wc = t.view.webContents;
    const items = [];
    if (p.linkURL) {
      items.push({ label: 'Open link in new tab', click: () => newTab(p.linkURL) });
      items.push({ label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) });
      items.push({ type: 'separator' });
    }
    if (p.isEditable) {
      items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' });
    } else if (p.selectionText) {
      items.push({ role: 'copy' });
    }
    if (items.length) items.push({ type: 'separator' });
    items.push(
      { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: 'Reload', click: () => wc.reload() }
    );
    Menu.buildFromTemplate(items).popup({ window: browserWin });
  }

  function openBrowser(url) {
    if (!browserWin || browserWin.isDestroyed()) {
      browserWin = new BrowserWindow({
        width: 1200, height: 820, minWidth: 480, minHeight: 360,
        autoHideMenuBar: true, icon: icon(), title: 'Bubble browser — Rhythm',
        backgroundColor: '#0E1A17',
        webPreferences: { preload }
      });
      browserWin.loadFile(winFile('browser.html'));
      browserWin.on('resize', layout);
      browserWin.webContents.on('before-input-event', (e, input) => { if (shortcut(input)) e.preventDefault(); });
      browserWin.on('closed', () => {
        for (const t of tabs) { try { t.view.webContents.close(); } catch { /* gone */ } }
        tabs = []; activeTab = null; browserWin = null;
      });
      browserWin.webContents.once('did-finish-load', () => { newTab(url); sendExtensions(); });
    } else {
      newTab(url);
      if (browserWin.isMinimized()) browserWin.restore();
      browserWin.show(); browserWin.focus();
    }
  }

  /* A bubble starting (or changing) applies to the tabs already open: any
     page outside it is replaced by the refusal, the same as a fresh one. */
  function applyRules() {
    const rules = sessions.siteRules();
    const key = JSON.stringify(rules);
    if (key === lastRulesKey) return;
    lastRulesKey = key;
    bridge.bump();
    for (const t of tabs) {
      const wc = t.view.webContents;
      if (wc.isDestroyed()) continue;
      const url = wc.getURL();
      if (/^https?:/.test(url) && !urlAllowed(url, rules)) showBlocked(t, url);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Brave's extensions, in the bubble browser                         */
  /* ------------------------------------------------------------------ */
  const braveData = () => path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'User Data');
  const verKey = (v) => String(v).split(/[^0-9]+/).filter(Boolean).map(Number);
  const newerFirst = (a, b) => {
    const x = verKey(a), y = verKey(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] || 0) !== (x[i] || 0)) return (y[i] || 0) - (x[i] || 0);
    return 0;
  };

  // "__MSG_appName__" is a key into the extension's own translations.
  function msg(dir, manifest, value) {
    const m = /^__MSG_(.+)__$/.exec(String(value || ''));
    if (!m) return value;
    for (const loc of [manifest.default_locale, 'en', 'en_US'].filter(Boolean)) {
      try {
        const table = JSON.parse(fs.readFileSync(path.join(dir, '_locales', loc, 'messages.json'), 'utf8'));
        const hit = Object.entries(table).find(([k]) => k.toLowerCase() === m[1].toLowerCase());
        if (hit) return hit[1].message;
      } catch { /* try the next locale */ }
    }
    return m[1];
  }

  function readExtension(dir, id, source) {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    return { id, dir, source, version: manifest.version || '', name: msg(dir, manifest, manifest.name) || id, mv: manifest.manifest_version, manifest };
  }

  const sameDir = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  // The Rhythm extension itself has no business in the bubble browser: it
  // holds Brave to the bubble, which this browser already does on its own.
  const isCompanion = (dir) => sameDir(dir, companionFolder())
    || sameDir(dir, path.join(__dirname, '..', '..', 'brave-extension'));

  /* Every extension the bubble browser could carry:

       brave           installed in Brave from a store — the newest version
                       of each, across every profile
       brave-unpacked  loaded unpacked in Brave (developer mode); Brave keeps
                       their folders in its Secure Preferences, location 4
       folder          an unpacked folder picked here, Brave or not

     All are loaded from where they are — nothing is copied — so an extension
     that is updated or edited is the new one the next time it loads. Keys:
     a Brave id for the first two, "folder:" + the path for the third. */
  function braveExtensions() {
    const out = new Map();
    let profiles = [];
    try { profiles = fs.readdirSync(braveData()).filter((n) => n === 'Default' || /^Profile \d+$/.test(n)); } catch { profiles = []; }
    for (const prof of profiles) {
      const root = path.join(braveData(), prof, 'Extensions');
      let ids = [];
      try { ids = fs.readdirSync(root); } catch { ids = []; }
      for (const id of ids) {
        if (out.has(id) || !/^[a-p]{32}$/.test(id)) continue;
        let versions = [];
        try { versions = fs.readdirSync(path.join(root, id)).sort(newerFirst); } catch { continue; }
        for (const v of versions) {
          try { out.set(id, readExtension(path.join(root, id, v), id, 'brave')); break; } catch { /* half-updated folder: try the older one */ }
        }
      }
      let prefs = null;
      try { prefs = JSON.parse(fs.readFileSync(path.join(braveData(), prof, 'Secure Preferences'), 'utf8')); } catch { /* none */ }
      const settings = (prefs && prefs.extensions && prefs.extensions.settings) || {};
      for (const [id, s] of Object.entries(settings)) {
        if (out.has(id) || !s || s.location !== 4 || !s.path || !path.isAbsolute(s.path) || isCompanion(s.path)) continue;
        try { out.set(id, readExtension(s.path, id, 'brave-unpacked')); } catch { /* folder moved or deleted */ }
      }
    }
    for (const dir of store.data.settings.extraExtensions || []) {
      if ([...out.values()].some((e) => sameDir(e.dir, dir)) || isCompanion(dir)) continue;
      const key = `folder:${dir}`;
      try { out.set(key, readExtension(dir, key, 'folder')); } catch {
        out.set(key, { id: key, dir, source: 'folder', name: path.basename(dir), version: '', missing: true, manifest: {} });
      }
    }
    return [...out.values()];
  }

  /* "Load unpacked…": any folder with a manifest in it. It is remembered and
     switched on at once — picking it was the decision. */
  async function pickExtension(win) {
    const r = await dialog.showOpenDialog(win || BrowserWindow.getFocusedWindow(), {
      title: 'Choose an unpacked extension folder', properties: ['openDirectory']
    });
    if (r.canceled || !r.filePaths[0]) return { list: listBraveExtensions() };
    const dir = r.filePaths[0];
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) return { list: listBraveExtensions(), error: 'no-manifest' };
    const known = braveExtensions().find((e) => sameDir(e.dir, dir));
    const key = known ? known.id : `folder:${dir}`;
    if (!known) store.data.settings.extraExtensions = [...(store.data.settings.extraExtensions || []), dir];
    const on = new Set(store.data.settings.braveExtensions || []);
    on.add(key);
    return { list: await setBraveExtensions([...on]) };
  }

  // Only a picked folder can be forgotten; Brave's own come and go with Brave.
  async function forgetExtension(key) {
    if (!String(key).startsWith('folder:')) return listBraveExtensions();
    const dir = String(key).slice('folder:'.length);
    store.data.settings.extraExtensions = (store.data.settings.extraExtensions || []).filter((d) => !sameDir(d, dir));
    return setBraveExtensions((store.data.settings.braveExtensions || []).filter((k) => k !== key));
  }

  const loaded = new Map();     // brave id -> { ext, popup, iconData } | { error }

  function popupOf(ext) {
    const action = ext.manifest.action || ext.manifest.browser_action || {};
    const page = action.default_popup;
    let iconFile = action.default_icon || ext.manifest.icons;
    if (iconFile && typeof iconFile === 'object') {
      const sizes = Object.keys(iconFile).map(Number).sort((a, b) => a - b);
      iconFile = iconFile[sizes.find((s) => s >= 32) || sizes[sizes.length - 1]];
    }
    let iconData = null;
    try { if (iconFile) iconData = nativeImage.createFromPath(path.join(ext.path, iconFile)).toDataURL(); } catch { /* no icon */ }
    return { page, iconData };
  }

  /* Loading can succeed while the extension's background half fails to start
     — it asked for a part of Chrome this browser does not have. Such an
     extension is only partly there, and the settings say so rather than
     reporting it as loaded and leaving the person to wonder. */
  async function loadOne(info) {
    try {
      const ext = await bubbleSession().loadExtension(info.dir, { allowFileAccess: true });
      let partial = false;
      if (info.manifest.background && info.manifest.background.service_worker) {
        await new Promise((r) => setTimeout(r, 1500));
        const running = Object.values(ses.serviceWorkers.getAllRunning() || {});
        partial = !running.some((w) => String(w.scope || '').startsWith(ext.url));
      }
      loaded.set(info.id, { ext, partial, ...popupOf(ext) });
    } catch (err) {
      loaded.set(info.id, { error: String((err && err.message) || err) });
    }
  }

  async function loadBraveExtensions() {
    const want = new Set(store.data.settings.braveExtensions || []);
    for (const info of braveExtensions()) if (want.has(info.id) && !info.missing && !loaded.has(info.id)) await loadOne(info);
    sendExtensions();
  }

  async function setBraveExtensions(ids) {
    const want = (Array.isArray(ids) ? ids : []).map(String);
    store.data.settings.braveExtensions = want;
    store.save();
    if (ses) {
      for (const [id, l] of loaded) {
        if (!want.includes(id)) {
          if (l.ext) { try { ses.removeExtension(l.ext.id); } catch { /* gone */ } }
          loaded.delete(id);
        }
      }
      await loadBraveExtensions();
    }
    return listBraveExtensions();
  }

  function listBraveExtensions() {
    const want = new Set(store.data.settings.braveExtensions || []);
    return braveExtensions().map((e) => {
      const l = loaded.get(e.id);
      return {
        id: e.id, name: e.name, version: e.version, mv: e.mv, on: want.has(e.id),
        source: e.source, dir: e.source === 'brave' ? null : e.dir, missing: !!e.missing,
        loaded: !!(l && l.ext), partial: !!(l && l.partial), error: (l && l.error) || null
      };
    });
  }

  function sendExtensions() {
    if (!browserWin || browserWin.isDestroyed()) return;
    const list = [];
    for (const [id, l] of loaded) if (l.ext && l.page) list.push({ id, name: l.ext.name, icon: l.iconData });
    browserWin.webContents.send('bb-extensions', list);
  }

  // An extension's toolbar button opens its popup page, as it would in Brave.
  let popupWin = null;
  function extensionPopup(id) {
    const l = loaded.get(id);
    if (!l || !l.ext || !l.page) return;
    if (popupWin && !popupWin.isDestroyed()) popupWin.close();
    const [bx, by] = browserWin.getPosition();
    const [bw] = browserWin.getSize();
    popupWin = new BrowserWindow({
      parent: browserWin, width: 380, height: 560, x: bx + bw - 400, y: by + CHROME_H + 30,
      frame: false, resizable: true, skipTaskbar: true, show: false, backgroundColor: '#ffffff',
      webPreferences: { session: bubbleSession(), sandbox: true }
    });
    popupWin.on('blur', () => { if (popupWin && !popupWin.isDestroyed()) popupWin.close(); });
    popupWin.webContents.on('before-input-event', (e, input) => { if (input.key === 'Escape') popupWin.close(); });
    popupWin.loadURL(`${l.ext.url}${String(l.page).replace(/^\//, '')}`);
    popupWin.once('ready-to-show', () => popupWin.show());
  }

  /* ------------------------------------------------------------------ */
  /*  The bridge to Brave                                               */
  /* ------------------------------------------------------------------ */
  const bridge = (() => {
    let version = 1;
    let sweep = 0;            // bumped when Brave should re-check its open tabs now
    let lastSeen = 0;
    const waiting = new Set();
    let server = null;
    let port = null;

    function payload() {
      const s = sessions.getState();
      const rules = sessions.siteRules();
      return {
        v: version, sweep, active: !!rules,
        name: s.bubbleName || '', task: s.task || '',
        endsAt: s.phase === 'work' ? Date.now() + (s.remainingSec || 0) * 1000 : 0,
        rules
      };
    }

    function answer(res) {
      const body = JSON.stringify(payload());
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(body);
    }

    function bump({ nudge = false } = {}) {
      version += 1;
      if (nudge) sweep += 1;
      for (const res of waiting) answer(res);
      waiting.clear();
    }

    /* POST /bubble/add {url} lets a site into the running bubble — the
       extension's "let it in" button. It is the one thing the bridge does
       besides tell, so it is held to the extension: the request must come
       from an extension page and carry a custom header. A web page can do
       neither (the header forces a CORS preflight this server never
       answers), so no site can widen your bubble on its own. */
    function add(req, res) {
      const origin = String(req.headers.origin || '');
      if (!origin.startsWith('chrome-extension://') || req.headers['x-rhythm'] !== '1') {
        res.writeHead(403); res.end(); return;
      }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        let site = null;
        try { site = addSite(JSON.parse(body).url); } catch { /* bad body */ }
        res.writeHead(site ? 200 : 409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: !!site, domain: site ? site.domain : null }));
      });
    }

    /* GET /bubble?since=N holds the request open (up to 20 s) until the bubble
       changes, so Brave hears about a new bubble the moment it starts. */
    function handle(req, res) {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'POST' && url.pathname === '/bubble/add') { add(req, res); return; }
      if (req.method !== 'GET' || url.pathname !== '/bubble') { res.writeHead(404); res.end(); return; }
      lastSeen = Date.now();
      const since = Number(url.searchParams.get('since'));
      if (since !== version) { answer(res); return; }
      waiting.add(res);
      const timer = setTimeout(() => { if (waiting.delete(res)) answer(res); }, 20000);
      res.on('close', () => { clearTimeout(timer); waiting.delete(res); lastSeen = Date.now(); });
    }

    function listen(i = 0) {
      if (i >= BRIDGE_PORTS.length) return;
      const srv = http.createServer(handle);
      srv.on('error', () => listen(i + 1));
      srv.listen(BRIDGE_PORTS[i], '127.0.0.1', () => { server = srv; port = BRIDGE_PORTS[i]; });
    }

    return {
      start: () => listen(0),
      stop: () => { try { server && server.close(); } catch { /* down */ } },
      bump,
      // Brave is listening right now: a request is held open, or one arrived recently.
      connected: () => waiting.size > 0 || Date.now() - lastSeen < 25000,
      status: () => ({ port, connected: waiting.size > 0 || Date.now() - lastSeen < 25000, lastSeen })
    };
  })();

  /* A Brave window on a site outside the bubble. When the extension is
     listening it is told to deal with the tab itself — the tab is swapped for
     the refusal and the rest of Brave stays where it was. Minimizing the
     whole window is the fallback, if a few seconds pass and the tab is still
     in front. */
  const nudged = new Map(); // hwnd -> first nudge time
  function handOffToBrave(block, sample) {
    if (!block.browser || exeBase(sample.process) !== 'brave' || !block.host || !bridge.connected()) return false;
    const first = nudged.get(block.offender);
    if (!first) { nudged.set(block.offender, Date.now()); bridge.bump({ nudge: true }); return true; }
    if (Date.now() - first < 4000) return true;
    nudged.delete(block.offender);
    return false;
  }

  /* The extension lives in Rhythm's own data folder, copied there from the
     app on every launch. Brave remembers an unpacked extension by its folder,
     so the folder must not move when Rhythm is updated or reinstalled. */
  let companionDir = null;
  function companionFolder() {
    if (companionDir) return companionDir;
    const src = app.isPackaged
      ? path.join(process.resourcesPath, 'brave-extension')
      : path.join(__dirname, '..', '..', 'brave-extension');
    companionDir = path.join(app.getPath('userData'), 'brave-extension');
    try { fs.cpSync(src, companionDir, { recursive: true, force: true }); } catch { /* keep whatever is there */ }
    return companionDir;
  }

  /* ------------------------------------------------------------------ */
  /*  IPC                                                               */
  /* ------------------------------------------------------------------ */
  function wire() {
    ipcMain.handle('bubble-items', () => roundItems);
    ipcMain.handle('bubble-open', (_e, item) => openItem(item));
    ipcMain.handle('bubble-resolve-paths', (_e, paths) => resolvePaths(paths));
    ipcMain.handle('bubble-resolve-url', (_e, text) => resolveUrl(text));
    ipcMain.handle('bubble-running', () => running());
    ipcMain.handle('bubble-add-site', (_e, input) => addSite(input));
    // File Explorer, from the bubble bar — never judged, so always openable.
    ipcMain.handle('bubble-browser-home', () => openBrowserHome());
    ipcMain.handle('bubble-browser-icon', () => browserIcon());
    ipcMain.handle('bubble-site-menu', (e, at) => siteMenu(BrowserWindow.fromWebContents(e.sender), at));
    ipcMain.handle('bubble-open-files',() => { spawn('explorer.exe', [], { detached: true, stdio: 'ignore' }).unref(); });
    ipcMain.handle('bubble-browser', (_e, url) => { openBrowser(url); });
    ipcMain.handle('bubble-brave-extensions', () => listBraveExtensions());
    ipcMain.handle('bubble-set-brave-extensions', (_e, ids) => setBraveExtensions(ids));
    ipcMain.handle('bubble-pick-extension', (e) => pickExtension(BrowserWindow.fromWebContents(e.sender)));
    ipcMain.handle('bubble-forget-extension', (_e, key) => forgetExtension(key));
    ipcMain.handle('bubble-companion', () => ({ folder: companionFolder(), brave: !!braveExe(), ...bridge.status() }));
    ipcMain.handle('bubble-companion-open', () => shell.openPath(companionFolder()));

    ipcMain.handle('bb-navigate', (_e, url) => { const t = active(); if (t) t.view.webContents.loadURL(normalizeUrl(url)); else newTab(url); });
    ipcMain.handle('bb-new-tab', (_e, url) => { newTab(url); });
    ipcMain.handle('bb-close-tab', (_e, id) => closeTab(id));
    ipcMain.handle('bb-activate', (_e, id) => activate(id));
    ipcMain.handle('bb-back', () => { const t = active(); if (t) t.view.webContents.navigationHistory.goBack(); });
    ipcMain.handle('bb-forward', () => { const t = active(); if (t) t.view.webContents.navigationHistory.goForward(); });
    ipcMain.handle('bb-reload', () => { const t = active(); if (t) t.view.webContents.reload(); });
    ipcMain.handle('bb-ext-popup', (_e, id) => extensionPopup(id));
    ipcMain.handle('bb-ready', () => { sendTabs(); sendExtensions(); });
  }

  return {
    wire,
    onState,
    refit,
    startRound,
    handOffToBrave,
    openBrowser,
    setBraveExtensions,
    addSite,
    startBridge: () => { bridge.start(); companionFolder(); },
    restoreTaskbar,
    stop: () => { bridge.stop(); hideWall(); if (barWins.length) hideBar(); },
  };
}

module.exports = { createBubbles, BRIDGE_PORTS };
