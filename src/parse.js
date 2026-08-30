/* ------------------------------------------------------------------ */
/*  Typing a task and meaning more than its words.                     */
/*                                                                     */
/*    "call the dentist tomorrow 3pm #calls %Health"                   */
/*      -> title "call the dentist", 3:00pm tomorrow, tag "calls",     */
/*         project Health                                              */
/*                                                                     */
/*  Two rules run through all of it.                                   */
/*                                                                     */
/*  Nothing is silently lost. A token is only cut out of the title if   */
/*  it actually resolved to something — %Unknown stays in the text      */
/*  rather than disappearing into a project that does not exist, and a  */
/*  line that is nothing but tokens keeps its original words rather     */
/*  than becoming an untitled task.                                     */
/*                                                                     */
/*  It reads what a person types, not a syntax they have to learn. Any  */
/*  of this is optional, order does not matter, and plain prose parses  */
/*  as a plain title.                                                   */
/* ------------------------------------------------------------------ */
import { BLOCKS, addDays, fmtISO, pad, parseISO } from './core.jsx';

/* Arabic-Indic digits, because a phone keyboard set to Arabic produces them
   and "٣ عصر" should mean the same as "3 asr". */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const westernise = (s) => String(s).replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = [
  { i: 0, names: ['sunday', 'sun', 'الأحد', 'الاحد'] },
  { i: 1, names: ['monday', 'mon', 'الإثنين', 'الاثنين'] },
  { i: 2, names: ['tuesday', 'tue', 'tues', 'الثلاثاء'] },
  { i: 3, names: ['wednesday', 'wed', 'الأربعاء', 'الاربعاء'] },
  { i: 4, names: ['thursday', 'thu', 'thur', 'thurs', 'الخميس'] },
  { i: 5, names: ['friday', 'fri', 'الجمعة'] },
  { i: 6, names: ['saturday', 'sat', 'السبت'] },
];
/* Both spellings of each Arabic name: people write "العصر" and "عصر" equally,
   and the leading-boundary guard means the bare form can never match inside
   the prefixed one. */
const BLOCK_WORDS = {
  fajr: ['fajr', 'الفجر', 'فجر'],
  morning: ['morning', 'الضحى', 'ضحى', 'الصبح', 'صبح'],
  dhuhr: ['dhuhr', 'duhr', 'zuhr', 'الظهر', 'ظهر'],
  asr: ['asr', 'العصر', 'عصر'],
  maghrib: ['maghrib', 'المغرب', 'مغرب'],
  isha: ['isha', 'العشاء', 'عشاء'],
};

const hhmm = (h, m) => `${pad(h)}:${pad(m)}`;

/* \b is ASCII-only in JavaScript, so /\bبكرة\b/ matches nothing at all — every
   Arabic keyword here failed silently until the tests said so. Lookarounds on
   Unicode letter classes are the portable fix; the leading one is a capture
   group rather than a lookbehind, which Safari only learned in 16.4.

   Returns where the word sits, so the caller can cut it out of the title. */
const NEXT = '(?:next\\s+|الجاي\\s+|القادم\\s+)?';
function findWord(src, alts, { allowNext = false } = {}) {
  const head = '(^|[^\\p{L}\\p{N}])';
  const tail = '(?![\\p{L}\\p{N}])';
  const re = new RegExp(head + '(' + (allowNext ? NEXT : '') + ')(' + alts + ')' + tail, 'iu');
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index + m[1].length;
  const whole = m[2] + m[3];
  return { start, end: start + whole.length, next: !!m[2], word: m[3] };
}

/* 12-hour to 24: "12am" is midnight and "12pm" is noon, which is the one case
   a naive +12 gets backwards in both directions. */
function to24(h, m, mer) {
  let hh = h % 12;
  if (mer === 'pm') hh += 12;
  return hhmm(hh, m);
}

/* The next date with this weekday. Today counts — "Friday" said on a Friday
   means today, not a week away; someone who meant next week says "next
   Friday", and that is what the `next` flag is for. */
function nextWeekday(from, wd, next) {
  let delta = (wd - from.getDay() + 7) % 7;
  if (next && delta === 0) delta = 7;
  if (next && delta > 0) delta += 0;
  return addDays(from, delta);
}

/* A match the caller can undo: what was found, and where it sat in the text. */
const hit = (type, value, start, end) => ({ type, value, start, end });

