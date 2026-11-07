const { EventEmitter } = require('events');
const { BROWSERS, normalizeItems, itemKey, inBubble, siteRules, isBrowserProcess } = require('./bubble');

/* A bubble (what a focus mode became) is an allow list and nothing else.

   Its items are apps, sites and — for modes made before bubbles — keywords;
   bubble.js says what each one lets through. Under a bubble, a window is
   either inside it — and then it is simply open — or it is not, and then it is
   minimized the moment it comes to the front and you are put back on the last
   allowed window. There is no grace period, no
   nudge, no "work or distraction?" question and no distraction list: that
   middle ground was where rounds leaked. A round started without a focus mode
   blocks nothing.

   A few windows are never judged, or the machine could not be used at all:
   Dawam's own, the Windows shell (desktop, taskbar, Start, search, the
   on-screen keyboard, the lock screen), Task Manager, and a browser's blank
   new tab — the page you type an allowed address into. */
const SHELL = new Set([
  'searchhost', 'searchapp', 'searchui', 'startmenuexperiencehost', 'shellexperiencehost',
  'textinputhost', 'lockapp', 'taskmgr', 'dawam', 'rhythm', 'electron'
]);
const NEW_TAB = /^(new tab|new incognito tab|new private tab|new inprivate tab|start page|speed dial)\b/i;

function isNeutral(title, process, host) {
  const proc = (process || '').toLowerCase();
  if (!title && !proc) return true;
  if (SHELL.has(proc)) return true;
  if (title === 'Dawam' || title === 'Rhythm' || title === 'Anchor') return true;
  /* File Explorer, folder windows included. It is the Windows shell: putting
     a folder window away while it is still building its ribbon crashes
     explorer.exe — and with it the taskbar — which is exactly what happened
     five times in one evening once apps were judged with no delay. */
  if (proc === 'explorer') return true;
  if (BROWSERS.includes(proc) && !host && NEW_TAB.test(String(title).trim())) return true;
  return false;
}

// What to call a blocked window in a notification: the site, else the app.
function blockLabel(title, process, host) {
  const domain = (host || '').toLowerCase().replace(/^(www|m)\./, '');
  if (domain) return domain;
  return String(title || process || 'That window').trim();
}

/* Pausing is for a phone call, not for the rest of the afternoon.
 *
 * A paused round stops its clock, and an indefinite pause was an off switch
 * for the round with an innocent name. Two limits close it: any one pause
 * resumes itself, and a round only has so much pause in it. Spend the budget
 * and the pause item stops working until the next round. (The allow list keeps
 * blocking through a pause — the clock waits, the rules do not.)
 *
 * The away-pause is deliberately exempt. That one is the app's own doing — it
 * fires when the chair empties and ends when the person sits back down — and
 * counting it would punish someone for being pulled away from a desk they then
 * came back to. It cannot be triggered by choice, which is what makes it safe
 * to leave uncapped. */
/* Keywords and sites allowed under every focus mode, on top of the mode's own
   list. Matched the same way as every other list here: a case-insensitive
   substring of title + process + domain. */
function alwaysAllowed(settings) {
  return (Array.isArray(settings && settings.alwaysAllowed) ? settings.alwaysAllowed : [])
    .map((k) => String(k).toLowerCase().trim())
    .filter(Boolean);
}

const APP_GRACE_MS = 1000;         // a new app window, before it is judged (see onSample)
const MAX_PAUSE_SEC = 5 * 60;      // one pause, at most
const PAUSE_BUDGET_SEC = 10 * 60;  // all manual pauses in one round, at most

