/* The focus session machine — specifically the parts the merge added.

   The desktop smoke test proves the same seam through three real processes,
   but it costs 45 seconds and an Electron launch. These cover the logic that
   actually carries a planned task through a round, so a regression shows up
   in `npm test` rather than only when someone remembers to run the app. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SessionManager = require('../desktop/src/session.js');

/* The real Store touches Electron's userData path; the machine only ever
   reads .data, so a plain object is the whole dependency. */
const fakeStore = () => ({
  data: {
    settings: {
      workMin: 50, breakMin: 10, graceSec: 15, enforceSec: 10, settleSec: 0,
      distractions: ['youtube'], blocklist: [], freeTimes: [],
      nudgeSound: false, breakScreen: false, chairDetect: false, awaySec: 10
    },
    templates: [],
    history: []
  },
  saved: 0,
  save() { this.saved += 1; }
});

describe('focus session ↔ planner task', () => {
  let store, sm;

  beforeEach(() => {
    store = fakeStore();
    sm = new SessionManager(store);
    clearInterval(sm.timer); // the tick is driven by hand in these tests
  });
  afterEach(() => { clearInterval(sm.timer); vi.useRealTimers(); });

  it('carries the planner task id into the running session', () => {
    sm.startWork({ task: 'Write the brief', workMin: 25, allowed: [], taskId: 'task-7' });
    const s = sm.getState();
    expect(s.phase).toBe('work');
    expect(s.task).toBe('Write the brief');
    expect(s.taskId).toBe('task-7');
    expect(s.plannedMin).toBe(25);
  });

  it('treats an ad-hoc round as task-less rather than inventing a link', () => {
    sm.startWork({ task: 'Deep work' });
    expect(sm.getState().taskId).toBeNull();
  });

  it('clamps the round length and falls back to the settings default', () => {
    sm.startWork({ task: 'A', workMin: 9999 });
    expect(sm.getState().plannedMin).toBe(240);
    sm.startWork({ task: 'B' });
    expect(sm.getState().plannedMin).toBe(50);
  });

  it('announces a finished round with the task id and the measured time', () => {
    const seen = [];
    sm.on('round-ended', (e) => seen.push(e));

    sm.startWork({ task: 'Write the brief', workMin: 1, allowed: [], taskId: 'task-7' });
    // Two minutes of wall clock: the round's one minute is spent, and 20s of
    // it went to a window that was off-task.
    sm.lastSample = { title: 'youtube', process: 'brave', hwnd: 1, distracted: true };
    // 19 seconds banked; the tick below is still an off-task second itself,
    // and it is the one that finds the round's time is up.
    sm.distractedSec = 19;
    sm.endsAt = Date.now() - 1000; // the round's time is up
    sm.tick();

    expect(seen).toHaveLength(1);
    expect(seen[0].taskId).toBe('task-7');
    expect(seen[0].task).toBe('Write the brief');
    expect(seen[0].completed).toBe(true);
    expect(seen[0].distractedSec).toBe(20);
    expect(seen[0].focusedSec).toBe(40); // 60 spent less 20 drifted
    expect(store.data.history[0].taskId).toBe('task-7');
  });

  it('announces a round stopped by hand, but only once it was worth counting', () => {
    const seen = [];
    sm.on('round-ended', (e) => seen.push(e));

    sm.startWork({ task: 'Short', workMin: 50, taskId: 'task-1' });
    sm.stop();
    expect(seen).toHaveLength(0); // a few seconds is not a round

    sm.startWork({ task: 'Long enough', workMin: 50, taskId: 'task-2' });
    sm.endsAt = Date.now() + (50 * 60 - 45) * 1000; // 45 seconds in
    sm.stop();
    expect(seen).toHaveLength(1);
    expect(seen[0].completed).toBe(false);
    expect(seen[0].taskId).toBe('task-2');
    expect(seen[0].focusedSec).toBeGreaterThanOrEqual(44);
  });

  it('lets go of the task when the session goes idle', () => {
    sm.startWork({ task: 'Write the brief', workMin: 25, taskId: 'task-7' });
    sm.toIdle();
    expect(sm.getState().taskId).toBeNull();
    expect(sm.getState().phase).toBe('idle');
  });

  it('keeps a task-linked round strict when the task cleared some windows', () => {
    sm.startWork({ task: 'Watch the lecture', workMin: 30, allowed: ['youtube'], taskId: 'task-9' });
    expect(sm.getState().strict).toBe(true);
    // A cleared window is on-task even though it is on the distraction list.
    sm.onSample({ title: 'Some lecture - YouTube', process: 'brave', host: 'youtube.com', hwnd: 5 });
    expect(sm.getState().current.distracted).toBe(false);
    // Anything else is off-task in strict mode, and the task id survives it.
    sm.onSample({ title: 'Reddit', process: 'brave', host: 'reddit.com', hwnd: 6 });
    expect(sm.getState().current.distracted).toBe(true);
    expect(sm.getState().taskId).toBe('task-9');
  });
});
