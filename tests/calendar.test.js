/* The iCalendar reader.

   These are written against the shapes a real Google feed emits, because that
   is what this code will actually be handed: folded lines, TZID stamps, an
   RRULE with EXDATEs, a single instance edited out of a series, all-day events
   as VALUE=DATE, and the "shows me as free" flag that must not become a wall. */

import { describe, it, expect } from 'vitest';
import { parseICS, expandEvents, expandRule, busyForDay, stampToMs } from '../src/calendar.js';

const ics = (body) => `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
X-WR-CALNAME:Work
${body}
END:VCALENDAR`;

const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi, 0, 0).getTime();
const dayOf = (y, m, d) => new Date(y, m - 1, d);
const window2026 = [at(2026, 1, 1), at(2027, 1, 1)];

describe('parseICS', () => {
  it('reads a plain event and the calendar name', () => {
    const p = parseICS(ics(`BEGIN:VEVENT
UID:abc@google.com
SUMMARY:Standup
DTSTART;TZID=Africa/Cairo:20260824T100000
DTEND;TZID=Africa/Cairo:20260824T103000
END:VEVENT`));
    expect(p.calName).toBe('Work');
    expect(p.events).toHaveLength(1);
    expect(p.events[0].summary).toBe('Standup');
    expect(p.events[0].start.zone).toBe('Africa/Cairo');
  });

  it('unfolds continuation lines before parsing them', () => {
    // A long SUMMARY arrives split; the continuation starts with one space.
    const p = parseICS(ics(`BEGIN:VEVENT
UID:x
SUMMARY:Quarterly review with the whole team about the roadm
 ap and the budget
DTSTART:20260824T100000Z
DTEND:20260824T110000Z
END:VEVENT`));
    expect(p.events[0].summary).toBe('Quarterly review with the whole team about the roadmap and the budget');
  });

  it('unescapes the text escapes iCalendar requires', () => {
    const p = parseICS(ics(`BEGIN:VEVENT
UID:x
SUMMARY:Lunch\\, then a walk\\; maybe\\nback by 3
DTSTART:20260824T100000Z
DTEND:20260824T110000Z
END:VEVENT`));
    expect(p.events[0].summary).toBe('Lunch, then a walk; maybe\nback by 3');
  });

  it('does not mistake a colon inside a quoted parameter for the value separator', () => {
    const p = parseICS(ics(`BEGIN:VEVENT
UID:x
DTSTART;TZID="Africa/Cairo":20260824T100000
DTEND;TZID="Africa/Cairo":20260824T110000
SUMMARY:Call
END:VEVENT`));
    expect(p.events[0].start.zone).toBe('Africa/Cairo');
    expect(p.events[0].start.h).toBe(10);
  });

  it('treats a bare date as an all-day event', () => {
    const p = parseICS(ics(`BEGIN:VEVENT
UID:x
SUMMARY:Eid
DTSTART;VALUE=DATE:20260320
DTEND;VALUE=DATE:20260321
END:VEVENT`));
    expect(p.events[0].start.allDay).toBe(true);
  });
});

describe('stampToMs', () => {
  it('reads a UTC stamp as an instant', () => {
    expect(stampToMs({ y: 2026, mo: 8, d: 24, h: 9, mi: 0, s: 0, zone: 'UTC' }))
      .toBe(Date.UTC(2026, 7, 24, 9, 0, 0));
  });

  it('reads a zoned stamp through that zone, not the device', () => {
    // Cairo is UTC+3 in August (DST), so 10:00 there is 07:00 UTC.
    expect(stampToMs({ y: 2026, mo: 8, d: 24, h: 10, mi: 0, s: 0, zone: 'Africa/Cairo' }))
      .toBe(Date.UTC(2026, 7, 24, 7, 0, 0));
    // …and UTC+2 in January, with no DST.
    expect(stampToMs({ y: 2026, mo: 1, d: 24, h: 10, mi: 0, s: 0, zone: 'Africa/Cairo' }))
      .toBe(Date.UTC(2026, 0, 24, 8, 0, 0));
  });

  it('falls back to the device zone when the zone name is not one Intl knows', () => {
    const ms = stampToMs({ y: 2026, mo: 8, d: 24, h: 10, mi: 0, s: 0, zone: 'Mars/Olympus' });
    expect(ms).toBe(at(2026, 8, 24, 10, 0));
  });

  it('puts an all-day event at local midnight, wherever it is read', () => {
    expect(stampToMs({ y: 2026, mo: 3, d: 20, allDay: true })).toBe(at(2026, 3, 20));
  });
});

