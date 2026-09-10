/* The bug this exists to make impossible: a week document saved under its
   neighbour's key. The tasks appear to shift a week, whatever really lived
   there is gone, and nothing reports anything. So the document carries its own
   week, and the stamp — not the caller — decides where a write lands. */
import { describe, it, expect } from 'vitest';
import { wsOf, writeTarget, stampWeek, looksSane } from '../src/weekdoc.js';

const A = '2026-09-05';
const B = '2026-09-12';
const doc = (ws, tasks = []) => (ws ? { ws, tasks } : { tasks });

describe('wsOf', () => {
  it('reads a real ISO week and nothing else', () => {
    expect(wsOf({ ws: A })).toBe(A);
    expect(wsOf({ ws: '5 Sep 2026' })).toBe(null);
    expect(wsOf({ ws: 20260905 })).toBe(null);
    expect(wsOf({})).toBe(null);
    expect(wsOf(null)).toBe(null);
  });
});

describe('writeTarget — an unstamped document', () => {
  it('trusts the caller and acquires the stamp', () => {
    const r = writeTarget(doc(null), A);
    expect(r).toMatchObject({ iso: A, redirected: false });
    expect(r.doc.ws).toBe(A);
  });
  it('has no answer at all without a usable request', () => {
    // The one case where there is nothing to go on. The caller must not write.
    expect(writeTarget(doc(null), undefined).iso).toBe(null);
    expect(writeTarget(doc(null), 'not-a-date').iso).toBe(null);
  });
});

describe('writeTarget — a stamped document', () => {
  it('agrees when the caller agrees', () => {
    const r = writeTarget(doc(A), A);
    expect(r).toMatchObject({ iso: A, redirected: false });
  });

  it('REDIRECTS a write aimed at the wrong week, instead of destroying it', () => {
    // This is the whole point. Pre-stamp, this call overwrote week B with week
    // A's tasks: B's work vanished and A's appeared to have shifted forward.
    const r = writeTarget(doc(A, [{ id: 't1', day: 0 }]), B);
    expect(r.iso).toBe(A);
    expect(r.redirected).toBe(true);
    expect(r.asked).toBe(B);
    expect(r.doc.tasks).toHaveLength(1);
  });

  it('keeps the edit rather than refusing it', () => {
    // A refused write silently loses what the person just did; a redirected one
    // puts it where it belongs, which is also what they meant.
    const edited = { ...doc(A), tasks: [{ id: 't1', day: 2, title: 'edited' }] };
    const r = writeTarget(edited, B);
    expect(r.doc.tasks[0].title).toBe('edited');
    expect(r.iso).toBe(A);
  });

  it('falls back to its own stamp when the caller says nothing', () => {
    expect(writeTarget(doc(B), undefined)).toMatchObject({ iso: B, redirected: false });
  });

  it('never mutates what it was handed', () => {
    const d = doc(A);
    writeTarget(d, B);
    expect(d).toEqual({ ws: A, tasks: [] });
  });
});

describe('stampWeek', () => {
  it('stamps on adoption so the next write is checked', () => {
    expect(stampWeek({ tasks: [] }, A)).toEqual({ tasks: [], ws: A });
  });
  it('re-stamps a document adopted for a different week', () => {
    // Adoption is the app saying "this IS week B's document" — a legitimate
    // re-labelling, unlike a write that merely believes it is.
    expect(stampWeek({ ws: A, tasks: [] }, B).ws).toBe(B);
  });
  it('survives nothing at all', () => {
    expect(stampWeek(null, A)).toEqual({ tasks: [], ws: A });
    expect(stampWeek(undefined, 'junk')).toEqual({ tasks: [] });
  });
});

describe('looksSane', () => {
  it('accepts day indices inside a week', () => {
    expect(looksSane({ ws: A, tasks: [{ day: 0 }, { day: 6 }] })).toBe(true);
    expect(looksSane({ ws: A, tasks: [] })).toBe(true);
  });
  it('rejects a malformed document', () => {
    expect(looksSane({ ws: A, tasks: [{ day: 7 }] })).toBe(false);
    expect(looksSane({ ws: A, tasks: [{ day: -1 }] })).toBe(false);
    expect(looksSane({ ws: A, tasks: [{}] })).toBe(false);
    expect(looksSane({ ws: A })).toBe(false);
    expect(looksSane(null)).toBe(false);
  });
  it('cannot detect a MISFILED document, which is why the stamp exists', () => {
    // A day index is 0-6 and says nothing about which week it belongs to.
    expect(looksSane({ ws: A, tasks: [{ day: 3 }] })).toBe(true);
  });
});
