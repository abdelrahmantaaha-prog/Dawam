/* ------------------------------------------------------------------ */
/*  Calendar — reading an iCalendar feed, and turning it into the only  */
/*  thing the planner wants from it: intervals of the day that are      */
/*  already spoken for.                                                 */
/*                                                                      */
/*  Pure and I/O-free on purpose. Fetching a feed is three different     */
/*  problems on three platforms (see calsync.js); parsing one is the     */
/*  same problem everywhere, and it is the part with the sharp edges —   */
/*  recurrence, timezones, all-day spans — so it is the part that is     */
/*  unit-tested.                                                        */
/*                                                                      */
/*  What is deliberately NOT here: writing. Rhythm never edits your      */
/*  calendar. A feed is read, and the day is planned around it.          */
/* ------------------------------------------------------------------ */

const HARD_CAP = 3000; // occurrences generated per rule before we stop asking

/* ---------- unfolding ----------
   iCalendar wraps long lines by starting the continuation with a space or a
   tab. A SUMMARY of any real length arrives split across three lines, so this
   has to happen before anything else touches the text. */
function unfold(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '');
}

/* A property line: NAME;PARAM=value;PARAM2="quoted:value":the value.
   The first unquoted colon ends the name+params. */
function parseLine(line) {
  let i = 0, quoted = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const parts = [];
  let cur = '', q = false;
  for (const c of head) {
    if (c === '"') { q = !q; continue; }
    if (c === ';' && !q) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  const name = (parts.shift() || '').toUpperCase();
  const params = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name, params, value };
}

/* Text values escape commas, semicolons, backslashes and newlines. */
const unescapeText = (v) =>
  String(v || '').replace(/\\([nN;,\\])/g, (_m, c) => (c === 'n' || c === 'N' ? '\n' : c));

/* ---------- time ----------
   Three kinds of stamp live in a feed, and they mean genuinely different
   things:
     20260822              a date — an all-day event, no time zone at all
     20260822T140000Z      an instant, in UTC
     20260822T140000       a wall clock, in the zone named by TZID (or the
                           device's own, when there is none)
   Everything is kept as its wall-clock parts plus a zone until the moment it
   has to become an instant, because recurrence is a rule about wall clocks:
   "every Tuesday at 14:00" stays 14:00 across a daylight-saving change, and
   expanding in epoch milliseconds would quietly walk it an hour. */
function parseStamp(value, params) {
  const v = String(value || '').trim();
  const isDate = (params && params.VALUE === 'DATE') || /^\d{8}$/.test(v);
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  return {
    y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]),
    h: Number(m[4] || 0), mi: Number(m[5] || 0), s: Number(m[6] || 0),
    allDay: isDate,
    zone: m[7] ? 'UTC' : (params && params.TZID) || null, // null = the device's zone
  };
}

/* The offset a named zone was at, at a given instant. Intl is the only source
   of zone data a browser has; formatToParts gives the wall clock there, and
   the gap back to the instant is the offset. */
function zoneOffsetMs(tz, atMs) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = {};
    for (const { type, value } of dtf.formatToParts(new Date(atMs))) p[type] = value;
    const asUTC = Date.UTC(
      Number(p.year), Number(p.month) - 1, Number(p.day),
      Number(p.hour) % 24, Number(p.minute), Number(p.second)
    );
    return asUTC - atMs;
  } catch {
    return null; // unknown zone — the caller falls back to the device's own
  }
}

export function stampToMs(st) {
  if (!st) return null;
  // An all-day event is the same day wherever you read it: local midnight.
  if (st.allDay) return new Date(st.y, st.mo - 1, st.d, 0, 0, 0, 0).getTime();
  if (st.zone === 'UTC') return Date.UTC(st.y, st.mo - 1, st.d, st.h, st.mi, st.s);
  if (!st.zone) return new Date(st.y, st.mo - 1, st.d, st.h, st.mi, st.s).getTime();

  const guess = Date.UTC(st.y, st.mo - 1, st.d, st.h, st.mi, st.s);
  const off = zoneOffsetMs(st.zone, guess);
  if (off == null) return new Date(st.y, st.mo - 1, st.d, st.h, st.mi, st.s).getTime();
  // One correction pass: the offset that applies is the one at the *result*,
  // not at the guess, and those differ for a couple of hours twice a year.
  const once = guess - off;
  const off2 = zoneOffsetMs(st.zone, once);
  return off2 == null || off2 === off ? once : guess - off2;
}