describe('recurrence', () => {
  const start = { y: 2026, mo: 8, d: 24, h: 10, mi: 0, s: 0, zone: 'UTC' }; // a Monday

  it('walks a daily rule with an interval', () => {
    const out = expandRule(start, { freq: 'DAILY', interval: 3 }, at(2026, 8, 24), at(2026, 9, 3));
    expect(out.map((s) => s.d)).toEqual([24, 27, 30, 2]);
  });

  it('stops at COUNT', () => {
    const out = expandRule(start, { freq: 'DAILY', interval: 1, count: 3 }, at(2026, 8, 1), at(2026, 12, 1));
    expect(out).toHaveLength(3);
  });

  it('stops at UNTIL', () => {
    const until = { y: 2026, mo: 8, d: 27, h: 0, mi: 0, s: 0, zone: 'UTC' };
    const out = expandRule(start, { freq: 'DAILY', interval: 1, until }, at(2026, 8, 1), at(2026, 12, 1));
    expect(out.map((s) => s.d)).toEqual([24, 25, 26]);
  });

  it('walks a weekly rule across the days it names', () => {
    // The window ends at midnight opening 8 September, so the 10:00 meeting
    // on the 7th is inside it and nothing on the 9th is.
    const out = expandRule(start, { freq: 'WEEKLY', interval: 1, byday: ['MO', 'WE'] }, at(2026, 8, 24), at(2026, 9, 8));
    expect(out.map((s) => `${s.mo}/${s.d}`)).toEqual(['8/24', '8/26', '8/31', '9/2', '9/7']);
  });

  it('counts weeks, not days, when a weekly rule has an interval', () => {
    const out = expandRule(start, { freq: 'WEEKLY', interval: 2, byday: ['MO'] }, at(2026, 8, 24), at(2026, 10, 1));
    expect(out.map((s) => `${s.mo}/${s.d}`)).toEqual(['8/24', '9/7', '9/21']);
  });

  it('finds the nth weekday of the month', () => {
    // The second Tuesday, every month.
    const out = expandRule(start, { freq: 'MONTHLY', interval: 1, byday: ['2TU'] }, at(2026, 8, 1), at(2026, 11, 1));
    expect(out.map((s) => `${s.mo}/${s.d}`)).toEqual(['9/8', '10/13']);
  });

  it('finds the last weekday of the month', () => {
    const out = expandRule(start, { freq: 'MONTHLY', interval: 1, byday: ['-1FR'] }, at(2026, 8, 1), at(2026, 10, 15));
    expect(out.map((s) => `${s.mo}/${s.d}`)).toEqual(['8/28', '9/25']);
  });

  it('skips a month that has no such day rather than rolling into the next one', () => {
    const jan31 = { ...start, mo: 1, d: 31 };
    const out = expandRule(jan31, { freq: 'MONTHLY', interval: 1, bymonthday: [31] }, at(2026, 1, 1), at(2026, 5, 1));
    // No 31st of February or April — and crucially, no 1st of March either.
    expect(out.map((s) => `${s.mo}/${s.d}`)).toEqual(['1/31', '3/31']);
  });

  it('reads a negative month day as counting back from the end', () => {
    const out = expandRule({ ...start, mo: 2, d: 1 }, { freq: 'MONTHLY', interval: 1, bymonthday: [-1] }, at(2026, 2, 1), at(2026, 4, 15));
    expect(out.map((s) => `${s.mo}/${s.d}`)).toEqual(['2/28', '3/31']);
  });

  it('walks a yearly rule', () => {
    const out = expandRule(start, { freq: 'YEARLY', interval: 1 }, at(2026, 1, 1), at(2029, 1, 1));
    expect(out.map((s) => s.y)).toEqual([2026, 2027, 2028]);
  });

  it('keeps the wall clock across a daylight-saving change', () => {
    // Cairo moves to DST in late April. A 10:00 weekly meeting stays 10:00.
    const cairo = { y: 2026, mo: 4, d: 20, h: 10, mi: 0, s: 0, zone: 'Africa/Cairo' };
    const out = expandRule(cairo, { freq: 'WEEKLY', interval: 1, byday: ['MO'] }, at(2026, 4, 1), at(2026, 5, 20));
    for (const st of out) expect(st.h).toBe(10);
    // …which means the instants are NOT a constant week apart.
    const ms = out.map(stampToMs);
    const gaps = ms.slice(1).map((v, i) => v - ms[i]);
    expect(new Set(gaps).size).toBeGreaterThan(1);
  });
});

