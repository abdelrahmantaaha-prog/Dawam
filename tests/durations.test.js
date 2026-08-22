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

  it('an equal or stronger source takes over the answer', async () => {
    const d = await load();
    await d.rememberDuration('Deep work', 90, 'ai');
    expect(d.durationFor('Deep work')).toBe(90);
    expect(await d.rememberDuration('Deep work', 45, 'kept')).toBe(true);   // kept > ai
    expect(d.durationFor('Deep work')).toBe(45);                            // the guess stops counting
    expect(await d.rememberDuration('Deep work', 40, 'manual')).toBe(true); // manual > kept
    expect(d.durationFor('Deep work')).toBe(40);
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

describe('the rolling average', () => {
  it('averages the recent sittings instead of taking the last one', async () => {
    const d = await load();
    await d.rememberDuration('Email the client', 40, 'manual');
    await d.rememberDuration('Email the client', 50, 'manual');
    expect(d.durationFor('Email the client')).toBe(45);
    await d.rememberDuration('Email the client', 30, 'manual');
    expect(d.durationFor('Email the client')).toBe(40); // (40+50+30)/3
  });

  it('does not let one odd afternoon own the estimate', async () => {
    // Four sittings around 40 minutes, then one that took 10 because it was
    // already half written. Last-one-wins would size every future slot at 10.
    // A week apart, because two identical numbers in the same minute are one
    // event written twice and are deliberately collapsed.
    const d = await load();
    vi.useFakeTimers();
    const week = (n) => vi.setSystemTime(new Date(2026, 0, 5 + n * 7));
    let n = 0;
    for (const m of [40, 40, 45, 35]) { week(n++); await d.rememberDuration('Weekly report', m, 'manual'); }
    expect(d.durationFor('Weekly report')).toBe(40);
    week(n++);
    await d.rememberDuration('Weekly report', 10, 'manual');
    expect(d.durationFor('Weekly report')).toBe(34); // moved, not hijacked
    vi.useRealTimers();
  });

  it('collapses the same completion reported twice', async () => {
    // Finishing from a focus round writes the slot length and the measured
    // length in the same instant; that is one sitting, not two.
    const d = await load();
    await d.rememberDuration('Email', 40, 'kept');
    expect(await d.rememberDuration('Email', 40, 'kept')).toBe(false);
    expect(d.durationDetail('Email')).toMatchObject({ sittings: 1 });
  });

  it('forgets the oldest sitting once the window is full', async () => {
    // Five short sittings, then five long ones: the short ones age out
    // completely rather than holding the average down forever.
    const d = await load();
    for (let i = 0; i < 5; i++) await d.rememberDuration('Standup', 10 + i, 'manual');
    for (let i = 0; i < 5; i++) await d.rememberDuration('Standup', 60 + i, 'manual');
    expect(d.durationFor('Standup')).toBe(62); // (60+61+62+63+64)/5
  });

  it('averages within a source, never across them', async () => {
    // A model's 90 has no vote once the person has said 40 twice.
    const d = await load();
    await d.rememberDuration('Deep work', 90, 'ai');
    await d.rememberDuration('Deep work', 40, 'manual');
    await d.rememberDuration('Deep work', 44, 'manual');
    expect(d.durationFor('Deep work')).toBe(42);
    expect(d.durationDetail('Deep work')).toMatchObject({ minutes: 42, source: 'manual', sittings: 2 });
  });

  it('keeps a manual number alive through a run of weaker guesses', async () => {
    const d = await load();
    await d.rememberDuration('Deep work', 40, 'manual');
    for (let i = 0; i < 8; i++) await d.rememberDuration('Deep work', 90, 'ai');
    expect(d.durationFor('Deep work')).toBe(40);
  });

  it('reads an entry written before averaging as its first sitting', async () => {
    // The stored shape used to be a bare { m, src, at }.
    ls.setItem('planner:durations', JSON.stringify({ 'old task': { m: 30, src: 'manual', at: 1 } }));
    const d = await load();
    expect(d.durationFor('Old task')).toBe(30);
    await d.rememberDuration('Old task', 50, 'manual');
    expect(d.durationFor('Old task')).toBe(40); // averaged with what was already known
  });

  it('says how the number was arrived at', async () => {
    const d = await load();
    expect(d.durationDetail('nothing')).toBe(null);
    await d.rememberDuration('Email', 40, 'kept');
    expect(d.durationDetail('Email')).toEqual({ minutes: 40, source: 'kept', sittings: 1 });
  });
});
