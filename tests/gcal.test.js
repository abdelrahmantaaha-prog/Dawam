/* Tests for the pure Google Calendar logic — normalization and bucketing.
   The network/OAuth path needs a live Google project and is verified there. */
import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeEvent, bucketDayEvents, saveGcalToken, loadGcalToken, clearGcalToken } from '../src/gcal.js';
import { activeBlockAt, DEFAULT_TIMINGS } from '../src/core.jsx';

function makeLS() {
  let m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, key: (i) => Object.keys(m)[i] ?? null, get length() { return Object.keys(m).length; } };
}
beforeEach(() => { globalThis.localStorage = makeLS(); });

describe('normalizeEvent', () => {
  it('timed event → startMin + HH:MM, not all-day', () => {
    const ev = normalizeEvent({ id: 'a', summary: 'Standup', start: { dateTime: '2026-07-13T09:30:00' }, end: { dateTime: '2026-07-13T10:00:00' } }, 'calX');
    expect(ev.allDay).toBe(false);
    expect(ev.startMin).toBe(9 * 60 + 30);
    expect(ev.startHM).toBe('09:30');
    expect(ev.id).toBe('calX::a');
    expect(ev.title).toBe('Standup');
  });
  it('all-day event → allDay true, no startMin', () => {
    const ev = normalizeEvent({ id: 'b', summary: 'Eid', start: { date: '2026-07-13' }, end: { date: '2026-07-14' } }, 'calX');
    expect(ev.allDay).toBe(true);
    expect(ev.startMin).toBe(null);
    expect(ev.startHM).toBe('');
  });
  it('missing title falls back', () => {
    const ev = normalizeEvent({ id: 'c', start: { dateTime: '2026-07-13T12:00:00' } }, 'calX');
    expect(ev.title).toBe('(no title)');
  });
});

describe('bucketDayEvents', () => {
  const blockOf = (min) => activeBlockAt(DEFAULT_TIMINGS, min); // Fajr 04:15, Dhuhr 12:55, Asr 16:30, Maghrib 19:45, Isha 21:15
  it('routes timed events to their prayer block and sorts within a block', () => {
    const evs = [
      normalizeEvent({ id: '1', summary: 'Late meeting', start: { dateTime: '2026-07-13T17:00:00' } }, 'c'), // asr
      normalizeEvent({ id: '2', summary: 'Morning sync', start: { dateTime: '2026-07-13T09:00:00' } }, 'c'), // morning
      normalizeEvent({ id: '3', summary: 'Lunch review', start: { dateTime: '2026-07-13T13:30:00' } }, 'c'), // dhuhr
      normalizeEvent({ id: '4', summary: 'Early asr call', start: { dateTime: '2026-07-13T16:35:00' } }, 'c'), // asr
    ];
    const { byBlock, allDay } = bucketDayEvents(evs, blockOf);
    expect(allDay).toHaveLength(0);
    expect(byBlock.morning.map((e) => e.title)).toEqual(['Morning sync']);
    expect(byBlock.dhuhr.map((e) => e.title)).toEqual(['Lunch review']);
    expect(byBlock.asr.map((e) => e.title)).toEqual(['Early asr call', 'Late meeting']); // sorted by time
  });
  it('separates all-day events into the pinned list', () => {
    const evs = [
      normalizeEvent({ id: 'a', summary: 'Conference', start: { date: '2026-07-13' } }, 'c'),
      normalizeEvent({ id: 'b', summary: '10am talk', start: { dateTime: '2026-07-13T10:00:00' } }, 'c'),
    ];
    const { allDay, byBlock } = bucketDayEvents(evs, blockOf);
    expect(allDay.map((e) => e.title)).toEqual(['Conference']);
    expect(byBlock.morning.map((e) => e.title)).toEqual(['10am talk']);
  });
});

describe('token store', () => {
  it('saves and loads a live token', () => {
    saveGcalToken('tok-123', 3600);
    expect(loadGcalToken()).toBe('tok-123');
  });
  it('treats an expired token as absent', () => {
    saveGcalToken('tok-old', 0); // expiry = now - 120s buffer → already expired
    expect(loadGcalToken()).toBe(null);
  });
  it('clear removes it', () => {
    saveGcalToken('tok', 3600); clearGcalToken();
    expect(loadGcalToken()).toBe(null);
  });
});
