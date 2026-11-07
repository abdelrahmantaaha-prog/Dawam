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
      workMin: 50, breakMin: 10, settleSec: 0, blocklist: [], freeTimes: [],
      breakScreen: false, chairDetect: false, awaySec: 10
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
    sm.endsAt = Date.now() - 1000; // the round's time is up
    sm.tick();

    expect(seen).toHaveLength(1);
    expect(seen[0].taskId).toBe('task-7');
    expect(seen[0].task).toBe('Write the brief');
    expect(seen[0].completed).toBe(true);
    // Nothing off-task can stay on screen, so the time spent is the time focused.
    expect(seen[0].focusedSec).toBe(60);
    expect(seen[0].distractedSec).toBe(0);
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

  it('under a focus mode, blocks everything not on the allow list — and only that', () => {
    const blocks = [];
    sm.on('block', (b) => blocks.push(b));
    sm.startWork({ task: 'Watch the lecture', workMin: 30, allowed: ['youtube'], taskId: 'task-9' });
    expect(sm.getState().strict).toBe(true);
    // Allowed: simply open, and it becomes the window a block sends you back to.
    sm.onSample({ title: 'Some lecture - YouTube', process: 'brave', host: 'youtube.com', hwnd: 5 });
    expect(sm.getState().current.blocked).toBe(false);
    expect(blocks).toHaveLength(0);
    // Not allowed: blocked at once, no grace, no question.
    sm.onSample({ title: 'Reddit', process: 'brave', host: 'reddit.com', hwnd: 6 });
    expect(sm.getState().current.blocked).toBe(true);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ offender: 6, target: 5, label: 'reddit.com' });
    expect(sm.getState().taskId).toBe('task-9');
    // The same window coming back within seconds is one block, not two.
    sm.onSample({ title: 'Reddit', process: 'brave', host: 'reddit.com', hwnd: 6 });
    expect(sm.getState().blockedCount).toBe(1);
  });

  it('keeps blocking through a pause — the clock waits, the rules do not', () => {
    const blocks = [];
    sm.on('block', (b) => blocks.push(b));
    sm.startWork({ task: 'Write', workMin: 30, allowed: ['word'] });
    sm.pause();
    sm.onSample({ title: 'Netflix', process: 'chrome', host: 'netflix.com', hwnd: 8 });
    expect(blocks).toHaveLength(1);
  });

  it('never blocks Dawam (or the Rhythm it was), the Windows shell, Task Manager or a blank new tab', () => {
    const blocks = [];
    sm.on('block', (b) => blocks.push(b));
    sm.startWork({ task: 'Write', workMin: 30, allowed: ['word'] });
    for (const w of [
      { title: 'Dawam', process: 'Dawam', hwnd: 1 },
      { title: 'Rhythm', process: 'Rhythm', hwnd: 6 },
      { title: '', process: 'explorer', hwnd: 2 },
      { title: 'Search', process: 'SearchHost', hwnd: 3 },
      { title: 'Task Manager', process: 'Taskmgr', hwnd: 4 },
      { title: 'New Tab - Google Chrome', process: 'chrome', host: '', hwnd: 5 },
    ]) sm.onSample(w);
    expect(blocks).toHaveLength(0);
  });

  it('blocks nothing in a round without a focus mode, or on a break', () => {
    const blocks = [];
    sm.on('block', (b) => blocks.push(b));
    sm.startWork({ task: 'Deep work', workMin: 30, allowed: [] });
    sm.onSample({ title: 'YouTube', process: 'chrome', host: 'youtube.com', hwnd: 9 });
    sm.startWork({ task: 'Write', workMin: 30, allowed: ['word'] });
    sm.phase = 'break';
    sm.onSample({ title: 'YouTube', process: 'chrome', host: 'youtube.com', hwnd: 9 });
    expect(blocks).toHaveLength(0);
  });

  it('waits out a page that is still loading before judging it', () => {
    store.data.settings.settleSec = 5;
    const blocks = [];
    sm.on('block', (b) => blocks.push(b));
    sm.startWork({ task: 'Write', workMin: 30, allowed: ['docs.google.com'] });
    sm.onSample({ title: 'Loading…', process: 'chrome', host: 'example.com', hwnd: 3 });
    expect(blocks).toHaveLength(0);
    sm.stableSince = Date.now() - 6000;
    sm.onSample({ title: 'Example', process: 'chrome', host: 'example.com', hwnd: 3 });
    expect(blocks).toHaveLength(1);
  });
});
