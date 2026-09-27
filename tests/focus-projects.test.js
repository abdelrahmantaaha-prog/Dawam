/* Focus time by project, and the always-allowed list.

   Two halves of one feature: the desktop session carries the project a round
   counts towards (and hands it back when the round ends), and the planner
   tallies the minutes on the project. Plus the allow list, which has to clear
   a window without quietly switching the round into strict mode. */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { addProjectFocus, fmtFocus, projectFocusBetween, projectFocusOn, projectFocusTotal, roundsByProject } from '../src/projectfocus.js';

const require = createRequire(import.meta.url);
const SessionManager = require('../desktop/src/session.js');

const fakeStore = (over = {}) => ({
  data: {
    settings: {
      workMin: 50, breakMin: 10, graceSec: 15, enforceSec: 10, settleSec: 0,
      distractions: ['youtube'], blocklist: [], freeTimes: [], alwaysAllowed: [],
      nudgeSound: false, breakScreen: false, chairDetect: false, awaySec: 10,
      ...over,
    },
    templates: [],
    history: [],
  },
  save() {},
});

describe('a round carries its project', () => {
  let sm;
  afterEach(() => clearInterval(sm.timer));

  it('keeps the project through the round and into the finished entry', () => {
    sm = new SessionManager(fakeStore()); clearInterval(sm.timer);
    let ended = null;
    sm.on('round-ended', (e) => { ended = e; });
    sm.startWork({ task: 'Chapter 3', workMin: 25, taskId: 't1', projectId: 'proj-book' });
    expect(sm.getState().projectId).toBe('proj-book');
    sm.totalSec = 25 * 60; sm.endsAt = Date.now() - 1; // run the clock out
    sm.tick();
    expect(ended).toBeTruthy();
    expect(ended.projectId).toBe('proj-book');
    expect(ended.taskId).toBe('t1');
  });

  it('forgets the project once the round is over', () => {
    sm = new SessionManager(fakeStore()); clearInterval(sm.timer);
    sm.startWork({ task: 'A', projectId: 'p' });
    sm.stop();
    expect(sm.getState().projectId).toBeNull();
    sm.startWork({ task: 'B' });
    expect(sm.getState().projectId).toBeNull();
  });
});

describe('always allowed', () => {
  let sm;
  beforeEach(() => {
    sm = new SessionManager(fakeStore({ alwaysAllowed: ['docs.google', 'Almaany'] }));
    clearInterval(sm.timer);
  });
  afterEach(() => clearInterval(sm.timer));

  it('never counts an allowed site as a distraction, even one on the distraction list', () => {
    sm.startWork({ task: 'Translate' });
    sm.onSample({ title: 'Doc - Google Docs', process: 'chrome', host: 'docs.google.com', hwnd: 1 });
    expect(sm.getState().current.distracted).toBe(false);
    // "almaany" matches case-insensitively, and wins over a triage-less unknown.
    sm.onSample({ title: 'YouTube word — almaany dictionary', process: 'chrome', host: 'almaany.com', hwnd: 2 });
    expect(sm.getState().current.distracted).toBe(false);
    expect(sm.getState().ask).toBeNull();
  });

  it('does not make the round strict', () => {
    sm.startWork({ task: 'Translate' });
    expect(sm.getState().strict).toBe(false);
    // An ordinary unlisted window is still fine in relaxed mode.
    sm.onSample({ title: 'Notes', process: 'notepad', host: '', hwnd: 3 });
    expect(sm.getState().current.distracted).toBe(false);
  });

  it('clears a window in strict mode too', () => {
    sm.startWork({ task: 'Translate', allowed: ['word'] });
    sm.onSample({ title: 'Glossary', process: 'chrome', host: 'docs.google.com', hwnd: 4 });
    expect(sm.getState().current.distracted).toBe(false);
    sm.onSample({ title: 'Something else', process: 'chrome', host: 'news.example', hwnd: 5 });
    expect(sm.getState().current.distracted).toBe(true);
  });

  it('still lets distractions be distractions', () => {
    sm.startWork({ task: 'Translate' });
    sm.onSample({ title: 'Cats - YouTube', process: 'chrome', host: 'youtube.com', hwnd: 6 });
    expect(sm.getState().current.distracted).toBe(true);
  });
});

describe('project focus tally', () => {
  const p = { id: 'p', name: 'Book' };

  it('adds minutes per day without touching the original', () => {
    const a = addProjectFocus(p, '2026-09-27', 25);
    const b = addProjectFocus(a, '2026-09-27', 30.4);
    const c = addProjectFocus(b, '2026-09-28', 50);
    expect(p.focus).toBeUndefined();
    expect(projectFocusOn(c, '2026-09-27')).toBe(55);
    expect(projectFocusTotal(c)).toBe(105);
    expect(projectFocusBetween(c, '2026-09-28', null)).toBe(50);
    expect(projectFocusBetween(c, null, '2026-09-27')).toBe(55);
  });

  it('ignores nothing-rounds and bad dates', () => {
    expect(addProjectFocus(p, '2026-09-27', 0)).toBe(p);
    expect(addProjectFocus(p, '2026-09-27', -5)).toBe(p);
    expect(addProjectFocus(p, 'yesterday', 20)).toBe(p);
    expect(addProjectFocus(null, '2026-09-27', 20)).toBe(null);
  });

  it('formats minutes the way a tally reads', () => {
    expect(fmtFocus(0)).toBe('0m');
    expect(fmtFocus(45)).toBe('45m');
    expect(fmtFocus(60)).toBe('1h');
    expect(fmtFocus(125)).toBe('2h 05m');
    expect(fmtFocus(1860)).toBe('31h');
  });

  it('sums rounds by project, loose rounds under null', () => {
    const by = roundsByProject([
      { projectId: 'a', focusedSec: 1500 },
      { projectId: 'a', focusedSec: 600 },
      { projectId: null, focusedSec: 1200 },
      { focusedSec: 60 },
    ]);
    expect(by.get('a')).toBe(35);
    expect(by.get(null)).toBe(21);
  });
});
