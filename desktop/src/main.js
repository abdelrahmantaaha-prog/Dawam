/* Rhythm desktop — the planner and the focus suite in one process.

   The planner is Rhythm's own web build, loaded into the main window. The
   focus half is Anchor, brought over whole: the same PowerShell foreground
   poller, the same session state machine, the same overlay / break / away
   windows. What is new is the seam between them — a focus round can be
   started from a real planned task, and when the round ends the planner is
   told, so the task can be ticked off and its true duration remembered.

   Nothing here reaches the network. The planner talks to its own sync API
   only if the build was given VITE_API_BASE. */

const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, screen, protocol, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('./store');
const SessionManager = require('./session');
const { startPoller, startEnforcer } = require('./poller');
const { fitRect } = require('./fit');
const calendar = require('./calendar');
const { createBubbles } = require('./bubbles');
const { normalizeItems, wordsOfItems } = require('./bubble');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const DEV = process.argv.includes('--dev');
const DEV_URL = process.env.RHYTHM_DEV_URL || 'http://127.0.0.1:5199';
/* Where the planner's built output lives.

   In the repo it is the sibling `dist/` that `npm run desktop:build` writes.
   A packaged build carries the same folder as an extra resource, so it lands
   next to app.asar in resources/ rather than two levels up. */
const DIST = app.isPackaged
  ? path.join(process.resourcesPath, 'dist')
  : path.join(__dirname, '..', '..', 'dist');

/* The planner is served from rhythm://app rather than file://.

   Origin is the reason. Rhythm keeps everything in localStorage, and
   localStorage is keyed by origin — file:// gives each document its own
   opaque one, and a localhost server would move the data every time the port
   changed. A registered standard scheme is one fixed, secure origin for the
   life of the app, so a plan written today is still there after an update. */