const dayKey = (st) => `${st.y}-${String(st.mo).padStart(2, '0')}-${String(st.d).padStart(2, '0')}`;
const stampKey = (st) => (st.allDay ? dayKey(st) : `${dayKey(st)}T${String(st.h).padStart(2, '0')}${String(st.mi).padStart(2, '0')}`);

/* ISO 8601 durations, as DTEND's stand-in: P1D, PT1H30M, PT45M. */
function durationMs(v) {
  const m = String(v || '').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const ms = (Number(m[2] || 0) * 604800 + Number(m[3] || 0) * 86400 + Number(m[4] || 0) * 3600 + Number(m[5] || 0) * 60 + Number(m[6] || 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

/* ---------- parsing ---------- */
export function parseICS(text) {
  const lines = unfold(text).split('\n');
  const events = [];
  let calName = '';
  let cur = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') {
      if (cur && cur.start) events.push(cur);
      cur = null;
      continue;
    }
    const p = parseLine(line);
    if (!p) continue;

    if (!cur) {
      // Feed-level properties. Google puts the calendar's name in X-WR-CALNAME.
      if (p.name === 'X-WR-CALNAME') calName = unescapeText(p.value);
      continue;
    }

    switch (p.name) {
      case 'UID': cur.uid = p.value; break;
      case 'SUMMARY': cur.summary = unescapeText(p.value); break;
      case 'LOCATION': cur.location = unescapeText(p.value); break;
      case 'STATUS': cur.status = p.value.toUpperCase(); break;
      case 'TRANSP': cur.transp = p.value.toUpperCase(); break;
      case 'DTSTART': cur.start = parseStamp(p.value, p.params); break;
      case 'DTEND': cur.end = parseStamp(p.value, p.params); break;
      case 'DURATION': cur.duration = durationMs(p.value); break;
      case 'RRULE': cur.rrule = parseRRule(p.value); break;
      case 'RECURRENCE-ID': cur.recurrenceId = parseStamp(p.value, p.params); break;
      case 'EXDATE':
        for (const one of String(p.value).split(',')) {
          const st = parseStamp(one, p.params);
          if (st) cur.exdates.push(st);
        }
        break;
      default: break;
    }
  }
  return { calName, events };
}

function parseRRule(value) {
  const out = {};
  for (const part of String(value || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).toUpperCase();
    const v = part.slice(eq + 1);
    if (k === 'FREQ') out.freq = v.toUpperCase();
    else if (k === 'INTERVAL') out.interval = Math.max(1, Number(v) || 1);
    else if (k === 'COUNT') out.count = Number(v) || 0;
    else if (k === 'UNTIL') out.until = parseStamp(v, {});
    else if (k === 'BYDAY') out.byday = v.toUpperCase().split(',').filter(Boolean);
    else if (k === 'BYMONTHDAY') out.bymonthday = v.split(',').map(Number).filter(Number.isFinite);
    else if (k === 'BYMONTH') out.bymonth = v.split(',').map(Number).filter(Number.isFinite);
  }
  if (!out.freq) return null;
  out.interval = out.interval || 1;
  return out;
}

/* ---------- recurrence ----------
   Expansion walks wall clocks, never instants (see parseStamp). The result is
   a list of start stamps in the event's own zone, which stampToMs then turns
   into real times one at a time. */
const WDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const addDaysUTC = (ms, n) => ms + n * 86400000;
// A wall clock is walked as if it were UTC — the arithmetic is calendar
// arithmetic, and pretending otherwise is what introduces DST drift.
const stampToWall = (st) => Date.UTC(st.y, st.mo - 1, st.d, st.h, st.mi, st.s);
const wallToStamp = (ms, proto) => {
  const d = new Date(ms);
  return { ...proto, y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
};

function nthWeekdayOfMonth(year, month0, weekday, nth) {
  if (nth > 0) {
    const first = new Date(Date.UTC(year, month0, 1));
    const shift = (weekday - first.getUTCDay() + 7) % 7;
    const day = 1 + shift + (nth - 1) * 7;
    const probe = new Date(Date.UTC(year, month0, day));
    return probe.getUTCMonth() === month0 ? day : null;
  }
  const last = new Date(Date.UTC(year, month0 + 1, 0));
  const shift = (last.getUTCDay() - weekday + 7) % 7;
  const day = last.getUTCDate() - shift + (nth + 1) * 7;
  return day >= 1 ? day : null;
}

/* Which days of one month a rule lands on: "the second Thursday", "the 15th",
   "the last day" (-1), or — with nothing said — the day the series started on.
   A day the month does not have (the 31st of April) is skipped rather than
   rolled forward, which is what every calendar client does and what the person
   who wrote "the 31st" meant. */
function monthDays(year, month, startDay, rrule) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const days = [];
  if (rrule.byday && rrule.byday.length) {
    for (const token of rrule.byday) {
      const wd = WDAY[token.slice(-2)];
      if (wd == null) continue;
      const nth = Number(token.slice(0, -2)) || 1;
      const day = nthWeekdayOfMonth(year, month, wd, nth);
      if (day && day >= 1 && day <= lastDay) days.push(day);
    }
  } else if (rrule.bymonthday && rrule.bymonthday.length) {
    for (const n of rrule.bymonthday) {
      const day = n < 0 ? lastDay + n + 1 : n;
      if (day >= 1 && day <= lastDay) days.push(day);
    }
  } else if (startDay <= lastDay) {
    days.push(startDay);
  }
  return days.sort((a, b) => a - b);
}

export function expandRule(start, rrule, fromMs, toMs) {
  const out = [];
  if (!rrule) return [start];
  const untilWall = rrule.until ? stampToWall(rrule.until) : null;
  const startWall = stampToWall(start);
  const interval = rrule.interval || 1;
  let emitted = 0, guard = 0;

  /* Returns false when the rule is finished and the caller should stop.
     Note an occurrence past the window does not finish the rule while COUNT
     still has instances to walk — the count is over the whole series, and
     cutting it short here would let a later window see occurrences that the
     rule had already spent. */
  const consider = (wall) => {
    if (wall < startWall) return true;
    if (untilWall != null && wall > untilWall) return false;
    if (rrule.count && emitted >= rrule.count) return false;
    emitted += 1;
    const st = wallToStamp(wall, start);
    const ms = stampToMs(st);
    if (ms >= fromMs - 86400000 && ms <= toMs) out.push(st);
    if (ms > toMs && !(rrule.count && emitted < rrule.count)) return false;
    return true;
  };

  if (rrule.freq === 'DAILY') {
    for (let w = startWall; guard++ < HARD_CAP; w = addDaysUTC(w, interval)) {
      if (!consider(w)) break;
    }
  } else if (rrule.freq === 'WEEKLY') {
    const days = (rrule.byday || []).map((d) => WDAY[d.slice(-2)]).filter((n) => n != null);
    const set = days.length ? days : [new Date(startWall).getUTCDay()];
    // Anchor on the week's Sunday so INTERVAL counts weeks, not days.
    let weekStart = addDaysUTC(startWall, -new Date(startWall).getUTCDay());
    for (; guard++ < HARD_CAP;) {
      let alive = true;
      for (const wd of set.slice().sort((a, b) => a - b)) {
        if (!consider(addDaysUTC(weekStart, wd))) { alive = false; break; }
      }
      if (!alive) break;
      weekStart = addDaysUTC(weekStart, 7 * interval);
    }
  } else if (rrule.freq === 'MONTHLY') {
    const s = new Date(startWall);
    for (let k = 0; guard++ < HARD_CAP; k += interval) {
      const abs = s.getUTCMonth() + k;
      const year = s.getUTCFullYear() + Math.floor(abs / 12);
      const month = ((abs % 12) + 12) % 12;
      const days = monthDays(year, month, s.getUTCDate(), rrule);
      let alive = true;
      for (const day of days) {
        if (!consider(Date.UTC(year, month, day, s.getUTCHours(), s.getUTCMinutes(), s.getUTCSeconds()))) { alive = false; break; }
      }
      if (!alive) break;
    }
  } else if (rrule.freq === 'YEARLY') {
    const s = new Date(startWall);
    for (let k = 0; guard++ < HARD_CAP; k += interval) {
      const year = s.getUTCFullYear() + k;
      const months = rrule.bymonth && rrule.bymonth.length ? rrule.bymonth.map((m) => m - 1) : [s.getUTCMonth()];
      let alive = true;
      for (const month of months) {
        for (const day of monthDays(year, month, s.getUTCDate(), rrule)) {
          if (!consider(Date.UTC(year, month, day, s.getUTCHours(), s.getUTCMinutes(), s.getUTCSeconds()))) { alive = false; break; }
        }
        if (!alive) break;
      }
      if (!alive) break;
    }
  } else {
    return [start];
  }
  return out;
}

/* ---------- the feed as instances ----------
   Everything a caller actually wants: real start/end milliseconds inside a
   window, with cancellations, exceptions and single-instance edits applied. */
export function expandEvents(parsed, fromMs, toMs) {
  const events = (parsed && parsed.events) || [];
  // An event with RECURRENCE-ID is an edit to one instance of its series —
  // "this Tuesday's stand-up moved to 15:00". Keyed by the instance it
  // replaces, so the series can skip that slot and use this instead.
  const overrides = new Map();
  for (const e of events) {
    if (e.recurrenceId && e.uid) overrides.set(`${e.uid}@${stampKey(e.recurrenceId)}`, e);
  }

  const out = [];
  const push = (ev, startStamp) => {
    if (ev.status === 'CANCELLED') return;
    // TRANSPARENT means "shows me as free" — the person said this one does not
    // hold their time, so the planner must not treat it as a wall.
    if (ev.transp === 'TRANSPARENT') return;
    const startMs = stampToMs(startStamp);
    let endMs;
    if (ev.end) {
      endMs = startMs + (stampToMs(ev.end) - stampToMs(ev.start));
    } else if (ev.duration != null) {
      endMs = startMs + ev.duration;
    } else {
      endMs = startStamp.allDay ? startMs + 86400000 : startMs; // a zero-length marker
    }
    if (endMs <= startMs && !startStamp.allDay) return;
    if (endMs < fromMs || startMs > toMs) return;
    out.push({
      uid: ev.uid || '',
      summary: ev.summary || '',
      location: ev.location || '',
      allDay: !!startStamp.allDay,
      startMs,
      endMs,
    });
  };

  for (const ev of events) {
    if (ev.recurrenceId) continue; // handled as an override of its series
    if (!ev.rrule) { push(ev, ev.start); continue; }
    const exset = new Set((ev.exdates || []).map(stampKey));
    for (const st of expandRule(ev.start, ev.rrule, fromMs, toMs)) {
      const key = stampKey(st);
      if (exset.has(key)) continue;
      const over = ev.uid ? overrides.get(`${ev.uid}@${key}`) : null;
      if (over) push(over, over.start);
      else push(ev, st);
    }
  }
  out.sort((a, b) => a.startMs - b.startMs);
  return out;
}

/* ---------- what the planner asks for ----------
   The busy intervals of one calendar day, in minutes from that day's local
   midnight. An interval may end past 1440: an event running to 01:00 tomorrow
   is one wall, not two, and the slotting code needs its true length. */
export function busyForDay(instances, date, opts = {}) {
  const { includeAllDay = false, mergeGapMin = 0 } = opts;
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime();
  const dayEnd = dayStart + 86400000;
  const spans = [];

  for (const ev of instances) {
    // An all-day event is a label on the day, not a claim on its hours —
    // blocking every waking minute because something is "on" that day would
    // make the calendar useless. Opt in if you disagree.
    if (ev.allDay && !includeAllDay) continue;
    if (ev.endMs <= dayStart || ev.startMs >= dayEnd) continue;
    const s = Math.max(ev.startMs, dayStart);
    const e = Math.min(ev.endMs, dayEnd + 86400000); // let it run past midnight
    const startMin = Math.floor((s - dayStart) / 60000);
    const endMin = Math.ceil((e - dayStart) / 60000);
    if (endMin > startMin) spans.push([startMin, endMin, ev.summary]);
  }

  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const [s, e, label] of spans) {
    const last = merged[merged.length - 1];
    if (last && s - last[1] <= mergeGapMin) {
      last[1] = Math.max(last[1], e);
      if (label && !last[2].includes(label)) last[2] = `${last[2]}, ${label}`;
    } else {
      merged.push([s, e, label || '']);
    }
  }
  return merged.map(([start, end, label]) => ({ start, end, label }));
}
