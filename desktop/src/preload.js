const { contextBridge, ipcRenderer } = require('electron');

/* The one bridge, shared by the planner window and the focus windows.

   Its presence is also how the planner knows it is on the desktop: the web
   and Android builds see `window.rhythmFocus === undefined` and hide the
   focus suite entirely, rather than shipping dead buttons. */
contextBridge.exposeInMainWorld('rhythmFocus', {
  desktop: true,
  getState: () => ipcRenderer.invoke('get-state'),
  getData: () => ipcRenderer.invoke('get-data'),
  // req: { task, workMin, allowed, taskId }
  startWork: (req) => ipcRenderer.invoke('start-work', req),
  saveTemplate: (tpl) => ipcRenderer.invoke('save-template', tpl),
  deleteTemplate: (id) => ipcRenderer.invoke('delete-template', id),
  triageVerdict: (key, verdict) => ipcRenderer.invoke('triage-verdict', key, verdict),
  triageSnooze: (key) => ipcRenderer.invoke('triage-snooze', key),
  templateVerdict: (id, key, verdict) => ipcRenderer.invoke('template-verdict', id, key, verdict),
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
  lockStepOut: () => ipcRenderer.invoke('lock-step-out'),

  /* Account sync, relayed through the main process — see main.js for why the
     renderer cannot do this itself. Present only on the desktop; sync.js
     falls back to plain fetch() everywhere else. */
  sync: {
    base: () => ipcRenderer.invoke('sync-base'),
    request: (path, init) => ipcRenderer.invoke('sync-fetch', path, init),
    signIn: () => ipcRenderer.invoke('sync-signin'),
    signOut: () => ipcRenderer.invoke('sync-signout'),
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
  // Listeners return their own unsubscribe — React effects need to clean up,
  // and a planner that re-renders must not stack duplicate handlers.
  onState: (cb) => sub('state', (_e, s) => cb(s)),
  onNudge: (cb) => sub('nudge', (_e, info) => cb(info)),
  onRoundEnded: (cb) => sub('round-ended', (_e, entry) => cb(entry)),
  onHistoryChanged: (cb) => sub('history-changed', () => cb()),
  onDataChanged: (cb) => sub('data-changed', () => cb())
});

function sub(channel, handler) {
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