protocol.registerSchemesAsPrivileged([
  { scheme: 'rhythm', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain', '.map': 'application/json'
};

function serveDist(req) {
  const url = new URL(req.url);
  let rel = decodeURIComponent(url.pathname);
  // Single-page app: anything without a file extension is a route, not a file.
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.join(DIST, path.normalize(rel).replace(/^[\\/]+/, ''));
  // path.normalize collapses "..", but a crafted path could still climb out.
  if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
  try {
    const body = fs.readFileSync(file);
    return new Response(body, { headers: { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let planner = null;   // the Rhythm window — the app's face
  let overlay = null;
  let tray = null;
  let quitting = false;
  /* Uncloseable, deliberately.

     Rhythm is what holds the day together, so a day cannot begin by closing
     it. Every window's close button already hides rather than destroys; this
     flag finishes the job by refusing app.quit() itself, and the tray has no
     Quit for it to be asked from.

     Two doors stay open, both on purpose. Windows signing out or shutting
     down sets this true — refusing there would hold the whole machine
     hostage. And a --dev launch starts true, because development cannot mean
     reaching for Task Manager on every reload; a packaged build launched with
     --dev only points itself at a dev server that is not running, so it is no
     bypass. Everyone else's way out is Task Manager or the uninstaller — the
     same weight as any other decision you should have to mean. */
  let allowQuit = DEV;
  let poller = null;
  let enforcer = null;
  let breakWins = [];
  let presenceWin = null;
  let awayWins = [];
  let lockWins = [];
  let lockTimer = null;
  let lastPresentAt = Date.now();
  let awaySuppressed = false; // manual dismiss holds until the camera sees a face again
  let awayPaused = false; // we paused the session because the chair emptied
  let camFailed = false; // permanent: no camera / permission denied
  let camRetryAt = 0; // transient failure (camera busy in a call): retry after this

  const store = new Store();
  let sessions = null;
  let bubbles = null;   // the wall, the dock, the bubble browser, the bridge to Brave

  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  const icon = () => nativeImage.createFromPath(iconPath);
  const winFile = (name) => path.join(__dirname, 'windows', name);
  const preload = path.join(__dirname, 'preload.js');

  function broadcast(channel, payload) {
    for (const win of [planner, overlay, ...breakWins, ...awayWins]) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }

  // Full-screen black break screens, one per display — a forced screensaver
  // so breaks are actually taken away from the PC.
  function showBreakScreens() {
    if (breakWins.length) return;
    for (const d of screen.getAllDisplays()) {
      const win = new BrowserWindow({
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
        frame: false,
        fullscreen: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        backgroundColor: '#000000',
        icon: icon(),
        webPreferences: { preload }
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.on('close', (e) => {
        // Alt+F4 shouldn't be a cheap exit — skipping requires the hold button.
        if (!quitting) e.preventDefault();
      });
      win.loadFile(winFile('break.html'));
      breakWins.push(win);
    }
  }

  function hideBreakScreens() {
    for (const win of breakWins) {
      if (!win.isDestroyed()) win.destroy();
    }
    breakWins = [];
  }

  // Chair detection: a hidden window samples the webcam through a local face
  // detector while a work session runs. webSecurity is off ONLY here so the
  // detector can fetch its wasm + model over file:// — the window never loads
  // remote content.
  function ensurePresenceWindow(state) {
    // An away-pause must NOT tear down the camera — it's the only way to
    // notice the user coming back.
    const want =
      state.phase === 'work' &&
      (!state.paused || awayPaused) &&
      store.data.settings.chairDetect &&
      !camFailed;
    if (want && !presenceWin && Date.now() >= camRetryAt) {
      lastPresentAt = Date.now(); // camera warm-up grace
      presenceWin = new BrowserWindow({
        show: false,
        webPreferences: { preload, webSecurity: false, backgroundThrottling: false }
      });
      presenceWin.webContents.on('console-message', (_e, level, message) => {
        if (level >= 2) console.error('[presence]', message);
      });
      presenceWin.loadFile(winFile('presence.html'));
    } else if (!want && presenceWin) {
      if (!presenceWin.isDestroyed()) presenceWin.destroy();
      presenceWin = null;
      hideAwayScreens();
    }
  }

  function showAwayScreens() {
    if (awayWins.length) return;
    for (const d of screen.getAllDisplays()) {
      const win = new BrowserWindow({
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
        frame: false,
        fullscreen: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        backgroundColor: '#000000',
        icon: icon(),
        webPreferences: { preload }
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.on('close', (e) => {
        if (!quitting) e.preventDefault();
      });
      win.loadFile(winFile('away.html'));
      awayWins.push(win);
    }
    // The empty chair stops the clock — away time shouldn't eat the round.
    const s = sessions.getState();
    if (s.phase === 'work' && !s.paused) {
      awayPaused = true;
      // Exempt from the pause budget: nobody chose this, and it ends when they
      // sit back down.
      sessions.pause({ auto: true });
    }
  }

  function hideAwayScreens() {
    for (const win of awayWins) {
      if (!win.isDestroyed()) win.destroy();
    }
    awayWins = [];
    if (awayPaused) {
      awayPaused = false;
      const s = sessions.getState();
      if (s.phase === 'work' && s.paused) sessions.resume();
    }
  }

  /* ---- commitment lock ----
     The same full-screen always-on-top pattern as the break and away screens,
     with one difference: the planner window is allowed ABOVE it, because the
     way out of the lock is through the planner — plan the task, start the
     round. showLockScreens raises the planner a level for exactly that. */
  /* No grace period. There used to be one — a completed hold on the lock
     screen bought a few minutes outside — and the test it failed was not
     technical: it became the ordinary way to open the laptop rather than the
     exception it was drawn as. The only thing that lifts the lock now is a
     round actually running. */
  function lockWanted() {
    if (!store.data.settings.commitmentMode) return false;
    const s = sessions.getState();
    return s.phase === 'idle';
  }

  function showLockScreens() {
    if (lockWins.length) return;
    for (const d of screen.getAllDisplays()) {
      const win = new BrowserWindow({
        x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
        frame: false, fullscreen: true, alwaysOnTop: true, skipTaskbar: true,
        backgroundColor: '#0B0F14', icon: icon(),
        webPreferences: { preload }
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.on('close', (e) => { if (!quitting) e.preventDefault(); });
      win.loadFile(winFile('lock.html'));
      lockWins.push(win);
    }
    // The planner must sit above the lock — it is the door, not a bypass.
    if (planner && !planner.isDestroyed()) {
      planner.setAlwaysOnTop(true, 'screen-saver', 1);
      planner.show();
      planner.focus();
    }
  }

  function hideLockScreens() {
    for (const win of lockWins) { if (!win.isDestroyed()) win.destroy(); }
    lockWins = [];
    if (planner && !planner.isDestroyed()) planner.setAlwaysOnTop(false);
  }

  function updateLock() {
    if (lockWanted()) showLockScreens();
    else hideLockScreens();
  }

  function notify(title, body) {
    if (Notification.isSupported()) {
      new Notification({ title, body, icon: icon() }).show();
    }
  }

  function createOverlay() {
    const W = 340;
    const H = 92;
    const pos = store.data.settings.overlayPos;
    const wa = screen.getPrimaryDisplay().workArea;
    const x = pos ? pos.x : wa.x + wa.width - W - 16;
    const y = pos ? pos.y : wa.y + 16;

    overlay = new BrowserWindow({
      width: W,
      height: H,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      icon: icon(),
      webPreferences: { preload }
    });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) console.error('[overlay]', message);
    });
    overlay.loadFile(winFile('overlay.html'));

    overlay.on('moved', () => {
      const [ox, oy] = overlay.getPosition();
      store.data.settings.overlayPos = { x: ox, y: oy };
      store.save();
    });
    keepOnScreen();   // the saved spot may be on a monitor that is not plugged in today
  }

  /* A window left on a screen that has been unplugged is still "open" and
     still on top — just nowhere anyone can see or drag it. Run at launch and
     whenever displays change; Windows shuffles windows itself right after a
     display goes, so the check runs again a moment later to have the last word. */
  function keepOnScreen() {
    const areas = screen.getAllDisplays().map((d) => d.workArea);
    const wa = screen.getPrimaryDisplay().workArea;
    if (overlay && !overlay.isDestroyed()) {
      const b = overlay.getBounds();
      const to = fitRect(b, areas, { x: wa.x + wa.width - b.width - 16, y: wa.y + 16 });
      if (to.x !== b.x || to.y !== b.y) {
        overlay.setPosition(to.x, to.y);
        store.data.settings.overlayPos = to;
        store.save();
      }
    }
    if (planner && !planner.isDestroyed() && !planner.isMaximized() && !planner.isFullScreen()) {
      const b = planner.getBounds();
      const w = Math.min(b.width, wa.width), h = Math.min(b.height, wa.height);
      const to = fitRect(b, areas, { x: wa.x + (wa.width - w) / 2, y: wa.y + (wa.height - h) / 2 });
      if (to.x !== b.x || to.y !== b.y) planner.setBounds({ x: to.x, y: to.y, width: w, height: h });
    }
  }
  let refitTimer = null;
  function onDisplaysChanged() {
    keepOnScreen();
    if (bubbles) bubbles.refit();
    clearTimeout(refitTimer);
    refitTimer = setTimeout(keepOnScreen, 1500);
  }

  function createPlanner() {
    planner = new BrowserWindow({
      width: 1120,
      height: 780,
      minWidth: 360,
      minHeight: 560,
      show: false,
      autoHideMenuBar: true,
      icon: icon(),
      backgroundColor: '#F4FAF6',
      webPreferences: { preload }
    });
    planner.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) console.error('[planner]', message);
    });
    // Links out of the planner belong in the real browser, not in a window
    // with the focus API attached to it.
    planner.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    planner.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith('rhythm://') && !url.startsWith(DEV_URL)) {
        e.preventDefault();
        if (/^https?:/.test(url)) shell.openExternal(url);
      }
    });

    if (DEV) planner.loadURL(DEV_URL);
    else planner.loadURL('rhythm://app/');

    planner.once('ready-to-show', () => {
      const autostart = process.argv.includes('--autostart');
      if (store.data.settings.openPlannerAtStart !== false && !autostart) planner.show();
    });

    planner.on('close', (e) => {
      if (!quitting) {
        e.preventDefault();
        planner.hide(); // keep running in the tray
      }
    });
  }

  function showPlanner() {
    if (!planner || planner.isDestroyed()) createPlanner();
    keepOnScreen();
    if (lockWins.length) planner.setAlwaysOnTop(true, 'screen-saver', 1);
    planner.show();
    planner.focus();
  }

  function updateTray(state) {
    if (!tray) return;
    const paused = state.paused ? ' (paused)' : '';
    const tip =
      state.phase === 'work'
        ? `Rhythm — ${state.task}${paused}`
        : state.phase === 'break'
          ? 'Rhythm — on a break'
          : 'Rhythm';
    tray.setToolTip(tip);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Rhythm', click: showPlanner },
        {
          label: overlay && overlay.isVisible() ? 'Hide Focus Overlay' : 'Show Focus Overlay',
          click: () => {
            if (!overlay || overlay.isDestroyed()) return;
            overlay.isVisible() ? overlay.hide() : overlay.show();
            updateTray(sessions.getState());
          }
        },
        { type: 'separator' },
        {
          /* The budget is named in the label rather than hidden behind a bare
             disabled item, so running out reads as a rule rather than a bug. */
          label: state.paused
            ? (state.pauseLeftSec != null ? `Resume Session (auto in ${Math.ceil(state.pauseLeftSec / 60)}m)` : 'Resume Session')
            : (state.phase === 'idle'
              ? 'Pause Session'
              : `Pause Session (${Math.ceil((state.pauseBudgetLeftSec || 0) / 60)}m left)`),
          enabled: state.phase !== 'idle' && (state.paused || (state.pauseBudgetLeftSec || 0) > 0),
          click: () => (state.paused ? sessions.resume() : sessions.pause())
        },
        {
          label: 'Stop Session',
          enabled: state.phase !== 'idle',
          click: () => sessions.stop()
        },
        { type: 'separator' },
        // No Quit. The item that used to live here was the one reflex that
        // could end the day early, so it is gone outside of development.
        ...(DEV
          ? [{ label: 'Quit Rhythm (dev)', click: () => app.quit() }]
          : [{ label: 'Rhythm stays open', enabled: false }])
      ])
    );
  }

  app.on('second-instance', () => showPlanner());

  app.on('window-all-closed', () => {
    // Tray app: keep running with no windows.
  });

  // Signing out or shutting down. Rhythm holds the day, not the machine.
  app.on('session-end', () => { allowQuit = true; });

  app.on('before-quit', (e) => {
    if (!allowQuit) {
      // Something asked the app to end and it was not the OS. Stay in the tray.
      e.preventDefault();
      return;
    }
    quitting = true;
    if (poller) poller.stop();
    if (enforcer) enforcer.stop();
    if (bubbles) bubbles.stop();
    hideBreakScreens();
    hideAwayScreens();
    hideLockScreens();
    if (presenceWin && !presenceWin.isDestroyed()) presenceWin.destroy();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('app.rhythm.desktop');
    protocol.handle('rhythm', serveDist);

    /* The microphone, and nothing else.

       Electron's default is to grant whatever a page asks for, which is a poor
       default for a window that loads a custom scheme — so this narrows it to
       one permission from one origin instead. The planner needs 'media' for
       dictation.

       Worth being exact about why, because the obvious guess is wrong: this
       Chromium DOES define webkitSpeechRecognition, and starting it DOES open
       the microphone. It then fails — the open-source build carries no
       credentials for Google's speech service. desktop/mic-probe.mjs drives
       the real window and logs "start -> audiostart -> error:network -> end".
       So the page retires that lane the first time it says so and records a
       clip instead, and that is plain getUserMedia.

       Both handlers are needed. The request handler answers the prompt;
       the check handler answers enumerateDevices and the permissions API,
       which decide whether the page thinks it has a microphone at all. */
    const micOrigin = (url) => typeof url === 'string' && (url.startsWith('rhythm://') || url.startsWith(DEV_URL));
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
      callback(permission === 'media' && micOrigin(details?.requestingUrl || wc?.getURL?.()));
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission, requestingOrigin) => (
      permission === 'media' && micOrigin(requestingOrigin || wc?.getURL?.())
    ));
    store.load();
    sessions = new SessionManager(store);

    /* Start with Windows, always. Since the app cannot be closed, signing out
       would otherwise be the loophole that closes it — a reboot is not a
       decision to be rid of Rhythm for the day. Re-asserted on every boot
       rather than only when a toggle flips, so a reinstall to a new path heals
       its own registry entry. The --autostart arg lets a login launch open
       quietly in the tray. */
    store.data.settings.launchAtLogin = true;
    if (app.isPackaged) {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath,
        args: ['--autostart'],
      });
    }

    /* No application menu. Its File > Quit is a second exit, and the planner
       already hides its menu bar; Chromium keeps the editing shortcuts either
       way. Development keeps the default menu, and its reload with it. */
    if (!DEV) Menu.setApplicationMenu(null);

    createOverlay();
    createPlanner();
    // Unplugging a monitor must never strand the overlay (or the planner) on it.
    screen.on('display-removed', onDisplaysChanged);
    screen.on('display-added', onDisplaysChanged);
    screen.on('display-metrics-changed', onDisplaysChanged);

    if (store.migratedFromAnchor) {
      notify('Anchor moved in', 'Your focus settings, templates and history came across to Rhythm.');
    }

    tray = new Tray(icon().resize({ width: 16, height: 16 }));
    tray.on('click', showPlanner);
    updateTray(sessions.getState());

    poller = startPoller();
    enforcer = startEnforcer();
    bubbles = createBubbles({
      store, sessions, enforcer, icon, preload, winFile, notify, showPlanner,
      isQuitting: () => quitting
    });
    bubbles.wire();
    bubbles.startBridge();

    // Free times: scheduled windows when the hard-block list is ignored.
    // Lines like "20:00-23:00" (daily) or "fri,sat 14:00-02:00" (24h clock;
    // overnight ranges wrap past midnight).
    function inFreeTime() {
      const lines = store.data.settings.freeTimes || [];
      if (!lines.length) return false;
      const now = new Date();
      const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];
      const mins = now.getHours() * 60 + now.getMinutes();
      for (const raw of lines) {
        const line = String(raw).toLowerCase().trim();
        const m = line.match(/^(?:([a-z, ]+?)\s+)?(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
        if (!m) continue;
        if (m[1]) {
          const days = m[1].split(/[,\s]+/).filter(Boolean);
          if (!days.some((d) => day.startsWith(d) || d.startsWith(day))) continue;
        }
        const from = Number(m[2]) * 60 + Number(m[3]);
        const to = Number(m[4]) * 60 + Number(m[5]);
        const inRange = from <= to ? mins >= from && mins < to : mins >= from || mins < to;
        if (inRange) return true;
      }
      return false;
    }

    // Hard block: matched windows are minimized on sight, session or not.
    // Runs independently of the session machinery, so it beats a focus
    // mode's allow list by construction. Free times switch it off.
    let lastBlockNotifyAt = 0;
    function hardBlockCheck(s) {
      const list = (store.data.settings.blocklist || [])
        .map((k) => String(k).toLowerCase().trim())
        .filter(Boolean);
      if (!list.length) return;
      if (inFreeTime()) return;
      const title = s.title || '';
      const procName = s.process || '';
      if (!title && !procName) return;
      if (procName.toLowerCase() === 'electron' || title === 'Rhythm') return;
      const hay = `${title} ${procName} ${s.host || ''}`.toLowerCase();
      const hit = list.find((k) => hay.includes(k));
      if (!hit) return;
      const hwnd = Number(s.hwnd) || 0;
      if (hwnd) enforcer.send(`minimize ${hwnd}`);
      if (Date.now() - lastBlockNotifyAt > 30000) {
        lastBlockNotifyAt = Date.now();
        notify('Blocked', `That window matches "${hit}" on your hard-block list.`);
      }
    }

    poller.on('sample', (s) => {
      sessions.onSample(s);
      hardBlockCheck(s);
    });

    let lastPhase = 'idle';
    sessions.on('state', (s) => {
      broadcast('state', s);
      if (s.phase !== lastPhase) {
        lastPhase = s.phase;
        updateTray(s);
      }
      if (s.phase === 'break' && store.data.settings.breakScreen) {
        showBreakScreens();
      } else if (s.phase !== 'break' && breakWins.length) {
        hideBreakScreens();
      }
      ensurePresenceWindow(s);
      updateLock();
      bubbles.onState(s);
    });

    // The lock's clock: catches the step-out expiring and the app booting
    // straight into commitment mode. Cheap enough to just poll.
    setInterval(updateLock, 2000);
    updateLock();

    // Away watchdog: no face for awaySec during a work session -> blackout.
    setInterval(() => {
      const s = sessions.getState();
      const active =
        s.phase === 'work' &&
        !s.paused &&
        store.data.settings.chairDetect &&
        presenceWin &&
        !camFailed &&
        !awaySuppressed;
      if (!active) return;
      const awayMs = Math.max(5, Number(store.data.settings.awaySec) || 10) * 1000;
      if (Date.now() - lastPresentAt > awayMs) showAwayScreens();
    }, 1000);

    sessions.on('notify', (n) => notify(n.title, n.body));
    // A window the focus mode does not allow: minimized, and you are put back
    // on the last allowed window. One notification per half minute at most —
    // the block itself is the message; a stream of toasts would be noise.
    let lastModeNotifyAt = 0;
    sessions.on('block', (b) => {
      const { offender, target, label } = b;
      // Brave with the Rhythm extension swaps the tab itself; see bubbles.js.
      if (bubbles.handOffToBrave(b, sessions.getState().current)) return;
      if (offender) enforcer.send(`minimize ${offender}`);
      if (target && target !== offender) {
        setTimeout(() => enforcer.send(`focus ${target}`), 300);
      }
      if (Date.now() - lastModeNotifyAt > 30000) {
        lastModeNotifyAt = Date.now();
        notify('Outside the bubble', `${label} is not in this bubble.`);
      }
    });
    sessions.on('history-changed', () => broadcast('history-changed'));
    // The seam: a finished round is the planner's business. It decides whether
    // that means the task is done and what the task really costs.
    sessions.on('round-ended', (entry) => {
      broadcast('round-ended', entry);
      if (entry.taskId) showPlanner();
    });

    ipcMain.handle('get-state', () => sessions.getState());
    ipcMain.handle('get-data', () => ({
      settings: store.data.settings,
      templates: store.data.templates,
      history: store.data.history
    }));
    ipcMain.handle('start-work', (_e, raw) => {
      /* A planner that names a saved bubble but sends no items (an older
         build) still gets the bubble's apps and sites, not just its words. */
      const req = { ...(raw || {}) };
      if (!Array.isArray(req.items) && req.templateId) {
        const tpl = store.data.templates.find((t) => t.id === req.templateId);
        if (tpl && Array.isArray(tpl.items) && tpl.items.length) req.items = tpl.items;
      }
      bubbles.startRound(Array.isArray(req.items) ? req.items : []);
      sessions.startWork(req);
      updateTray(sessions.getState());
      return sessions.getState();
    });
    ipcMain.handle('save-template', (_e, tpl) => {
      const name = String((tpl && (tpl.name || tpl.task)) || '').trim();
      if (!name) return store.data.templates;
      // Editing the one in hand updates it; otherwise a repeated name replaces
      // rather than duplicates.
      const existing = tpl.id
        ? store.data.templates.find((t) => t.id === tpl.id)
        : store.data.templates.find((t) => String(t.name).toLowerCase() === name.toLowerCase());
      /* A bubble is saved as items; `allowed` is kept beside them as plain
         words, for anything that still reads a focus mode the old way. */
      const items = Array.isArray(tpl.items)
        ? normalizeItems(tpl.items)
        : (Array.isArray(tpl.allowed) ? tpl.allowed : []).map((k) => String(k).trim()).filter(Boolean)
          .map((text) => ({ kind: 'word', text: text.toLowerCase() }));
      const entry = {
        id: (existing && existing.id) || Date.now(),
        name,
        workMin: Math.max(1, Math.min(240, Number(tpl.workMin) || 50)),
        items,
        allowed: wordsOfItems(items)
      };
      store.data.templates = store.data.templates.filter((t) => t.id !== entry.id);
      store.data.templates.unshift(entry);
      store.save();
      broadcast('data-changed');
      return store.data.templates;
    });
    ipcMain.handle('delete-template', (_e, id) => {
      store.data.templates = store.data.templates.filter((t) => t.id !== id);
      store.save();
      broadcast('data-changed');
      return store.data.templates;
    });
    ipcMain.handle('pause', () => {
      sessions.pause();
      updateTray(sessions.getState());
    });
    ipcMain.handle('resume', () => {
      sessions.resume();
      updateTray(sessions.getState());
    });
    ipcMain.handle('stop', () => {
      sessions.stop();
      updateTray(sessions.getState());
    });
    ipcMain.handle('skip-break', () => sessions.skipBreak());
    ipcMain.handle('save-settings', (_e, patch) => {
      const s = store.data.settings;
      Object.assign(s, patch || {});
      s.launchAtLogin = true; // not a toggle any more — see whenReady
      store.save();
      broadcast('data-changed');
      sessions.emitState();
      updateLock();
      return store.data.settings;
    });
    ipcMain.handle('open-planner', () => showPlanner());
    /* `lock-step-out` used to live here: a 2.5-second hold on the lock screen
       bought `unlockMin` minutes outside. Removed, not disabled — an IPC
       channel that still answers is a channel something will eventually call.

       The reasoning is in windows/lock.js. Briefly: it was built as friction
       and became a ritual, which is the habit the mode exists to interrupt.
       The laptop opens by naming what you are about to do, and resting is one
       of the things you can name — the focus page starts rounds on rewards. */

    /* ---- automatic local backups ----
       The planner's own storage is a browser profile in AppData, which is
       exactly what a reinstall, a profile reset or a bad sync takes with it.
       So the daily snapshots land as ordinary files in Documents, where a
       person can see them, copy them, and restore one on another machine.
       Names are checked against one pattern so the renderer can never read or
       write outside the folder. */
    const backupDir = () => path.join(app.getPath('documents'), 'Rhythm backups');
    const backupName = (n) => (/^rhythm-[\w.-]+\.json$/.test(String(n)) ? String(n) : null);
    ipcMain.handle('backup-write', async (_e, name, text) => {
      const n = backupName(name);
      if (!n || typeof text !== 'string') return { ok: false, error: 'bad-name' };
      try {
        await fs.promises.mkdir(backupDir(), { recursive: true });
        const file = path.join(backupDir(), n);
        await fs.promises.writeFile(file + '.part', text, 'utf8');
        await fs.promises.rename(file + '.part', file); // never leave a half-written backup
        return { ok: true, path: file };
      } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
    });
    ipcMain.handle('backup-list', async () => {
      try {
        const names = (await fs.promises.readdir(backupDir())).filter(backupName);
        const out = [];
        for (const n of names) {
          const st = await fs.promises.stat(path.join(backupDir(), n));
          out.push({ name: n, at: st.mtimeMs, bytes: st.size });
        }
        return out;
      } catch { return []; }
    });
    ipcMain.handle('backup-read', async (_e, name) => {
      const n = backupName(name);
      if (!n) return null;
      try { return await fs.promises.readFile(path.join(backupDir(), n), 'utf8'); } catch { return null; }
    });
    ipcMain.handle('backup-delete', async (_e, name) => {
      const n = backupName(name);
      if (!n) return false;
      try { await fs.promises.unlink(path.join(backupDir(), n)); return true; } catch { return false; }
    });
    ipcMain.handle('backup-open', async () => {
      await fs.promises.mkdir(backupDir(), { recursive: true }).catch(() => {});
      return shell.openPath(backupDir());
    });
    ipcMain.handle('backup-where', () => backupDir());

    /* ---- export on request ----
       Other programs on this machine (the Claude gate, for one) read the
       daily snapshot, and an hourly file can be an hour behind the planner.
       They cannot reach the planner's storage — by design — but they can
       ask: dropping a file named "export-request" in the backups folder has
       the planner write a fresh snapshot within a second or two, while the
       app is running. The name fails backupName's pattern on purpose, so the
       renderer can neither create nor read it; only this process touches it. */
    const EXPORT_REQ = 'export-request';
    const serveExportRequest = () => {
      const f = path.join(backupDir(), EXPORT_REQ);
      fs.promises.unlink(f).then(
        () => { if (planner && !planner.isDestroyed()) planner.webContents.send('export-now'); },
        () => {},   // no request file: nothing asked
      );
    };
    try {
      fs.mkdirSync(backupDir(), { recursive: true });
      // (Windows sometimes reports no filename: when in doubt, look — the look is one cheap unlink)
      const reqWatcher = fs.watch(backupDir(), (_event, name) => { if (!name || name === EXPORT_REQ) serveExportRequest(); });
      reqWatcher.on('error', () => {});
      app.on('before-quit', () => { try { reqWatcher.close(); } catch { /* going down anyway */ } });
      serveExportRequest();   // one left from while the app was closed
    } catch { /* a planner that cannot watch the folder still backs up hourly */ }

    /* ---- account sync ----
       The planner runs on rhythm://app, which is not the deployment's origin,
       so its own fetch() could never carry the session cookie (SameSite) and
       the server would need CORS holes. The main process has neither problem:
       requests from here go through the session cookie jar with no browser
       policy attached, so the web deployment needs no changes at all. */
    const SYNC_BASE_DEFAULT = 'https://rhythm-ruby.vercel.app';
    const syncBase = () => String(store.data.settings.syncBase || SYNC_BASE_DEFAULT).replace(/\/+$/, '');

    ipcMain.handle('sync-base', () => syncBase());
    ipcMain.handle('sync-fetch', async (_e, path, init) => {
      if (!/^\/api\//.test(String(path))) return { ok: false, status: 0, error: 'bad-path' };
      try {
        const r = await session.defaultSession.fetch(syncBase() + path, {
          method: (init && init.method) || 'GET',
          headers: (init && init.headers) || {},
          body: init && init.body != null ? init.body : undefined,
          credentials: 'include',
        });
        return { ok: r.ok, status: r.status, body: await r.text() };
      } catch (e) {
        return { ok: false, status: 0, error: String((e && e.message) || e) };
      }
    });

    /* Sign-in happens in a real window on the deployment itself — the cookies
       land in this app's session and every later sync-fetch carries them.
       Google refuses OAuth from a browser that admits to being embedded, so
       the window drops the Electron token from its user agent. */
    let authWin = null;
    ipcMain.handle('sync-signin', () => new Promise((resolve) => {
      if (authWin && !authWin.isDestroyed()) { authWin.focus(); return resolve({ ok: false, error: 'already-open' }); }
      const base = syncBase();
      authWin = new BrowserWindow({
        width: 520, height: 660, autoHideMenuBar: true, icon: icon(),
        title: 'Sign in to Rhythm',
      });
      authWin.webContents.setUserAgent(authWin.webContents.getUserAgent().replace(/Electron\/\S+\s?/, '').replace(/rhythm-desktop\/\S+\s?/, ''));
      const done = (url) => {
        // Back on the deployment's root = the OAuth round trip finished.
        if (url.startsWith(base) && new URL(url).pathname === '/') {
          const w = authWin; authWin = null;
          if (w && !w.isDestroyed()) w.close();
        }
      };
      authWin.webContents.on('did-navigate', (_e2, url) => done(url));
      authWin.webContents.on('did-redirect-navigation', (_e2, url) => done(url));
      authWin.on('closed', () => { authWin = null; resolve({ ok: true }); });
      authWin.loadURL(base + '/api/auth/signin?callbackUrl=' + encodeURIComponent(base + '/'));
    }));

    /* Local sign-out: drop the deployment's cookies. The JWT session lives in
       the cookie, so removing it is the whole operation. */
    ipcMain.handle('sync-signout', async () => {
      const base = syncBase();
      const all = await session.defaultSession.cookies.get({ url: base });
      for (const c of all) {
        try { await session.defaultSession.cookies.remove(base, c.name); } catch { /* gone already */ }
      }
      return { ok: true };
    });

    /* ---- calendar ----
       The planner asks; the main process is the only part of the app that can
       answer, because it is the only part without a browser's CORS rules and
       the only one that can hold a refresh token. Read-only in both routes. */
    ipcMain.handle('cal-fetch-ics', (_e, url) => calendar.fetchIcs(url));
    ipcMain.handle('cal-status', () => calendar.status());
    ipcMain.handle('cal-authorize', (_e, clientId, clientSecret) => calendar.authorize(clientId, clientSecret));
    ipcMain.handle('cal-disconnect', () => calendar.disconnect());
    ipcMain.handle('cal-list', () => calendar.listCalendars());
    ipcMain.handle('cal-events', (_e, calendarId, fromMs, toMs) => calendar.listEvents(calendarId, fromMs, toMs));
    ipcMain.handle('presence-report', (_e, status) => {
      if (status && status.error) {
        if (presenceWin && !presenceWin.isDestroyed()) presenceWin.destroy();
        presenceWin = null;
        hideAwayScreens();
        if (['NotAllowedError', 'NotFoundError', 'SecurityError'].includes(status.error)) {
          camFailed = true;
          notify(
            'Chair detection unavailable',
            'Rhythm could not access the camera — the feature is off until the app restarts.'
          );
        } else {
          // e.g. NotReadableError / "Device in use" — the camera is busy
          // (probably a call). Try again in a minute, silently.
          camRetryAt = Date.now() + 60000;
        }
        return;
      }
      if (status === true) {
        lastPresentAt = Date.now();
        awaySuppressed = false;
        hideAwayScreens();
      }
    });
    ipcMain.handle('away-dismiss', () => {
      // The user clicked/typed on the away screen — they're clearly here even
      // if the camera can't see them. Hold off until a face is seen again.
      awaySuppressed = true;
      lastPresentAt = Date.now();
      hideAwayScreens();
    });
  });
}
