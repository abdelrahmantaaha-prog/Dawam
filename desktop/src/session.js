const { EventEmitter } = require('events');

const BROWSERS = ['chrome', 'msedge', 'brave', 'firefox', 'opera', 'vivaldi', 'arc', 'zen', 'iron', 'librewolf'];

// Stable identity for "this website / this app" so a triage verdict sticks
// across visits. Browsers key by the address-bar DOMAIN (whole-website
// verdicts: site:youtube.com covers every page there). When the domain
// can't be read, fall back to the last title segment; other apps key by
// process name.
function windowKey(title, process, host) {
  const proc = (process || '').toLowerCase();
  if (!BROWSERS.includes(proc)) return proc ? `app:${proc}` : null;
  const domain = (host || '').toLowerCase().replace(/^(www|m)\./, '');
  if (domain) return `site:${domain}`;
  const parts = String(title || '').trim().split(/\s+[-–—|·]\s+/);
  while (parts.length > 1 && /brave|chrome|edge|firefox|opera|vivaldi|librewolf/i.test(parts[parts.length - 1])) {
    parts.pop();
  }
  const site = (parts.length > 1 ? parts[parts.length - 1] : parts[0] || '').toLowerCase().trim();
  return site ? `site:${site}` : null;
}

/* Pausing is for a phone call, not for the rest of the afternoon.
 *
 * Everything that makes a work round mean anything — drift detection, the
 * nudge, the force-return — is gated on `!paused`, so an indefinite pause was
 * simply an off switch with an innocent name. Two limits close it: any one
 * pause resumes itself, and a round only has so much pause in it. Spend the
 * budget and the pause item stops working until the next round.
 *
 * The away-pause is deliberately exempt. That one is the app's own doing — it
 * fires when the chair empties and ends when the person sits back down — and
 * counting it would punish someone for being pulled away from a desk they then
 * came back to. It cannot be triggered by choice, which is what makes it safe
 * to leave uncapped. */
/* Keywords and sites that are never a distraction during a round, whatever
   the distraction list or a triage answer says. Matched the same way as every
   other list here: a case-insensitive substring of title + process + domain. */
function alwaysAllowed(settings) {
  return (Array.isArray(settings && settings.alwaysAllowed) ? settings.alwaysAllowed : [])
    .map((k) => String(k).toLowerCase().trim())
    .filter(Boolean);
}

const MAX_PAUSE_SEC = 5 * 60;      // one pause, at most
const PAUSE_BUDGET_SEC = 10 * 60;  // all manual pauses in one round, at most

