/* Duration memory. What matters: the person's own numbers outrank the
   model's, learning is keyed by text not by task id, and junk never
   becomes a "remembered" duration. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

function makeLS() {
  let m = {};
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    key: (i) => Object.keys(m)[i] ?? null,
    get length() { return Object.keys(m).length; },
  };
}

let ls;
beforeEach(() => { ls = makeLS(); globalThis.localStorage = ls; vi.resetModules(); });
const load = async () => { const m = await import('../src/durations.js'); await m.loadDurations(); return m; };

describe('normTitle — same task, same key', () => {
  it('ignores case, edge whitespace and doubled spaces', async () => {
    const { normTitle } = await load();
    expect(normTitle('  Email  the Client ')).toBe('email the client');
    expect(normTitle('EMAIL THE CLIENT')).toBe('email the client');
  });
});

describe('rememberDuration', () => {
  it('learns, and future lookups by the same text find it', async () => {
    const d = await load();
    expect(await d.rememberDuration('Email the client', 40, 'manual')).toBe(true);
    expect(d.durationFor('email the client')).toBe(40);
    expect(d.durationFor('  Email the Client ')).toBe(40);
  });

  it('survives a reload — it is storage, not component state', async () => {
    const d = await load();
    await d.rememberDuration('Email the client', 40, 'manual');
    vi.resetModules();
    const d2 = await load();
    expect(d2.durationFor('Email the client')).toBe(40);
  });

  it('a weaker source never overwrites a stronger one', async () => {
    // The person said 40. A kept slot saying 25 and a model saying 90 are
    // both opinions about something the person already settled.
    const d = await load();
    await d.rememberDuration('Deep work', 40, 'manual');
    expect(await d.rememberDuration('Deep work', 25, 'kept')).toBe(false);
    expect(await d.rememberDuration('Deep work', 90, 'ai')).toBe(false);
    expect(d.durationFor('Deep work')).toBe(40);
  });

  it('an equal or stronger source updates freely', async () => {
    const d = await load();
    await d.rememberDuration('Deep work', 90, 'ai');
    expect(await d.rememberDuration('Deep work', 45, 'kept')).toBe(true);   // kept > ai
    expect(await d.rememberDuration('Deep work', 40, 'manual')).toBe(true); // manual > kept
    expect(await d.rememberDuration('Deep work', 60, 'manual')).toBe(true); // manual repeats win
    expect(d.durationFor('Deep work')).toBe(60);
  });

  it('rejects junk instead of remembering it', async () => {
    const d = await load();
    expect(await d.rememberDuration('', 40, 'manual')).toBe(false);
    expect(await d.rememberDuration('x', 0, 'manual')).toBe(false);
    expect(await d.rememberDuration('x', 3, 'manual')).toBe(false);    // under 5min is noise
    expect(await d.rememberDuration('x', 700, 'manual')).toBe(false);  // 11h is not a task
    expect(d.durationFor('x')).toBe(null);
  });

  it('does not rewrite storage when nothing changed', async () => {
    const d = await load();
    await d.rememberDuration('Email', 40, 'manual');
    // an identical fact must not churn sync with a fresh timestamp
    expect(await d.rememberDuration('Email', 40, 'manual')).toBe(false);
  });

  it('forgetDuration removes exactly one title', async () => {
    const d = await load();
    await d.rememberDuration('a', 30, 'manual');
    await d.rememberDuration('b', 30, 'manual');
    expect(await d.forgetDuration('a')).toBe(true);
    expect(d.durationFor('a')).toBe(null);
    expect(d.durationFor('b')).toBe(30);
  });
});
