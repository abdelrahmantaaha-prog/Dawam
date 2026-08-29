/* Pausing was an off switch with an innocent name.

   Drift detection, the nudge and the force-return are all gated on
   `!paused`, so a pause that never ends disables every part of a focus round
   while the round still looks like it is running. These pin the two limits
   that close it, and the one exemption that must stay open. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const SessionManager = require_('../desktop/src/session.js');

const MAX_PAUSE_SEC = 5 * 60;
const BUDGET_SEC = 10 * 60;

// The manager only ever reads settings and templates off the store.
const fakeStore = () => ({
  data: {
    settings: { workMin: 25, graceSec: 20, enforceSec: 10 },
    templates: [],
    history: [],
  },
  save() {},
});

describe('a pause cannot run forever', () => {
  let s;
  beforeEach(() => {
    vi.useFakeTimers();
    s = new SessionManager(fakeStore());
    s.startWork({ task: 'Deep work', workMin: 60 });
  });
  afterEach(() => { clearInterval(s.timer); vi.useRealTimers(); });

  const runSeconds = (n) => vi.advanceTimersByTime(n * 1000);

  it('resumes itself once one pause has run its length', () => {
    expect(s.pause()).toBe(true);
    expect(s.getState().paused).toBe(true);

    runSeconds(MAX_PAUSE_SEC - 5);
    expect(s.getState().paused, 'still paused just before the cap').toBe(true);

    runSeconds(10);
    expect(s.getState().paused, 'the cap resumed it').toBe(false);
  });

  it('does not let the round clock run while paused', () => {
    const before = s.remaining();
    s.pause();
    runSeconds(60);
    // The point of a pause is that the round waits. It just cannot wait
    // indefinitely.
    expect(s.remaining()).toBe(before);
  });

  it('spends a budget across repeated pauses, then refuses', () => {
    // The obvious way round a single-pause cap is to pause again, so the
    // budget is what actually closes it.
    for (let i = 0; i < 2; i++) {
      expect(s.pause(), `pause ${i + 1} allowed`).toBe(true);
      runSeconds(MAX_PAUSE_SEC);       // auto-resumes at the cap
      expect(s.getState().paused).toBe(false);
    }
    expect(s.getState().pauseBudgetLeftSec).toBe(0);
    expect(s.pause(), 'the budget is spent').toBe(false);
    expect(s.getState().paused).toBe(false);
  });

  it('reports how long is left, so the tray can say it', () => {
    s.pause();
    runSeconds(60);
    const st = s.getState();
    expect(st.pauseLeftSec).toBeLessThanOrEqual(MAX_PAUSE_SEC - 60);
    expect(st.pauseBudgetLeftSec).toBeLessThanOrEqual(BUDGET_SEC - 60);
  });

  it('gives every new round a fresh budget', () => {
    s.pause();
    runSeconds(MAX_PAUSE_SEC);
    expect(s.getState().pauseBudgetLeftSec).toBeLessThan(BUDGET_SEC);
    s.startWork({ task: 'Next thing', workMin: 25 });
    expect(s.getState().pauseBudgetLeftSec).toBe(BUDGET_SEC);
  });
});

describe('the away-pause stays exempt', () => {
  let s;
  beforeEach(() => {
    vi.useFakeTimers();
    s = new SessionManager(fakeStore());
    s.startWork({ task: 'Deep work', workMin: 60 });
  });
  afterEach(() => { clearInterval(s.timer); vi.useRealTimers(); });

  it('never expires on its own — the chair, not a clock, ends it', () => {
    // Nobody chose this one and it cannot be triggered deliberately, which is
    // what makes it safe to leave uncapped. Capping it would punish someone
    // for being called away from a desk they then came back to.
    s.pause({ auto: true });
    vi.advanceTimersByTime((MAX_PAUSE_SEC + 120) * 1000);
    expect(s.getState().paused).toBe(true);
    expect(s.getState().pauseAuto).toBe(true);
  });

  it('spends none of the manual budget', () => {
    s.pause({ auto: true });
    vi.advanceTimersByTime(8 * 60 * 1000);
    s.resume();
    expect(s.getState().pauseBudgetLeftSec).toBe(BUDGET_SEC);
    expect(s.pause(), 'a real pause is still available afterwards').toBe(true);
  });
});