// Session state machine: idle -> work -> break -> idle.
// The allow list is enforced for the whole work phase, paused or not.
class SessionManager extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.phase = 'idle';
    this.paused = false;
    this.task = '';
    // The planner task this round belongs to, when it was started from one.
    // It rides through to the history entry and back out on 'round-ended', so
    // the planner can tick off the task the person actually just did.
    this.taskId = null;
    // The project the minutes count towards — picked on the focus page or
    // carried from the task. The planner tallies it when the round ends.
    this.projectId = null;
    this.rounds = 0;
    this.plannedMin = 0;
    this.totalSec = 0;
    this.endsAt = 0;
    this.remainingOnPause = 0;
    this.templateId = null;    // the policy this round is running under
    this.pausedAt = 0;         // when the current pause began
    this.pauseAuto = false;    // the chair emptied, rather than a decision
    this.pauseSpentSec = 0;    // manual pause seconds used this round
    this.startedAt = 0;
    this.blockedCount = 0;     // windows closed off this round
    this.lastBlocked = null;   // { hwnd, at } — so one window is counted once
    this.allowed = [];
    this.items = [];           // the bubble's apps, sites and words (see bubble.js)
    this.added = [];           // of those, the ones let in after the round began
    this.bubbleName = '';
    this.homeHwnd = 0; // last allowed window — where a block sends you back to
    this.stableKey = undefined; // identity of the current foreground window
    this.stableSince = 0; // when that identity last changed — drives the settling hold
    this.lastSample = { title: '', process: '', hwnd: 0, blocked: false };
    this.timer = setInterval(() => this.tick(), 1000);
  }

  settings() {
    return this.store.data.settings;
  }

  remaining() {
    if (this.phase === 'idle') return 0;
    if (this.paused) return this.remainingOnPause;
    return Math.max(0, Math.round((this.endsAt - Date.now()) / 1000));
  }

  strict() {
    return this.items.length > 0;
  }

  /* What a browser that enforces the bubble itself (Dawam's bubble browser,
     the Brave extension) may open right now. Null: no limit. */
  siteRules() {
    if (this.phase !== 'work' || !this.strict()) return null;
    return siteRules(this.items, alwaysAllowed(this.settings()));
  }

  getState() {
    return {
      strict: this.strict(),
      allowed: this.allowed,
      // Icons stay out: this goes to every window once a second.
      items: this.items.map(({ icon, ...rest }) => rest),
      added: this.added.map(({ icon, ...rest }) => rest),
      bubbleName: this.bubbleName,
      phase: this.phase,
      paused: this.paused,
      pauseAuto: this.pauseAuto,
      pauseLeftSec: this.pauseLeft(),
      pauseBudgetLeftSec: this.pauseBudgetLeft(),
      task: this.task,
      taskId: this.taskId,
      projectId: this.projectId,
      templateId: this.templateId,
      rounds: this.rounds,
      plannedMin: this.plannedMin,
      totalSec: this.totalSec,
      remainingSec: this.remaining(),
      blockedCount: this.blockedCount,
      current: {
        title: this.lastSample.title,
        process: this.lastSample.process,
        blocked: this.lastSample.blocked
      }
    };
  }

  emitState() {
    this.emit('state', this.getState());
  }

  startWork(req) {
    const { task, workMin, allowed, items, taskId, templateId, projectId } = req || {};
    const min = Math.max(1, Math.min(240, Number(workMin) || this.settings().workMin));
    const newTask = String(task || 'Deep work').trim() || 'Deep work';
    /* The focus mode is found by id, not by the task's name: "what is allowed"
       and "what am I doing" are two separate questions, and one mode can be
       used with every task it suits. */
    const tpl = templateId ? this.store.data.templates.find((t) => t.id === templateId) : null;
    this.templateId = tpl ? tpl.id : null;
    this.phase = 'work';
    this.paused = false;
    this.pauseAuto = false;
    this.pausedAt = 0;
    this.pauseSpentSec = 0; // a fresh round gets a fresh budget
    this.task = newTask;
    this.taskId = taskId || null;
    this.projectId = projectId ? String(projectId) : null;
    this.allowed = (Array.isArray(allowed) ? allowed : [])
      .map((k) => String(k).toLowerCase().trim())
      .filter(Boolean);
    /* A caller that speaks bubbles sends items; one that still speaks keywords
       (an older planner, the tests) sends `allowed`, and each keyword becomes
       a word item that matches exactly as it always did. */
    this.items = Array.isArray(items)
      ? normalizeItems(items)
      : this.allowed.map((text) => ({ kind: 'word', text }));
    this.added = [];
    this.bubbleName = tpl ? String(tpl.name || '') : '';
    this.plannedMin = min;
    this.totalSec = min * 60;
    this.endsAt = Date.now() + this.totalSec * 1000;
    this.startedAt = Date.now();
    this.blockedCount = 0;
    this.lastBlocked = null;
    this.homeHwnd = 0;
    this.emitState();
  }

  /* `auto` is the away-pause and only the away-pause: uncapped, unbudgeted,
     and resumed by whoever paused it. Returns false when the pause was
     refused, so a caller can say why instead of silently doing nothing. */
  pause({ auto = false } = {}) {
    if (this.phase === 'idle' || this.paused) return false;
    if (!auto && this.pauseBudgetLeft() <= 0) {
      this.emit('pause-refused', { spentSec: this.pauseSpentSec });
      this.emitState();
      return false;
    }
    this.remainingOnPause = this.remaining();
    this.pausedAt = Date.now();
    this.pauseAuto = auto;
    this.paused = true;
    this.emitState();
    return true;
  }

  resume() {
    if (this.phase === 'idle' || !this.paused) return;
    this.endsAt = Date.now() + this.remainingOnPause * 1000;
    this.paused = false;
    this.pauseAuto = false;
    this.pausedAt = 0;
    this.emitState();
  }

  /* A paused round still has a clock — just a different one. */
  tickPaused() {
    if (this.pauseAuto) return; // the chair is empty; main.js owns this one
    this.pauseSpentSec += 1;
    const overOnePause = Date.now() - this.pausedAt >= MAX_PAUSE_SEC * 1000;
    const overBudget = this.pauseBudgetLeft() <= 0;
    if (overOnePause || overBudget) {
      this.resume();
      this.emit('pause-expired', { reason: overBudget ? 'budget' : 'cap' });
    } else {
      this.emitState(); // the countdown is visible, so it has to be pushed
    }
  }

  pauseBudgetLeft() {
    return Math.max(0, PAUSE_BUDGET_SEC - this.pauseSpentSec);
  }

  // Seconds before this pause resumes itself, or null when nothing is counting.
  pauseLeft() {
    if (!this.paused || this.pauseAuto) return null;
    const thisPause = Math.max(0, MAX_PAUSE_SEC - Math.round((Date.now() - this.pausedAt) / 1000));
    return Math.min(thisPause, this.pauseBudgetLeft());
  }

  stop() {
    if (this.phase === 'work') {
      const elapsed = this.totalSec - this.remaining();
      if (elapsed > 30) this.logEntry(false);
    }
    this.toIdle();
  }

  skipBreak() {
    if (this.phase === 'break') this.toIdle();
  }

  toIdle() {
    this.phase = 'idle';
    this.paused = false;
    this.templateId = null;
    this.pauseAuto = false;
    this.pausedAt = 0;
    this.pauseSpentSec = 0;
    this.taskId = null;
    this.projectId = null;
    this.allowed = [];
    this.items = [];
    this.added = [];
    this.bubbleName = '';
    this.homeHwnd = 0;
    this.lastBlocked = null;
    this.emitState();
  }

  /* Research branches out. Something can be let into the running bubble
     without stopping the round — for this round only; the saved bubble is
     not touched unless the planner is asked to keep it. Every addition is
     written into the round's history entry, so a round that kept widening
     says so afterwards rather than looking like the bubble it started as.
     Returns the items that were actually new. */
  addToRound(raw) {
    if (this.phase !== 'work' || !this.strict()) return [];
    const have = new Set(this.items.map(itemKey));
    const fresh = normalizeItems(raw).filter((it) => !have.has(itemKey(it)));
    if (!fresh.length) return [];
    this.items = [...this.items, ...fresh];
    this.added = [...this.added, ...fresh];
    this.emitState();
    return fresh;
  }

  onSample(sample) {
    const title = sample.title || '';
    const process = sample.process || '';
    const host = (sample.host || '').toLowerCase();
    const hwnd = Number(sample.hwnd) || 0;
    const neutral = isNeutral(title, process, host);
    // The always-allowed list (Focus settings → Lists) is added to every
    // bubble — a dictionary, the docs you always work from. It never turns a
    // round without a bubble into a blocking one.
    const allowed = inBubble({ title, process, path: sample.path, host }, this.items, alwaysAllowed(this.settings()));

    /* Slow pages briefly wear the wrong title and address while loading, so a
       browser window is given a few seconds after it changes before it is
       judged. An app is known by its program file, right from its first frame,
       so it needs no such wait — but it gets one second all the same: a window
       minimized while it is still being built can take its program down with
       it (File Explorer's ribbon did), and a second is not long enough to use. */
    const identity = neutral ? '(neutral)' : `${process.toLowerCase()}|${host || title}`;
    if (identity !== this.stableKey) {
      this.stableKey = identity;
      this.stableSince = Date.now();
    }
    const browser = isBrowserProcess(process);
    const settleMs = Math.max(0, Number(this.settings().settleSec) || 0) * 1000;
    const holdMs = browser ? settleMs : Math.min(settleMs, APP_GRACE_MS);
    const settling = !neutral && Date.now() - this.stableSince < holdMs;

    const judged = this.phase === 'work' && this.strict() && !neutral;
    const blocked = judged && !allowed && !settling;

    if (this.phase === 'work' && allowed && !neutral && !settling && hwnd) this.homeHwnd = hwnd;

    if (blocked && hwnd) {
      const again = this.lastBlocked && this.lastBlocked.hwnd === hwnd && Date.now() - this.lastBlocked.at < 10000;
      if (!again) this.blockedCount += 1;
      this.lastBlocked = { hwnd, at: Date.now() };
      this.emit('block', {
        offender: hwnd,
        target: this.homeHwnd,
        task: this.task,
        label: blockLabel(title, process, host),
        browser,
        host
      });
    }

    this.lastSample = { title, process, host, hwnd, blocked, path: sample.path || '' };
    this.emitState();
  }

  tick() {
    if (this.phase === 'idle') return;
    if (this.paused) { this.tickPaused(); return; }
    if (this.remaining() <= 0) {
      this.phaseComplete();
    }
    this.emitState();
  }

  phaseComplete() {
    const s = this.settings();
    if (this.phase === 'work') {
      this.logEntry(true);
      this.rounds += 1;
      this.emit('notify', {
        title: 'Round complete 🎉',
        body: `"${this.task}" done — take a ${s.breakMin} min break.`
      });
      this.phase = 'break';
      this.totalSec = s.breakMin * 60;
      this.endsAt = Date.now() + this.totalSec * 1000;
    } else if (this.phase === 'break') {
      this.emit('notify', {
        title: 'Break over',
        body: 'Ready for another round?'
      });
      this.toIdle();
    }
  }

  logEntry(completed) {
    const elapsedSec = Math.max(0, this.totalSec - this.remaining());
    const entry = {
      task: this.task,
      taskId: this.taskId,
      projectId: this.projectId,
      startedAt: this.startedAt,
      endedAt: Date.now(),
      plannedMin: this.plannedMin,
      // Nothing off-task can stay on screen, so the time spent is the time
      // focused. The field names are kept for the history already on disk.
      focusedSec: elapsedSec,
      distractedSec: 0,
      blockedCount: this.blockedCount,
      // What was let into the bubble after the round began.
      added: this.added.map((it) => (it.kind === 'site' ? it.domain : it.kind === 'app' ? it.name : it.text)),
      completed
    };
    this.store.data.history.unshift(entry);
    if (this.store.data.history.length > 500) this.store.data.history.length = 500;
    this.store.save();
    this.emit('history-changed');
    // The planner asks whether that finishes the task, and learns the duration
    // from what was actually spent. It needs the numbers before toIdle() wipes
    // them, so the event carries the finished entry itself.
    this.emit('round-ended', entry);
  }
}

module.exports = SessionManager;
module.exports.alwaysAllowed = alwaysAllowed;
module.exports.isNeutral = isNeutral;
module.exports.BROWSERS = BROWSERS;
