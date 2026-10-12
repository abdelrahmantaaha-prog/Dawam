/* Bubbles: what an item lets through, and the session machine judging windows
   by items. bubble.js is pure, so these need neither Electron nor Windows. */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const B = require('../desktop/src/bubble.js');
const SessionManager = require('../desktop/src/session.js');

const CODE = { kind: 'app', exe: 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', name: 'VS Code' };
const BRAVE = { kind: 'app', exe: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', name: 'Brave' };
const DOCS = { kind: 'site', domain: 'docs.google.com', name: 'Docs' };

describe('domainOf', () => {
  it('takes the site out of whatever was dropped or typed', () => {
    expect(B.domainOf('https://www.github.com/anthropics/x?y=1#z')).toBe('github.com');
    expect(B.domainOf('docs.google.com/document/d/1')).toBe('docs.google.com');
    expect(B.domainOf('http://localhost:5173/')).toBeNull();
    expect(B.domainOf('just words')).toBeNull();
  });
});

describe('normalizeItems', () => {
  it('keeps one of each, drops junk, and reads a typed line as a site or a word', () => {
    const out = B.normalizeItems([CODE, { ...CODE, name: 'again' }, 'github.com', 'lecture', null, { kind: 'app' }]);
    expect(out.map((i) => i.kind)).toEqual(['app', 'site', 'word']);
    expect(out[1]).toMatchObject({ kind: 'site', domain: 'github.com' });
    expect(out[2]).toEqual({ kind: 'word', text: 'lecture' });
  });

  it('turns a saved focus mode into word items one for one — nothing narrows', () => {
    expect(B.itemsOfMode({ allowed: ['YouTube', 'docs.google.com'] }))
      .toEqual([{ kind: 'word', text: 'youtube' }, { kind: 'word', text: 'docs.google.com' }]);
    expect(B.itemsOfMode({ items: [DOCS] })).toEqual([DOCS]);
  });
});

describe('inBubble', () => {
  it('knows an app by its program file, not by what its window says', () => {
    const code = { title: 'main.js — rhythm', process: 'Code', path: CODE.exe };
    expect(B.inBubble(code, [CODE])).toBe(true);
    // A window that merely mentions the app is not the app.
    expect(B.inBubble({ title: 'VS Code tips - YouTube - Brave', process: 'brave', host: 'youtube.com' }, [CODE])).toBe(false);
  });

  it('follows an app that updated itself into a new folder', () => {
    const moved = { title: 'Code', process: 'Code', path: 'D:\\Apps\\VSCode-2\\Code.exe' };
    expect(B.inBubble(moved, [CODE])).toBe(true);
  });

  it('allows a site and what is under it, and nothing beside it', () => {
    const tab = (host) => ({ title: 'x', process: 'brave', path: BRAVE.exe, host });
    expect(B.inBubble(tab('docs.google.com'), [DOCS])).toBe(true);
    expect(B.inBubble(tab('mail.google.com'), [DOCS])).toBe(false);
    expect(B.inBubble(tab('evil-docs.google.com.example.org'), [DOCS])).toBe(false);
  });

  it('lets a sign-in page through when the bubble has sites', () => {
    const tab = { title: 'Sign in', process: 'chrome', host: 'accounts.google.com' };
    expect(B.inBubble(tab, [DOCS])).toBe(true);
    expect(B.inBubble(tab, [CODE])).toBe(false);   // no sites, nothing to sign in to
  });

  it('a browser put in as an app means every site in it', () => {
    expect(B.inBubble({ title: 'Reddit', process: 'brave', path: BRAVE.exe, host: 'reddit.com' }, [BRAVE])).toBe(true);
  });

  it('a site item does not let in a whole browser', () => {
    expect(B.inBubble({ title: 'Reddit', process: 'brave', path: BRAVE.exe, host: 'reddit.com' }, [DOCS])).toBe(false);
  });

  it('keeps old keywords working exactly as before', () => {
    expect(B.inBubble({ title: 'Some lecture - YouTube', process: 'brave', host: 'youtube.com' }, [{ kind: 'word', text: 'youtube' }])).toBe(true);
    expect(B.inBubble({ title: 'Notes', process: 'obsidian' }, [], ['obsidian'])).toBe(true);
  });
});

describe('urlAllowed / siteRules', () => {
  it('judges an address the same way', () => {
    const rules = B.siteRules([DOCS, CODE, { kind: 'word', text: 'arxiv' }]);
    expect(B.urlAllowed('https://docs.google.com/document/d/1', rules)).toBe(true);
    expect(B.urlAllowed('https://www.youtube.com/watch?v=1', rules)).toBe(false);
    expect(B.urlAllowed('https://arxiv.org/abs/1', rules)).toBe(true);
    expect(B.urlAllowed('https://accounts.google.com/signin', rules)).toBe(true);
    expect(B.urlAllowed('file:///C:/x.html', rules)).toBe(true);
  });

  it('puts no limit on a browser that is itself in the bubble, or when nothing runs', () => {
    expect(B.siteRules([BRAVE, DOCS])).toBeNull();
    expect(B.urlAllowed('https://anything.example', null)).toBe(true);
  });
});

describe('the session machine, under a bubble', () => {
  const fakeStore = () => ({
    data: { settings: { workMin: 50, breakMin: 10, settleSec: 5, alwaysAllowed: [] }, templates: [], history: [] },
    save() {}
  });
  let sm;
  beforeEach(() => { sm = new SessionManager(fakeStore()); clearInterval(sm.timer); });
  afterEach(() => clearInterval(sm.timer));

  it('blocks an app outside the bubble at once — no settling for apps', () => {
    const blocks = [];
    sm.on('block', (b) => blocks.push(b));
    sm.startWork({ task: 'Write', workMin: 30, items: [CODE, DOCS] });
    sm.onSample({ title: 'main.js', process: 'Code', path: CODE.exe, hwnd: 1 });
    sm.onSample({ title: 'Steam', process: 'steam', path: 'C:\\Steam\\steam.exe', hwnd: 2 });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ offender: 2, target: 1, browser: false });
  });

  it('still lets a browser page finish loading before judging it', () => {
    const blocks = [];
    sm.on('block', (b) => blocks.push(b));
    sm.startWork({ task: 'Write', workMin: 30, items: [DOCS] });
    sm.onSample({ title: 'Loading…', process: 'brave', host: 'example.com', hwnd: 3 });
    expect(blocks).toHaveLength(0);
    sm.stableSince = Date.now() - 6000;
    sm.onSample({ title: 'Example', process: 'brave', host: 'example.com', hwnd: 3 });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ browser: true, host: 'example.com' });
  });

  it('tells the browsers what may open, and nothing once the round ends', () => {
    sm.startWork({ task: 'Write', workMin: 30, items: [DOCS] });
    expect(sm.siteRules().domains).toEqual(['docs.google.com']);
    sm.stop();
    expect(sm.siteRules()).toBeNull();
  });

  it('keeps icons out of the state it broadcasts every second', () => {
    sm.startWork({ task: 'Write', workMin: 30, items: [{ ...CODE, icon: 'data:image/png;base64,AAAA' }] });
    expect(sm.getState().items[0].icon).toBeUndefined();
    expect(sm.items[0].icon).toBeDefined();
  });

  it('names the bubble from the saved one it runs under', () => {
    sm.store.data.templates = [{ id: 7, name: 'Writing', items: [DOCS] }];
    sm.startWork({ task: 'Draft', workMin: 30, items: [DOCS], templateId: 7 });
    expect(sm.getState().bubbleName).toBe('Writing');
  });
});