describe('expandEvents', () => {
  it('drops the dates an EXDATE removes', () => {
    const p = parseICS(ics(`BEGIN:VEVENT
UID:series@google.com
SUMMARY:Standup
DTSTART:20260824T070000Z
DTEND:20260824T073000Z
RRULE:FREQ=DAILY;COUNT=4
EXDATE:20260825T070000Z,20260826T070000Z
END:VEVENT`));
    const out = expandEvents(p, ...window2026);
    expect(out).toHaveLength(2);
    expect(out.map((e) => new Date(e.startMs).getUTCDate())).toEqual([24, 27]);
  });

  it('lets a RECURRENCE-ID edit replace just its own instance', () => {
    const p = parseICS(ics(`BEGIN:VEVENT
UID:series@google.com
SUMMARY:Standup
DTSTART:20260824T070000Z
DTEND:20260824T073000Z
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:series@google.com
RECURRENCE-ID:20260825T070000Z
SUMMARY:Standup (moved)
DTSTART:20260825T120000Z
DTEND:20260825T123000Z
END:VEVENT`));
    const out = expandEvents(p, ...window2026);
    expect(out).toHaveLength(3);
    const moved = out.find((e) => e.summary === 'Standup (moved)');
    expect(moved).toBeTruthy();
    expect(new Date(moved.startMs).getUTCHours()).toBe(12);
    // …and the original 07:00 slot on that day is gone.
    expect(out.filter((e) => new Date(e.startMs).getUTCDate() === 25)).toHaveLength(1);
  });

  it('ignores a cancelled event', () => {
    const p = parseICS(ics(`BEGIN:VEVENT
UID:x
SUMMARY:Called off
STATUS:CANCELLED
DTSTART:20260824T070000Z
DTEND:20260824T080000Z
END:VEVENT`));
    expect(expandEvents(p, ...window2026)).toHaveLength(0);
  });

  it('ignores an event marked as showing you free', () => {
    // TRANSP:TRANSPARENT is the person saying this does not hold their time.
    const p = parseICS(ics(`BEGIN:VEVENT
UID:x
SUMMARY:FYI
TRANSP:TRANSPARENT
DTSTART:20260824T070000Z
DTEND:20260824T080000Z
END:VEVENT`));
    expect(expandEvents(p, ...window2026)).toHaveLength(0);
  });

  it('takes the length from DURATION when there is no DTEND', () => {
    const p = parseICS(ics(`BEGIN:VEVENT
UID:x
SUMMARY:Call
DTSTART:20260824T070000Z
DURATION:PT1H30M
END:VEVENT`));
    const [e] = expandEvents(p, ...window2026);
    expect(e.endMs - e.startMs).toBe(90 * 60000);
  });

  it('leaves events outside the window alone', () => {
    const p = parseICS(ics(`BEGIN:VEVENT
UID:x
SUMMARY:Ancient
DTSTART:20200824T070000Z
DTEND:20200824T080000Z
END:VEVENT`));
    expect(expandEvents(p, ...window2026)).toHaveLength(0);
  });
});

describe('busyForDay', () => {
  const inst = (sh, sm, eh, em, summary = 'X', allDay = false) => ({
    uid: 'u', summary, allDay,
    startMs: at(2026, 8, 24, sh, sm),
    endMs: at(2026, 8, 24, eh, em),
  });

  it('gives minutes from that day’s local midnight', () => {
    const out = busyForDay([inst(10, 0, 11, 30)], dayOf(2026, 8, 24));
    expect(out).toEqual([{ start: 600, end: 690, label: 'X' }]);
  });

  it('merges what overlaps and keeps both labels', () => {
    const out = busyForDay([inst(10, 0, 11, 0, 'Standup'), inst(10, 30, 12, 0, 'Review')], dayOf(2026, 8, 24));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 600, end: 720 });
    expect(out[0].label).toContain('Standup');
    expect(out[0].label).toContain('Review');
  });

  it('leaves a real gap between two meetings alone', () => {
    const out = busyForDay([inst(10, 0, 11, 0), inst(14, 0, 15, 0)], dayOf(2026, 8, 24));
    expect(out.map((b) => [b.start, b.end])).toEqual([[600, 660], [840, 900]]);
  });

  it('clips an event that started yesterday', () => {
    const overnight = {
      uid: 'u', summary: 'Flight', allDay: false,
      startMs: at(2026, 8, 23, 22, 0), endMs: at(2026, 8, 24, 3, 0),
    };
    expect(busyForDay([overnight], dayOf(2026, 8, 24))).toEqual([{ start: 0, end: 180, label: 'Flight' }]);
  });

  it('lets an event that runs past midnight keep its true length', () => {
    // Past 1440 on purpose: the slotting code needs one wall, not two, and it
    // works in minutes since Fajr where tomorrow's 01:00 is late in the day.
    const late = {
      uid: 'u', summary: 'Deploy', allDay: false,
      startMs: at(2026, 8, 24, 23, 0), endMs: at(2026, 8, 25, 1, 0),
    };
    expect(busyForDay([late], dayOf(2026, 8, 24))).toEqual([{ start: 1380, end: 1500, label: 'Deploy' }]);
  });

  it('ignores an all-day event unless asked not to', () => {
    const allDay = { uid: 'u', summary: 'Eid', allDay: true, startMs: at(2026, 8, 24), endMs: at(2026, 8, 25) };
    expect(busyForDay([allDay], dayOf(2026, 8, 24))).toEqual([]);
    expect(busyForDay([allDay], dayOf(2026, 8, 24), { includeAllDay: true }))
      .toEqual([{ start: 0, end: 1440, label: 'Eid' }]);
  });

  it('says nothing about a day with nothing on it', () => {
    expect(busyForDay([inst(10, 0, 11, 0)], dayOf(2026, 8, 25))).toEqual([]);
  });
});