// Session state machine: idle -> work -> break -> idle.
// Drift detection runs only during an unpaused work phase.
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
    this.distractedSec = 0;
    this.driftCount = 0;
    this.drift = null; // { startedAt, counted, lastNudgeAt, nextEnforceAt }
    this.allowed = [];
    this.homeHwnd = 0; // last on-task window — the "original doc" we force-return to
    this.pendingAsk = null; // { key, label } — unknown window awaiting a triage verdict
    this.snoozed = new Set(); // keys dismissed with "later" for this session
    this.unknownRun = null; // { key, count } — consecutive samples of the same unknown window
    this.sessionVerdicts = {}; // triage answers for THIS session; persisted only into the task's template
    this.stableKey = undefined; // identity of the current foreground window
    this.stableSince = 0; // when that identity last changed — drives the settling hold
    this.lastSample = { title: '', process: '', hwnd: 0, distracted: false };
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
    return this.allowed.length > 0;
  }

  enforceInSec() {
    if (!this.drift || !this.drift.counted || !this.drift.nextEnforceAt) return null;
    return Math.max(0, Math.ceil((this.drift.nextEnforceAt - Date.now()) / 1000));
  }

  getState() {
    const drifting = this.phase === 'work' && !this.paused && this.lastSample.distracted;
    return {
      strict: this.strict(),
      allowed: this.allowed,
      enforceInSec: drifting ? this.enforceInSec() : null,
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
      distractedSec: this.distractedSec,
      driftCount: this.driftCount,
      drifting,
      nudging: drifting && !!(this.drift && this.drift.counted),
      ask: this.phase === 'work' && !this.paused ? this.pendingAsk : null,
      current: {
        title: this.lastSample.title,
        process: this.lastSample.process,
        distracted: this.lastSample.distracted
      }
    };
  }

  setVerdict(key, verdict) {
    if (!key || !['work', 'distraction'].includes(verdict)) return;
    this.sessionVerdicts[key] = verdict;
    // Persist into the policy this round is running under, if any — a round
    // started without one forgets its verdicts when it ends.
    const tpl = this.templateId
      ? this.store.data.templates.find((t) => t.id === this.templateId)
      : null;
    if (tpl) {
      tpl.verdicts = tpl.verdicts || {};
      tpl.verdicts[key] = verdict;
      this.store.save();
    }
    if (this.pendingAsk && this.pendingAsk.key === key) this.pendingAsk = null;
    // Reclassify the current window immediately so the verdict takes effect now.
    this.onSample({
      title: this.lastSample.title,
      process: this.lastSample.process,
      host: this.lastSample.host,
      hwnd: this.lastSample.hwnd
    });
  }

  snoozeAsk(key) {
    this.snoozed.add(key);
    if (this.pendingAsk && this.pendingAsk.key === key) this.pendingAsk = null;
    this.emitState();
  }

  emitState() {
    this.emit('state', this.getState());
  }

  startWork(req) {
    const { task, workMin, allowed, taskId, templateId, projectId } = req || {};
    const min = Math.max(1, Math.min(240, Number(workMin) || this.settings().workMin));
    const newTask = String(task || 'Deep work').trim() || 'Deep work';
    /* Verdicts seed from the policy this round was started under — by id, not
       by matching the task's name. Templates are no longer tasks, so "what is
       allowed" and "what am I doing" are two separate questions and a policy
       can be reused across every task it suits. A follow-up round of the same
       task still keeps what was learned earlier this sitting. */
    const tpl = templateId ? this.store.data.templates.find((t) => t.id === templateId) : null;
    const carry = this.task === newTask ? this.sessionVerdicts : {};
    this.templateId = tpl ? tpl.id : null;
    this.sessionVerdicts = { ...((tpl && tpl.verdicts) || {}), ...carry };
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
    this.plannedMin = min;
    this.totalSec = min * 60;
    this.endsAt = Date.now() + this.totalSec * 1000;
    this.startedAt = Date.now();
    this.distractedSec = 0;
    this.driftCount = 0;
    this.drift = null;
    this.homeHwnd = 0;
    this.pendingAsk = null;
    this.snoozed.clear();
    this.unknownRun = null;
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
    this.drift = null;
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
    this.drift = null;
    this.allowed = [];
    this.homeHwnd = 0;
    this.pendingAsk = null;
    this.unknownRun = null;
    this.emitState();
  }

  onSample(sample) {
    const title = sample.title || '';
    const process = sample.process || '';
    const host = (sample.host || '').toLowerCase();
    const hwnd = Number(sample.hwnd) || 0;
    // Keywords (cleared list + distraction list) match the domain too, so
    // "youtube" hits youtube.com even if the page title never says YouTube.
    const hay = `${title} ${process} ${host}`.toLowerCase();

    // Anchor's own windows and title-less system surfaces (desktop, alt-tab)
    // are neutral — never a distraction, never the "home" window.
    const own = process.toLowerCase() === 'electron' || title === 'Anchor';
    const neutral = own || (!title && !process);

    // A window cleared for this task never counts as a distraction,
    // even if it matches the global distraction list. Neither does anything
    // on the always-allowed list (Focus settings → Lists) — a dictionary, the
    // docs you always work from. That list clears windows WITHOUT turning on
    // strict mode: strict is "only these", and always-allowed is "never
    // these", which are different promises.
    const cleared = (this.allowed || []).some((k) => hay.includes(k))
      || alwaysAllowed(this.settings()).some((k) => hay.includes(k));
    const key = neutral ? null : windowKey(title, process, host);

    // Slow pages briefly wear the wrong title while loading — hold judgment
    // for a few seconds after the window's identity changes before any
    // drift clock, countdown, or triage question starts.
    const identity = neutral ? '(neutral)' : key || `t:${hay}`;
    if (identity !== this.stableKey) {
      this.stableKey = identity;
      this.stableSince = Date.now();
    }
    const settleMs = Math.max(0, Number(this.settings().settleSec) || 0) * 1000;
    const settling = !neutral && Date.now() - this.stableSince < settleMs;

    // Triage verdicts beat everything except the cleared list — including
    // strict mode, where a "work" answer whitelists a window on the fly.
    const verdict = key ? this.sessionVerdicts[key] : undefined;
    let distracted;
    let unknownKey = null;
    if (neutral || cleared || verdict === 'work') {
      distracted = false;
    } else if (settling) {
      distracted = false;
    } else if (verdict === 'distraction') {
      distracted = true;
    } else if (this.strict()) {
      // Strict mode: unknown windows are off-task (the countdown runs), but
      // still get the ask — answering Work rescues them.
      distracted = true;
      unknownKey = key;
    } else {
      const keywords = this.settings().distractions
        .map((k) => String(k).toLowerCase().trim())
        .filter(Boolean);
      if (keywords.some((k) => hay.includes(k))) {
        distracted = true;
      } else {
        distracted = false;
        unknownKey = key;
      }
    }

    // In relaxed mode, ask only after the window holds the foreground for
    // ~3 samples (a quick pass-through shouldn't interrupt). In strict mode
    // ask immediately — the force-return clock is already ticking.
    const askAfter = this.strict() ? 1 : 3;
    if (unknownKey && this.phase === 'work' && !this.paused && !this.snoozed.has(unknownKey)) {
      if (this.unknownRun && this.unknownRun.key === unknownKey) {
        this.unknownRun.count += 1;
      } else {
        this.unknownRun = { key: unknownKey, count: 1 };
      }
      if (this.unknownRun.count >= askAfter && (!this.pendingAsk || this.pendingAsk.key !== unknownKey)) {
        this.pendingAsk = {
          key: unknownKey,
          label: unknownKey.replace(/^(site|app):/, '')
        };
      }
    } else if (!unknownKey) {
      this.unknownRun = null;
    }

    // A still-settling window must not become the force-return target.
    if (this.phase === 'work' && !this.paused && !distracted && !neutral && !settling && hwnd) {
      this.homeHwnd = hwnd;
    }

    this.lastSample = { title, process, host, hwnd, distracted };
    this.emitState();
  }

  tick() {
    if (this.phase === 'idle') return;
    if (this.paused) { this.tickPaused(); return; }

    if (this.phase === 'work' && this.lastSample.distracted) {
      this.distractedSec += 1;
      if (!this.drift) {
        this.drift = { startedAt: Date.now(), counted: false, lastNudgeAt: 0, nextEnforceAt: 0 };
      }
      const s = this.settings();
      // Strict mode (cleared list set) nudges almost immediately; otherwise
      // the grace period lets you glance at something without being scolded.
      const nudgeAtSec = this.strict() ? 1 : s.graceSec;
      const enforceSec = Math.max(3, Number(s.enforceSec) || 10);
      const driftSec = (Date.now() - this.drift.startedAt) / 1000;

      if (driftSec >= nudgeAtSec) {
        if (!this.drift.counted) {
          this.drift.counted = true;
          this.driftCount += 1;
          // The clock starts: enforceSec after the nudge, you get returned by force.
          this.drift.nextEnforceAt = Date.now() + enforceSec * 1000;
        }
        // Nudge once when grace runs out, then re-nudge every 45s while still drifting.
        if (Date.now() - this.drift.lastNudgeAt > 45000) {
          this.drift.lastNudgeAt = Date.now();
          this.emit('nudge', { task: this.task, title: this.lastSample.title });
        }
        if (this.drift.nextEnforceAt && Date.now() >= this.drift.nextEnforceAt) {
          this.drift.nextEnforceAt = Date.now() + enforceSec * 1000;
          this.emit('enforce', {
            offender: this.lastSample.hwnd,
            target: this.homeHwnd,
            task: this.task
          });
        }
      }
    } else if (this.drift) {
      this.drift = null;
    }

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
      this.drift = null;
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
      focusedSec: Math.max(0, elapsedSec - this.distractedSec),
      distractedSec: this.distractedSec,
      driftCount: this.driftCount,
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
