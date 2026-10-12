const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { itemsOfMode } = require('./bubble');

/* Settings for the focus half of the desktop app. These came over from Anchor
   unchanged — the machinery that reads them is the same machinery — plus the
   handful the planner side needs. */
const DEFAULTS = {
  settings: {
    workMin: 50,
    breakMin: 10,
    settleSec: 5,
    // Allowed under every focus mode, on top of the mode's own list: sites and
    // keywords you always work from. See session.js.
    alwaysAllowed: [],
    blocklist: [],
    freeTimes: [],
    breakScreen: true,
    chairDetect: true,
    awaySec: 10,
    // Forced true by main.js: the desktop app has no Quit, so a sign-out
    // must not become the way to close it. Kept here so the file reads true.
    launchAtLogin: true,
    overlayPos: null,
    // Desktop-only: the planner window is the app's face, so it opens on
    // launch unless the person would rather start in the tray.
    openPlannerAtStart: true,
    /* Commitment mode: while no work round runs, every display is covered by a
       lock screen, and the laptop opens by naming a task and a duration.

       There is no escape hatch. There was one — a 2.5-second hold worth
       `unlockMin` minutes — and it stopped being friction and became the
       ordinary way in. `unlockMin` is left out rather than left unused: a
       setting nothing reads is a promise the app is not keeping. Old data
       files carrying it are harmless; the spread below simply ignores it. */
    commitmentMode: false,
    /* Bubbles. The wall is the backdrop that covers every screen while a
       bubble runs, with the bubble's apps and sites on it to open. */
    bubbleWall: true,
    // The bubble bar takes the Windows taskbar's place while a bubble runs.
    bubbleTaskbar: true,
    // Set while the taskbar is hidden, so a Rhythm that was killed mid-round
    // shows it again at its next launch (bubbles.js, restoreTaskbar).
    taskbarHiddenByRhythm: false,
    // Where a site on the wall opens: 'rhythm' (the bubble browser, which
    // never loads a page outside the bubble) or 'brave' (the real Brave, held
    // to the bubble by the Rhythm extension).
    bubbleSites: 'rhythm',
    // Extensions the bubble browser loads: Brave ids, or "folder:<path>".
    braveExtensions: [],
    // Unpacked extension folders picked in Bubble settings (not Brave's own).
    extraExtensions: []
  },
  templates: [],
  history: []
};

class Store {
  constructor() {
    this.data = null;
  }

  file() {
    return path.join(app.getPath('userData'), 'rhythm-focus-data.json');
  }

  /* Anchor's own data file, wherever Electron put it when Anchor ran as its
     own app. Read once, on a first launch that finds nothing of ours — the
     merge should not cost the person their focus modes or their history. */
  legacyFile() {
    return path.join(path.dirname(app.getPath('userData')), 'anchor', 'anchor-data.json');
  }

  read(file) {
    // Tolerate a UTF-8 BOM — external editors (and PowerShell) add one, and
    // JSON.parse rejects it. Falling back to defaults here would get the
    // user's data overwritten on the next save.
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const raw = JSON.parse(text);
    // The distraction list, its grace period and nudges are gone: a focus mode
    // is an allow list and everything else is blocked. Old keys are dropped.
    const settings = { ...DEFAULTS.settings, ...(raw.settings || {}) };
    for (const k of ['distractions', 'graceSec', 'enforceSec', 'nudgeSound']) delete settings[k];
    return {
      settings,
      /* A template used to BE a task: it was keyed by task name, and applying
         one renamed whatever you were doing. It is a named set of restrictions
         now, usable with any task, so the old `task` field becomes its name. */
      /* A focus mode became a bubble: its keywords became items (word items,
         which match exactly as the keywords did — see bubble.js). */
      templates: (Array.isArray(raw.templates) ? raw.templates : []).map((t) => {
        const { verdicts, ...rest } = t || {};   // learned "work/distraction" answers: gone
        return { ...rest, name: String((t && (t.name || t.task)) || '').trim() || 'Focus', items: itemsOfMode(t) };
      }),
      history: Array.isArray(raw.history) ? raw.history : []
    };
  }

  load() {
    try {
      this.data = this.read(this.file());
      return this.data;
    } catch { /* nothing of ours yet — try Anchor's */ }
    try {
      this.data = this.read(this.legacyFile());
      this.migratedFromAnchor = true;
      this.save(); // claim it as ours; Anchor's own file is left untouched
      return this.data;
    } catch { /* no Anchor either — first run */ }
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    return this.data;
  }

  save() {
    try {
      // Atomic write: a crash mid-write must never leave a truncated file.
      const tmp = this.file() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file());
    } catch (err) {
      console.error('[store] save failed:', err.message);
    }
  }
}

module.exports = Store;
