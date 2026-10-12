const { contextBridge, ipcRenderer, webUtils } = require('electron');

/* The one bridge, shared by the planner window and the focus windows.

   Its presence is also how the planner knows it is on the desktop: the web
   and Android builds see `window.rhythmFocus === undefined` and hide the
   focus suite entirely, rather than shipping dead buttons. */
contextBridge.exposeInMainWorld('rhythmFocus', {
  desktop: true,
  getState: () => ipcRenderer.invoke('get-state'),
  getData: () => ipcRenderer.invoke('get-data'),
  // req: { task, workMin, items, allowed, taskId, templateId, projectId }
  startWork: (req) => ipcRenderer.invoke('start-work', req),
  saveTemplate: (tpl) => ipcRenderer.invoke('save-template', tpl),
  deleteTemplate: (id) => ipcRenderer.invoke('delete-template', id),
  presenceReport: (present) => ipcRenderer.invoke('presence-report', present),
  awayDismiss: () => ipcRenderer.invoke('away-dismiss'),
  pause: () => ipcRenderer.invoke('pause'),
  resume: () => ipcRenderer.invoke('resume'),
  stop: () => ipcRenderer.invoke('stop'),
  skipBreak: () => ipcRenderer.invoke('skip-break'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  openPlanner: () => ipcRenderer.invoke('open-planner'),
  // Commitment lock: the held-out escape. Granting it is the main process's
  // decision; this only reports that the hold completed.

  /* Account sync, relayed through the main process — see main.js for why the
     renderer cannot do this itself. Present only on the desktop; sync.js
     falls back to plain fetch() everywhere else. */
  sync: {
    base: () => ipcRenderer.invoke('sync-base'),
    request: (path, init) => ipcRenderer.invoke('sync-fetch', path, init),
    signIn: () => ipcRenderer.invoke('sync-signin'),
    signOut: () => ipcRenderer.invoke('sync-signout'),
  },

  /* Automatic backups as files in Documents\Rhythm backups. See main.js. */
  backup: {
    write: (name, text) => ipcRenderer.invoke('backup-write', name, text),
    list: () => ipcRenderer.invoke('backup-list'),
    read: (name) => ipcRenderer.invoke('backup-read', name),
    remove: (name) => ipcRenderer.invoke('backup-delete', name),
    open: () => ipcRenderer.invoke('backup-open'),
    where: () => ipcRenderer.invoke('backup-where'),
  },

  /* Read-only calendar access. Present only on the desktop, which is exactly
     how the planner decides whether to offer real Google sign-in or fall back
     to a feed URL relayed through the server. */
  calendar: {
    fetchIcs: (url) => ipcRenderer.invoke('cal-fetch-ics', url),
    status: () => ipcRenderer.invoke('cal-status'),
    authorize: (clientId, clientSecret) => ipcRenderer.invoke('cal-authorize', clientId, clientSecret),
    disconnect: () => ipcRenderer.invoke('cal-disconnect'),
    listCalendars: () => ipcRenderer.invoke('cal-list'),
    listEvents: (calendarId, fromMs, toMs) => ipcRenderer.invoke('cal-events', calendarId, fromMs, toMs),
  },
  /* Bubbles: what is in the running one, opening an item, and turning a drop
     into an item. See bubbles.js. A dropped File carries no path of its own
     in a page; pathFor asks Electron for it. */
  bubble: {
    items: () => ipcRenderer.invoke('bubble-items'),
    open: (item) => ipcRenderer.invoke('bubble-open', item),
    pathFor: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
    resolvePaths: (paths) => ipcRenderer.invoke('bubble-resolve-paths', paths),
    resolveUrl: (text) => ipcRenderer.invoke('bubble-resolve-url', text),
    running: () => ipcRenderer.invoke('bubble-running'),
    // Let a site into the running bubble for this round. Resolves to the
    // site item, or null when no bubble is running or there is no site in it.
    addSite: (text) => ipcRenderer.invoke('bubble-add-site', text),
    openFiles: () => ipcRenderer.invoke('bubble-open-files'),
    // One browser button stands for all of a bubble's sites.
    openBrowserHome: () => ipcRenderer.invoke('bubble-browser-home'),
    browserIcon: () => ipcRenderer.invoke('bubble-browser-icon'),
    siteMenu: (at) => ipcRenderer.invoke('bubble-site-menu', at),
    // The bubble bar: which programs have a window open, every few seconds.
    onRunning: (cb) => sub('bar-running', (_e, list) => cb(list)),
    browser: (url) => ipcRenderer.invoke('bubble-browser', url),
    braveExtensions: () => ipcRenderer.invoke('bubble-brave-extensions'),
    setBraveExtensions: (ids) => ipcRenderer.invoke('bubble-set-brave-extensions', ids),
    // "Load unpacked…": resolves { list, error? }. Forget takes a picked folder back out.
    pickExtension: () => ipcRenderer.invoke('bubble-pick-extension'),
    forgetExtension: (key) => ipcRenderer.invoke('bubble-forget-extension', key),
    companion: () => ipcRenderer.invoke('bubble-companion'),
    openCompanionFolder: () => ipcRenderer.invoke('bubble-companion-open'),
  },

  /* The bubble browser's own toolbar. Only its window uses these; the pages
     inside its tabs get no bridge at all. */
  browser: {
    ready: () => ipcRenderer.invoke('bb-ready'),
    navigate: (url) => ipcRenderer.invoke('bb-navigate', url),
    newTab: (url) => ipcRenderer.invoke('bb-new-tab', url),
    closeTab: (id) => ipcRenderer.invoke('bb-close-tab', id),
    activate: (id) => ipcRenderer.invoke('bb-activate', id),
    back: () => ipcRenderer.invoke('bb-back'),
    forward: () => ipcRenderer.invoke('bb-forward'),
    reload: () => ipcRenderer.invoke('bb-reload'),
    extensionPopup: (id) => ipcRenderer.invoke('bb-ext-popup', id),
    openInBrave: () => ipcRenderer.invoke('bb-open-in-brave'),
    hasBrave: () => ipcRenderer.invoke('bb-has-brave'),
    onTabs: (cb) => sub('bb-tabs', (_e, tabs) => cb(tabs)),
    onExtensions: (cb) => sub('bb-extensions', (_e, list) => cb(list)),
    onFocusAddress: (cb) => sub('bb-focus-address', () => cb()),
  },

  // Listeners return their own unsubscribe — React effects need to clean up,
  // and a planner that re-renders must not stack duplicate handlers.
  onState: (cb) => sub('state', (_e, s) => cb(s)),
  onRoundEnded: (cb) => sub('round-ended', (_e, entry) => cb(entry)),
  onHistoryChanged: (cb) => sub('history-changed', () => cb()),
  onDataChanged: (cb) => sub('data-changed', () => cb()),
  /* Something outside asked for a fresh snapshot (main.js, export-request). */
  onExportNow: (cb) => sub('export-now', () => cb())
});

function sub(channel, handler) {
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
