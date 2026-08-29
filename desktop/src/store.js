const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/* Settings for the focus half of the desktop app. These came over from Anchor
   unchanged — the machinery that reads them is the same machinery — plus the
   handful the planner side needs. */
const DEFAULTS = {
  settings: {
    workMin: 50,
    breakMin: 10,
    graceSec: 15,
    enforceSec: 10,
    settleSec: 5,
    distractions: [
      'youtube', 'netflix', 'prime video', 'twitch',
      'twitter', 'x.com', 'reddit', 'tiktok', 'instagram', 'facebook', '9gag',
      'discord', 'whatsapp', 'telegram',
      'steam', 'epic games'
    ],
    blocklist: [],
    freeTimes: [],
    nudgeSound: true,
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
    // Commitment mode: while no work round runs, every display is covered by a
    // lock screen — the laptop opens by naming a task and a duration. The
    // escape is a deliberate 2.5s hold that buys unlockMin minutes outside.
    commitmentMode: false,
    unlockMin: 5
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
     merge should not cost the person their distraction list, their templates
     or their history. */
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
    return {
      settings: { ...DEFAULTS.settings, ...(raw.settings || {}) },
      templates: Array.isArray(raw.templates) ? raw.templates : [],
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