export function parseTaskText(text, ctx = {}) {
  const raw = String(text == null ? '' : text);
  const today = ctx.today instanceof Date ? ctx.today : new Date();
  const labels = ctx.labels || [];
  const projects = ctx.projects || [];

  const src = westernise(raw);
  const found = [];
  const out = {
    title: raw.trim(),
    labelNames: [], labelIds: [],
    project: null, projectId: null,
    dateISO: null, start: null, end: null, block: null, minutes: null,
  };

  const claim = (type, value, m, groupText) => {
    const s = m.index + (groupText ? m[0].indexOf(groupText) : 0);
    found.push(hit(type, value, s, s + (groupText || m[0]).length));
  };

  /* ---- #tag ----
     Only the first is claimed. A task carries one label, so consuming a second
     "#foo" would delete a word and attach nothing — the extras stay in the
     title where they can be seen and dealt with. */
  for (const m of src.matchAll(/(^|\s)#("([^"]{1,40})"|[\p{L}\p{N}_-]{1,40})/gu)) {
    const name = (m[3] != null ? m[3] : m[2]).trim();
    if (!name) continue;
    const known = labels.find((l) => String(l.name).toLowerCase() === name.toLowerCase());
    out.labelNames.push(known ? known.name : name);
    if (known) out.labelIds.push(known.id);
    if (out.labelNames.length > 1) continue;   // parsed, but left in the text
    const tokenStart = m.index + m[1].length;
    found.push(hit('tag', name, tokenStart, tokenStart + 1 + m[2].length));
  }

  /* ---- %project ----
     Unlike a tag, a project is never created on the fly: it carries a target,
     a deadline and a pace, and inventing one from a typo is worse than leaving
     the word in the title where it can be seen. */
  for (const m of src.matchAll(/(^|\s)%("([^"]{1,60})"|[\p{L}\p{N}_-]{1,60})/gu)) {
    const name = (m[3] != null ? m[3] : m[2]).trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    let match = projects.find((p) => String(p.name).toLowerCase() === lower);
    if (!match) {
      // A prefix of the name, or of any word inside it — "%Boo" is a
      // reasonable way to say "The Book". Still only when exactly one project
      // answers: two candidates is a coin toss, and quietly filing work under
      // the wrong project is worse than leaving the word in the title.
      const partial = projects.filter((p) => {
        const n = String(p.name).toLowerCase();
        return n.startsWith(lower) || n.split(/\s+/).some((w) => w.startsWith(lower));
      });
      if (partial.length === 1) [match] = partial;
    }
    if (!match) continue;                            // leave it in the title
    out.project = match.name;
    out.projectId = match.id;
    const tokenStart = m.index + m[1].length;
    found.push(hit('project', match.id, tokenStart, tokenStart + 1 + m[2].length));
  }

  /* ---- explicit ISO date ---- */
  for (const m of src.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const d = parseISO(m[0]);
    if (d && !Number.isNaN(d.getTime())) { out.dateISO = m[0]; claim('date', m[0], m); break; }
  }

  /* ---- day/month, day-first (this is Egypt; 3/9 is September) ---- */
  if (!out.dateISO) {
    for (const m of src.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
      const day = Number(m[1]), month = Number(m[2]);
      if (day < 1 || day > 31 || month < 1 || month > 12) continue;
      let year = m[3] ? Number(m[3]) : today.getFullYear();
      if (year < 100) year += 2000;
      const d = new Date(year, month - 1, day);
      if (d.getDate() !== day || d.getMonth() !== month - 1) continue;
      // A bare day/month already past this year means next year.
      if (!m[3] && d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d.setFullYear(year + 1);
      out.dateISO = fmtISO(d);
      claim('date', out.dateISO, m);
      break;
    }
  }

  /* ---- "12 Sep" / "Sep 12" ---- */
  if (!out.dateISO) {
    const monthNames = MONTHS.join('|');
    const re = new RegExp(`\\b(?:(\\d{1,2})\\s+(${monthNames})|(${monthNames})\\s+(\\d{1,2}))[a-z]*\\b`, 'gi');
    for (const m of src.matchAll(re)) {
      const day = Number(m[1] || m[4]);
      const mon = MONTHS.indexOf(String(m[2] || m[3]).slice(0, 3).toLowerCase());
      if (!day || day > 31 || mon < 0) continue;
      const d = new Date(today.getFullYear(), mon, day);
      if (d.getDate() !== day) continue;
      if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d.setFullYear(today.getFullYear() + 1);
      out.dateISO = fmtISO(d);
      claim('date', out.dateISO, m);
      break;
    }
  }

  /* ---- today / tomorrow / the day after ---- */
  if (!out.dateISO) {
    const rel = [
      { alts: 'day after tomorrow|بعد بكرة|بعد غد', days: 2 },
      { alts: 'tomorrow|tmrw|بكرة|بكره|غدا|غدًا', days: 1 },
      { alts: 'today|tonight|النهاردة|اليوم|الليلة', days: 0 },
    ];
    for (const r of rel) {
      const w = findWord(src, r.alts);
      if (!w) continue;
      out.dateISO = fmtISO(addDays(today, r.days));
      found.push(hit('date', out.dateISO, w.start, w.end));
      break;
    }
  }

  /* ---- a weekday name ---- */
  if (!out.dateISO) {
    for (const w of WEEKDAYS) {
      const f = findWord(src, w.names.join('|'), { allowNext: true });
      if (!f) continue;
      out.dateISO = fmtISO(nextWeekday(today, w.i, f.next));
      found.push(hit('date', out.dateISO, f.start, f.end));
      break;
    }
  }

  /* ---- a period of the day ---- */
  for (const [id, words] of Object.entries(BLOCK_WORDS)) {
    const f = findWord(src, words.join('|'));
    if (!f) continue;
    out.block = id;
    found.push(hit('block', id, f.start, f.end));
    break;
  }

  /* ---- a duration: "for 45m", "1h30", "90 min" ---- */
  {
    // The bare unit letters matter: "45m" and "2h" are what people actually
    // type, and requiring "min" left the whole duration branch dead for them.
    // "3pm" cannot collide — the 'p' sits between the digit and the 'm'.
    const m = /\b(?:for\s+)?(\d{1,3})\s*h(?:ours?|rs?)?\s*(\d{1,2})?\s*(?:m(?:in(?:ute)?s?)?)?\b|\b(?:for\s+)?(\d{1,3})\s*m(?:in(?:ute)?s?)?\b/i.exec(src);
    if (m) {
      const mins = m[1] != null ? Number(m[1]) * 60 + Number(m[2] || 0) : Number(m[3]);
      if (mins > 0 && mins <= 1440) {
        out.minutes = mins;
        found.push(hit('minutes', mins, m.index, m.index + m[0].length));
      }
    }
  }

  /* ---- times, and time ranges ---- */
  const T = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm)?`;
  const rangeRe = new RegExp(`\\b${T}\\s*(?:-|–|to|until|till|حتى|لـ?)\\s*${T}\\b`, 'i');
  const rm = rangeRe.exec(src);
  const readTime = (h, mi, mer, otherMer) => {
    const hour = Number(h);
    if (hour > 23) return null;
    const min = Number(mi || 0);
    if (min > 59) return null;
    const m = (mer || otherMer || '').toLowerCase();
    if (m) return to24(hour, min, m);
    return hhmm(hour, min);
  };
  if (rm) {
    const a = readTime(rm[1], rm[2], rm[3], rm[6]);
    const b = readTime(rm[4], rm[5], rm[6], rm[3]);
    if (a && b) {
      out.start = a; out.end = b;
      found.push(hit('time', `${a}-${b}`, rm.index, rm.index + rm[0].length));
    }
  }
  if (!out.start) {
    // A bare number is a quantity far more often than a time, so a lone time
    // has to look like one: a meridiem, a colon, or an explicit "at".
    const re = new RegExp(`\\b(?:(at|@|الساعة)\\s*)?${T}\\b`, 'gi');
    for (const m of src.matchAll(re)) {
      const hasMer = !!m[4];
      const hasColon = m[3] != null;
      const hasAt = !!m[1];
      if (!hasMer && !hasColon && !hasAt) continue;
      // Don't re-read the minutes of a duration we already took.
      if (found.some((f) => f.type === 'minutes' && m.index >= f.start && m.index < f.end)) continue;
      const t = readTime(m[2], m[3], m[4]);
      if (!t) continue;
      out.start = t;
      found.push(hit('time', t, m.index, m.index + m[0].length));
      break;
    }
  }
  // A duration plus a start is an end time — that is what "3pm for 45m" means.
  if (out.start && out.minutes && !out.end) {
    const [h, mi] = out.start.split(':').map(Number);
    const total = (h * 60 + mi + out.minutes) % 1440;
    out.end = hhmm(Math.floor(total / 60), total % 60);
  }

  /* ---- what is left is the title ---- */
  if (found.length) {
    const keep = [];
    let cursor = 0;
    for (const f of [...found].sort((a, b) => a.start - b.start)) {
      if (f.start < cursor) continue;      // overlapping matches: first one wins
      keep.push(raw.slice(cursor, f.start));
      cursor = f.end;
    }
    keep.push(raw.slice(cursor));
    const title = keep.join(' ').replace(/\s{2,}/g, ' ').replace(/\s+([,.:;])/g, '$1').trim();
    // Never hand back an untitled task: a line that was nothing but tokens
    // keeps its own words instead.
    out.title = title || raw.trim();
  }

  out.tokens = found.sort((a, b) => a.start - b.start);
  return out;
}

/* Did this text actually carry anything beyond a title? Lets a caller show a
   preview only when there is something to preview. */
export const hasHints = (p) => !!(p && (p.tokens || []).length);

/* A short human summary of what was understood, for the chip under an input. */
export function describeParse(p, { blockName } = {}) {
  if (!p || !p.tokens.length) return '';
  const bits = [];
  if (p.dateISO) bits.push(p.dateISO);
  if (p.start) bits.push(p.end ? `${p.start}–${p.end}` : p.start);
  else if (p.minutes) bits.push(`${p.minutes}m`);
  if (p.block) bits.push(blockName ? blockName(p.block) : p.block);
  if (p.project) bits.push(`%${p.project}`);
  for (const t of p.labelNames) bits.push(`#${t}`);
  return bits.join(' · ');
}

export const BLOCK_IDS = BLOCKS.map((b) => b.id);
