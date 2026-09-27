/* Rhythm core - pure logic: i18n, dates, prayer math, sky, blocks, model. */
const APP_VERSION = '3.0';

/* ------------------------------------------------------------------ */
/*  i18n — lightweight, module-level translator (same pattern as the   */
/*  time-format flag). LANG is set once per render from settings so    */
/*  every component below can call t() without prop-threading. Arabic  */
/*  drives RTL layout via dir="rtl" on the root.                       */
/* ------------------------------------------------------------------ */
let LANG = 'en';
const setLang = (v) => { LANG = v === 'ar' ? 'ar' : 'en'; };
const isRTL = () => LANG === 'ar';
// tx('English text', 'النص العربي') — falls back to English if no Arabic given.
const tx = (en, ar) => (LANG === 'ar' && ar != null ? ar : en);
const LANGS = [{ id: 'en', label: 'English', native: 'English' }, { id: 'ar', label: 'Arabic', native: 'العربية' }];

/* ------------------------------------------------------------------ */
/*  The prayer oath — the gate is released by typing والله, not a tap.  */
/*  Normalised generously so a real attempt always counts: diacritics,  */
/*  tatweel, the ﷲ ligature, alef variants and whitespace are folded.   */
/* ------------------------------------------------------------------ */
const OATH_AR = '\u0648\u0627\u0644\u0644\u0647'; // والله
const normalizeArabic = (s) => String(s || '')
  .replace(/[\u064B-\u0652\u0670\u0640]/g, '')     // harakat + tatweel
  .replace(/\uFDF2/g, '\u0627\u0644\u0644\u0647')   // ﷲ ligature → الله
  .replace(/[\u0622\u0623\u0625]/g, '\u0627')       // آ أ إ → ا
  .replace(/\s+/g, '');
const isOath = (s) => normalizeArabic(s) === OATH_AR;

const uid = () => (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36));
/*  Escapes all HTML first, then applies a small inline/block subset:  */
/*  # headings, - / 1. lists, **bold**, *italic*, `code`, [text](url). */
/*  Never injects raw HTML from note content — only our own tags.      */
/* ------------------------------------------------------------------ */
function mdInline(text, keyBase) {
  // text is already HTML-escaped. Tokenize inline spans into React nodes.
  const nodes = [];
  let rest = text; let k = 0;
  const push = (n) => nodes.push(typeof n === 'string' ? n : React.cloneElement(n, { key: `${keyBase}-${k++}` }));
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/;
  let m;
  while ((m = re.exec(rest))) {
    if (m.index > 0) push(rest.slice(0, m.index));
    if (m[1]) push(<strong>{m[2]}</strong>);
    else if (m[3]) push(<em>{m[4]}</em>);
    else if (m[5]) push(<code className="md-code">{m[6]}</code>);
    else if (m[7]) push(<a href={m[9]} target="_blank" rel="noreferrer">{m[8]}</a>);
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) push(rest);
  return nodes;
}
function renderMarkdown(src) {
  const esc = String(src || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = esc.split('\n');
  const out = []; let list = null; let li = 0;
  const flush = () => { if (list) { out.push(React.createElement(list.tag, { key: `l${out.length}`, className: 'md-list' }, list.items)); list = null; } };
  lines.forEach((line, i) => {
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (h) { flush(); const lvl = h[1].length; out.push(React.createElement(`h${lvl + 3}`, { key: `h${i}`, className: 'md-h' }, mdInline(h[2], `h${i}`))); }
    else if (ul || ol) {
      const tag = ul ? 'ul' : 'ol'; const content = (ul || ol)[1];
      if (!list || list.tag !== tag) { flush(); list = { tag, items: [] }; }
      list.items.push(<li key={`li${li++}`}>{mdInline(content, `li${li}`)}</li>);
    }
    else if (line.trim() === '') { flush(); }
    else { flush(); out.push(<p key={`p${i}`} className="md-p">{mdInline(line, `p${i}`)}</p>); }
  });
  flush();
  return out;
}
function firstJsonObject(s) {
  if (!s) return null;
  const i = s.indexOf('{'); if (i < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(i, j + 1); }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Date helpers                                                       */
/* ------------------------------------------------------------------ */
const pad = (n) => String(n).padStart(2, '0');
const fmtISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); x.setHours(0, 0, 0, 0); return x; };
const sameDay = (a, b) => fmtISO(a) === fmtISO(b);
const parseISO = (iso) => { const d = new Date(String(iso) + 'T00:00:00'); d.setHours(0, 0, 0, 0); return d; };
function startOfWeek(date, weekStartDay) {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() - weekStartDay + 7) % 7;
  return addDays(d, -diff);
}
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const WEEKDAYS_FULL_AR = WEEKDAYS_AR;
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
// Language-aware accessors — used everywhere a day/month name is shown.
const wd = (i) => (LANG === 'ar' ? WEEKDAYS_AR : WEEKDAYS)[((i % 7) + 7) % 7];
const wdFull = (i) => (LANG === 'ar' ? WEEKDAYS_FULL_AR : WEEKDAYS_FULL)[((i % 7) + 7) % 7];
const mon = (i) => (LANG === 'ar' ? MONTHS_AR : MONTHS)[((i % 12) + 12) % 12];
const weekdayFullList = () => (LANG === 'ar' ? WEEKDAYS_FULL_AR : WEEKDAYS_FULL);

/* ------------------------------------------------------------------ */
/*  Living sky — the day's ambient light and landscape, driven by the   */
/*  clock. Interpolated continuously between reference points, same     */
/*  technique as a dynamic wallpaper.                                   */
/* ------------------------------------------------------------------ */
const SKY_KEYFRAMES = [
  { h: 0,     top: [15, 20, 42],  bot: [10, 30, 42],  night: 1,    glow: [90, 100, 130], token: [220, 228, 240], waveBack: [15, 45, 55],  waveFront: [10, 35, 45], discY: 0.20 },
  { h: 4.25,  top: [30, 35, 60],  bot: [45, 55, 75],  night: 0.7,  glow: [130, 120, 140],token: [225, 220, 225], waveBack: [35, 60, 70],  waveFront: [20, 45, 55], discY: 0.50 },
  { h: 5.833, top: [253, 235, 201],bot:[247, 201, 137],night: 0,   glow: [247, 166, 90], token: [251, 225, 150], waveBack: [224, 140, 95], waveFront:[178, 95, 60], discY: 0.82 },
  { h: 9,     top: [250, 225, 175],bot:[240, 180, 120],night: 0,   glow: [250, 215, 150],token: [255, 240, 210], waveBack: [214, 130, 80], waveFront:[168, 88, 52], discY: 0.50 },
  { h: 12.917,top: [252, 220, 165],bot:[236, 155, 90], night: 0,   glow: [255, 235, 190],token: [255, 246, 220], waveBack: [210, 120, 70], waveFront:[160, 80, 46], discY: 0.14 },
  { h: 16.5,  top: [235, 180, 120],bot:[233, 140, 80], night: 0,   glow: [250, 210, 140],token: [250, 220, 140], waveBack: [196, 105, 60], waveFront:[150, 72, 40], discY: 0.42 },
  { h: 19,    top: [74, 59, 99],  bot: [229, 138, 94], night: 0.15,glow: [242, 166, 90], token: [242, 166, 90],  waveBack: [161, 88, 55], waveFront: [110, 55, 32],discY: 0.80 },
  { h: 20.5,  top: [46, 35, 75],  bot: [130, 80, 80],  night: 0.6, glow: [215, 180, 160],token: [225, 205, 200], waveBack: [60, 45, 55],  waveFront: [35, 28, 35], discY: 0.60 },
  { h: 21.25, top: [24, 26, 55],  bot: [60, 45, 65],   night: 0.85,glow: [200, 200, 220],token: [215, 220, 235], waveBack: [25, 40, 50],  waveFront: [15, 28, 36], discY: 0.35 },
  { h: 24,    top: [15, 20, 42],  bot: [10, 30, 42],   night: 1,   glow: [90, 100, 130], token: [220, 228, 240], waveBack: [15, 45, 55],  waveFront: [10, 35, 45], discY: 0.20 },
];
const lerpN = (a, b, t) => a + (b - a) * t;
const lerpArr = (a, b, t) => a.map((v, i) => Math.round(lerpN(v, b[i], t)));
const rgbStr = (a) => `rgb(${a[0]}, ${a[1]}, ${a[2]})`;
const rgbaStr = (a, alpha) => `rgba(${a[0]}, ${a[1]}, ${a[2]}, ${alpha})`;
function skyAt(hourFloat) {
  const h = ((hourFloat % 24) + 24) % 24;
  let i = 0; while (i < SKY_KEYFRAMES.length - 1 && SKY_KEYFRAMES[i + 1].h <= h) i++;
  const a = SKY_KEYFRAMES[i], b = SKY_KEYFRAMES[Math.min(i + 1, SKY_KEYFRAMES.length - 1)];
  const span = (b.h - a.h) || 1;
  const t = Math.max(0, Math.min(1, (h - a.h) / span));
  return {
    top: lerpArr(a.top, b.top, t), bot: lerpArr(a.bot, b.bot, t), night: lerpN(a.night, b.night, t),
    glow: lerpArr(a.glow, b.glow, t), token: lerpArr(a.token, b.token, t),
    waveBack: lerpArr(a.waveBack, b.waveBack, t), waveFront: lerpArr(a.waveFront, b.waveFront, t),
    discY: lerpN(a.discY, b.discY, t),
  };
}

/* ------------------------------------------------------------------ */
/*  Prayer blocks                                                      */
/* ------------------------------------------------------------------ */
const BLOCKS = [
  { id: 'fajr',    name: 'Fajr',    ar: 'الفجر',  startKey: 'Fajr',    endKey: 'Sunrise', hint: 'Quiet, front-loaded deep work', hintAr: 'عمل عميق هادئ في أول اليوم', refHour: 4.25 },
  { id: 'morning', name: 'Morning', ar: 'الضحى',  startKey: 'Sunrise', endKey: 'Dhuhr',   hint: 'The long productive stretch',   hintAr: 'الفترة المنتجة الطويلة', refHour: 5.833 },
  { id: 'dhuhr',   name: 'Dhuhr',   ar: 'الظهر',  startKey: 'Dhuhr',   endKey: 'Asr',     hint: 'Midday — meetings, calls',      hintAr: 'منتصف اليوم — اجتماعات ومكالمات', refHour: 12.917 },
  { id: 'asr',     name: 'Asr',     ar: 'العصر',  startKey: 'Asr',     endKey: 'Maghrib', hint: 'Afternoon follow-through',      hintAr: 'متابعة بعد الظهر', refHour: 16.5 },
  { id: 'maghrib', name: 'Maghrib', ar: 'المغرب', startKey: 'Maghrib', endKey: 'Isha',    hint: 'Wind down, family',             hintAr: 'استرخاء ووقت العائلة', refHour: 19.75 },
  { id: 'isha',    name: 'Isha',    ar: 'العشاء', startKey: 'Isha',    endKey: null,      hint: 'Reading, light planning',       hintAr: 'قراءة وتخطيط خفيف', refHour: 21.25 },
].map((b) => { const s = skyAt(b.refHour); return { ...b, accent: rgbStr(s.token), accentDeep: rgbStr(s.token.map((c) => Math.round(c * 0.42))), tint: rgbaStr(s.glow, 0.14) }; });
const blockById = (id) => BLOCKS.find((b) => b.id === id) || BLOCKS[1];
// Language-aware block name/hint. In Arabic the Arabic name is primary.
const bName = (b) => (LANG === 'ar' ? b.ar : b.name);
const bSub = (b) => (LANG === 'ar' ? '' : b.ar);
const bHint = (b) => (LANG === 'ar' ? b.hintAr : b.hint);
const vBlock = (id) => (BLOCKS.some((x) => x.id === id) ? id : 'morning');
const timeOrder = (str) => { const m = String(str || '').match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : 100000; };
const minutesOf = (t) => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

function parseRange(str) {
  if (!str) return null;
  const s = String(str).toLowerCase().replace(/[\u2012\u2013\u2014\u2015]/g, '-').replace(/\bto\b/g, '-')
    .replace(/\bmidnight\b/g, '12:00am').replace(/\bnoon\b/g, '12:00pm');
  const parts = s.split('-').map((x) => x.trim()).filter((x) => /\d/.test(x));
  if (!parts.length) return null;
  const glob = (s.match(/am|pm/) || [])[0];
  const toMin = (part, fb) => {
    const m = part.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (!m) return null;
    let h = Number(m[1]); const min = Number(m[2] || 0); const mer = m[3] || fb;
    if (mer === 'pm' && h !== 12) h += 12;
    if (mer === 'am' && h === 12) h = 0;
    return h * 60 + min;
  };
  const startMer = (parts[0].match(/am|pm/) || [])[0];
  const endMer = parts[1] ? (parts[1].match(/am|pm/) || [])[0] : null;
  const start = toMin(parts[0], startMer || endMer || glob);
  const end = parts[1] != null ? toMin(parts[1], endMer || startMer || glob) : null;
  if (start == null) return null;
  return { start, end };
}
function inWindow(start, end, cur) { if (end == null) return false; return end > start ? (cur >= start && cur < end) : (cur >= start || cur < end); }
function activeBlockAt(timings, curMin) {
  const fajr = minutesOf(timings.Fajr), sun = minutesOf(timings.Sunrise), dhuhr = minutesOf(timings.Dhuhr),
    asr = minutesOf(timings.Asr), magh = minutesOf(timings.Maghrib), isha = minutesOf(timings.Isha);
  if (fajr == null) return 'morning';
  if (curMin >= fajr && curMin < sun) return 'fajr';
  if (curMin >= sun && curMin < dhuhr) return 'morning';
  if (curMin >= dhuhr && curMin < asr) return 'dhuhr';
  if (curMin >= asr && curMin < magh) return 'asr';
  if (curMin >= magh && curMin < isha) return 'maghrib';
  return 'isha';
}
function windowBounds() {
  const n = new Date();
  return { start: new Date(n.getFullYear(), n.getMonth() - 1, 1), end: new Date(n.getFullYear(), n.getMonth() + 3, 0) };
}
const DEFAULT_TIMINGS = { Fajr: '04:15', Sunrise: '05:50', Dhuhr: '12:55', Asr: '16:30', Maghrib: '19:45', Isha: '21:15' };
const cleanTime = (t) => (t ? (String(t).match(/\d{1,2}:\d{2}/)?.[0] || '') : '');
// Times are always STORED as 24h "HH:MM"; this formats for display. 12h is the default.
let TIME_24 = false;
const setTime24 = (v) => { TIME_24 = !!v; };
const fmtTime = (hhmm) => {
  const m = String(hhmm || '').match(/(\d{1,2}):(\d{2})/); if (!m) return hhmm || '';
  const h = Number(m[1]), mn = m[2];
  if (TIME_24) return `${pad(h)}:${mn}`;
  const ap = h < 12 ? 'AM' : 'PM'; const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${mn} ${ap}`;
};

/* ---- Local prayer-time calculation (Egyptian Authority, Shafi'i Asr) ---- */
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const dsin = (d) => Math.sin(d * D2R), dcos = (d) => Math.cos(d * D2R), dtan = (d) => Math.tan(d * D2R);
const darcsin = (x) => R2D * Math.asin(x), darccos = (x) => R2D * Math.acos(x);
const darctan2 = (y, x) => R2D * Math.atan2(y, x), darccot = (x) => R2D * Math.atan(1 / x);
const fixAngle = (a) => { a = a - 360 * Math.floor(a / 360); return a < 0 ? a + 360 : a; };
const fixHour = (h) => { h = h - 24 * Math.floor(h / 24); return h < 0 ? h + 24 : h; };
function julianDay(y, m, d) { if (m <= 2) { y -= 1; m += 12; } const A = Math.floor(y / 100); const B = 2 - A + Math.floor(A / 4); return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5; }
function sunPosition(jd) {
  const D = jd - 2451545.0;
  const g = fixAngle(357.529 + 0.98560028 * D);
  const q = fixAngle(280.459 + 0.98564736 * D);
  const L = fixAngle(q + 1.915 * dsin(g) + 0.020 * dsin(2 * g));
  const e = 23.439 - 0.00000036 * D;
  const decl = darcsin(dsin(e) * dsin(L));
  const RA = fixHour(darctan2(dcos(e) * dsin(L), dcos(L)) / 15);
  return { decl, eqt: q / 15 - RA };
}
function toHM(hours) { let h = fixHour(hours + 0.5 / 60); const hh = Math.floor(h); const mm = Math.floor((h - hh) * 60); return `${pad(hh)}:${pad(mm)}`; }
function computePrayerTimes(date, lat, lng, tz, fajrAngle, ishaAngle, asrFactor) {
  const jd = julianDay(date.getFullYear(), date.getMonth() + 1, date.getDate()) - lng / (15 * 24);
  const adjust = tz - lng / 15;
  const declOf = (t) => sunPosition(jd + t / 24).decl;
  const eqtOf = (t) => sunPosition(jd + t / 24).eqt;
  const dhuhr = fixHour(12 - eqtOf(12));
  const angleTime = (angle, t, ccw) => {
    const decl = declOf(t);
    const x = (-dsin(angle) - dsin(lat) * dsin(decl)) / (dcos(lat) * dcos(decl));
    const tt = (1 / 15) * darccos(Math.max(-1, Math.min(1, x)));
    return dhuhr + (ccw ? -tt : tt);
  };
  const asrTime = (t) => { const decl = declOf(t); const angle = -darccot(asrFactor + dtan(Math.abs(lat - decl))); return angleTime(angle, t, false); };
  const out = {
    Fajr: angleTime(fajrAngle, dhuhr, true), Sunrise: angleTime(0.833, dhuhr, true), Dhuhr: dhuhr,
    Asr: asrTime(dhuhr), Maghrib: angleTime(0.833, dhuhr, false), Isha: angleTime(ishaAngle, dhuhr, false),
  };
  const r = {}; for (const k of Object.keys(out)) r[k] = toHM(out[k] + adjust); return r;
}
const CAIRO = { lat: 30.0444, lng: 31.2357, fajrAngle: 19.5, ishaAngle: 17.5, asrFactor: 1 };

const LABEL_SWATCHES = ['#1F6F8B', '#4C7A34', '#8A5A9E', '#B23A6B', '#B7791F', '#2F6F6A', '#9C4221', '#3454D1', '#6B7280', '#0E7C66'];
const DEFAULT_LABELS = [
  { id: uid(), name: 'Newsroom',  color: '#1F6F8B' },
  { id: uid(), name: 'Reporting', color: '#4C7A34' },
  { id: uid(), name: 'Personal',  color: '#8A5A9E' },
  { id: uid(), name: 'Admin',     color: '#B7791F' },
];
// Settings schema rev 2 (v1.1): `labels` are the colored task tags (formerly
// "projects"); `projects` is now a distinct list of long-term projects with
// their own goals, linked labels, and progress log.
const DEFAULT_SETTINGS = {
  rev: 2,
  lang: 'en',
  labels: DEFAULT_LABELS,
  projects: [],
  habits: [],
  pin: null,           // { hash, salt } — soft lock, not encryption
  apiKey: '',          // optional API key for the brain-dump sorter (stored locally only)
  groqKey: '',         // optional Groq key — free-tier fallback when Gemini is down
  brokerUrl: '',       // the shared key pool (keybroker) — one door to every project's keys
  brokerToken: '',     // this app's token for it; the keys above stay as the fallback
  autoDark: true,      // legacy flag, kept for old backups; 'theme' is the setting now
  theme: 'auto',       // 'auto' (dark at night, Maghrib→Sunrise) | 'light' | 'dark'
  rewards: [],         // what points buy — you set the prices, which is what makes them mean anything
  /* The other direction. A reward system that can only ever add is a system
     that drifts upward forever; these are the habits you are trying to STOP,
     priced the same way rewards are. `wipe` is the nuclear one — it zeroes the
     balance instead of subtracting a number. */
  penalties: [],       // [{ id, name, cost, wipe }]
  /* Every `everyMin` minutes with nothing finished, the app stops being usable
     until one task or subtask is ticked. Off unless you ask for it: this is a
     commitment device, and one nobody consented to is just a broken app. */
  nowLock: { on: false, everyMin: 15 },
  /* How long before a timed task's start it appears in Now, so there is time
     to get ready rather than to discover it has begun. */
  leadMin: 30,
  weekStartDay: 6,
  prayerGate: true,
  time24: false,
  prayer: { useLive: true, city: 'Cairo', country: 'Egypt', method: 5, customTimes: { ...DEFAULT_TIMINGS } },
  /* Read-only calendars, and how hard the planner should route around them.
     The feeds themselves live under their own storage key (planner:calendars)
     — this is only the behaviour. */
  calendar: {
    includeAllDay: false,   // a birthday is a note on the day, not a claim on its hours
    prayerReserveMin: 15,   // the blocks start AT the adhan; hold the prayer's own minutes
    googleClientId: '',     // desktop OAuth, your own Google Cloud client
    googleClientSecret: '',
  },
  /* Read-only Trello. The token is granted with scope=read and no expiry, so
     it never interrupts a working day to be renewed. */
  trello: { key: '', token: '', boards: [], withinDays: 14 },
};

/* Long-term project shape:
   { id, name, color, goal, unit, target, deadline, startDate, entries:[{id,date,amount,note}] }
   Tasks link to a project via task.projectRef (optional). */
const newProject = () => ({
  id: uid(), name: tx('New project', 'مشروع جديد'), color: LABEL_SWATCHES[Math.floor(Math.random() * LABEL_SWATCHES.length)],
  goal: '', unit: tx('pages', 'صفحة'), target: 100, deadline: '', startDate: fmtISO(new Date()), entries: [],
  /* When this project should ask for its share of the day. Off by default: a
     project is a place to put work, and turning every one of them into a daily
     summons is how a person stops reading them. See src/quota.js. */
  plan: { on: false, days: [], block: 'morning', start: '' },
});
const projectProgress = (p) => (p.entries || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
// Pace math: honours the start date. "Expected today" is measured from start,
// not from an assumed day one; a project whose start is in the future reads as
// "not started" rather than instantly behind.
function projectPace(p) {
  const done = projectProgress(p);
  const target = Number(p.target) || 0;
  const pct = target > 0 ? Math.min(1, done / target) : 0;
  const start = p.startDate ? parseISO(p.startDate) : null;
  const end = p.deadline ? parseISO(p.deadline) : null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const DAY = 86400000;
  let expected = null, onPace = null, elapsedFrac = null, daysLeft = null, perDay = null, projectedEnd = null, notStarted = false;
  if (end) daysLeft = Math.round((end - today) / DAY);
  if (target > 0 && start && end && end > start) {
    if (today < start) {
      // Hasn't begun yet — expected progress is zero, and being at zero is fine.
      notStarted = true; elapsedFrac = 0; expected = 0; onPace = true;
    } else {
      elapsedFrac = Math.max(0, Math.min(1, (today - start) / (end - start)));
      expected = target * elapsedFrac;
      onPace = done >= expected - 1e-9;
    }
    const remaining = Math.max(0, target - done);
    // Needed daily rate runs from the *effective* start: if the project hasn't
    // started yet, the window is start→deadline, not today→deadline — so a
    // future project shows the true rate it will demand, not a diluted one.
    const from = today < start ? start : today;
    const daysRemaining = Math.max(1, Math.ceil((end - from) / DAY));
    perDay = remaining / daysRemaining;
    // projected finish at the observed rate, measured from the actual start date
    const daysSoFar = Math.max(1, Math.round((today - start) / DAY));
    const rate = today > start ? done / daysSoFar : 0;
    if (rate > 0) projectedEnd = addDays(today, Math.ceil(remaining / rate));
  }
  return { done, target, pct, expected, onPace, elapsedFrac, daysLeft, perDay, projectedEnd, notStarted, remaining: Math.max(0, target - done) };
}

/* ---- Habits ---- */
// A habit is a daily commitment. Completion is stored per ISO date in habit.log.
// Streak = consecutive completed days ending at (and including) the given date.
const LABEL_ICON = null;
/* identity, cue and tiny are the three Atomic Habits levers that survive
   contact with a planner: who this makes you, what triggers it, and the
   two-minute version you can still do on the worst day. All optional — a
   habit with only a name works exactly as it always did. */
const newHabit = () => ({ id: uid(), name: tx('New habit', 'عادة جديدة'), color: LABEL_SWATCHES[Math.floor(Math.random() * LABEL_SWATCHES.length)], block: 'morning', createdAt: fmtISO(new Date()), log: {}, identity: '', cue: '', tiny: '', after: null, reward: '', rewardId: null });
const habitDoneOn = (h, iso) => !!(h.log && h.log[iso]);
function habitStreak(h, uptoISO) {
  const upto = uptoISO ? parseISO(uptoISO) : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
  let n = 0; let cur = new Date(upto);
  // If today isn't done yet, the streak is whatever ran up to yesterday.
  if (!habitDoneOn(h, fmtISO(cur))) cur = addDays(cur, -1);
  while (habitDoneOn(h, fmtISO(cur))) { n++; cur = addDays(cur, -1); if (n > 3660) break; }
  return n;
}
// Glow intensity 0..7 — brighter with longer streaks, capped at a week.
const glowLevel = (streak) => Math.max(0, Math.min(7, streak));

// Centralised settings migration — used by both first load and backup import so
// old (rev-1) backups upgrade the same way. In rev 1 the `projects` field held
// the colored tags; those become `labels`, and `projects` is freed for the new
// long-term projects feature.
function migrateSettings(s) {
  if (!s || typeof s !== 'object') return { ...DEFAULT_SETTINGS };
  const base = { ...DEFAULT_SETTINGS, ...s, prayer: { ...DEFAULT_SETTINGS.prayer, ...(s.prayer || {}) } };
  if ((s.rev || 1) < 2) {
    base.labels = Array.isArray(s.labels) ? s.labels : (Array.isArray(s.projects) ? s.projects : DEFAULT_LABELS);
    base.projects = Array.isArray(s.longProjects) ? s.longProjects : [];
    base.rev = 2;
  } else {
    base.labels = Array.isArray(s.labels) ? s.labels : DEFAULT_LABELS;
    base.projects = Array.isArray(s.projects) ? s.projects : [];
  }
  base.lang = s.lang === 'ar' ? 'ar' : 'en';
  base.habits = Array.isArray(s.habits) ? s.habits : [];
  base.pin = s.pin && s.pin.hash ? s.pin : null;
  // The Anthropic path was removed: an sk-ant key can never work again, and
  // keeping it around means every AI feature fails a 401 forever with the
  // settings looking configured. Clearing it makes "add a Gemini key" the
  // visible next step. delete keeps old exports importable without reviving
  // the provider switch.
  base.apiKey = typeof s.apiKey === 'string' && !/^sk-ant/.test(s.apiKey) ? s.apiKey : '';
  base.groqKey = typeof s.groqKey === 'string' ? s.groqKey : '';
  base.brokerUrl = typeof s.brokerUrl === 'string' ? s.brokerUrl : '';
  base.brokerToken = typeof s.brokerToken === 'string' ? s.brokerToken : '';
  delete base.aiProvider;
  base.autoDark = s.autoDark !== false;
  // The old boolean becomes the new three-way switch: auto-dark off meant
  // "always light"; anything else keeps the automatic behaviour.
  base.theme = ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : (s.autoDark === false ? 'light' : 'auto');
  base.rewards = Array.isArray(s.rewards) ? s.rewards : [];
  base.penalties = Array.isArray(s.penalties) ? s.penalties : [];
  base.nowLock = { ...DEFAULT_SETTINGS.nowLock, ...(s.nowLock && typeof s.nowLock === 'object' ? s.nowLock : {}) };
  base.nowLock.everyMin = Math.max(1, Math.min(240, Number(base.nowLock.everyMin) || 15));
  base.leadMin = Math.max(0, Math.min(180, Number(s.leadMin) >= 0 ? Number(s.leadMin) : DEFAULT_SETTINGS.leadMin));
  // Projects predate their work plan; give every one of them the off switch
  // rather than leaving `plan` undefined for the views to guess at.
  base.projects = (base.projects || []).map((p) => ({ ...p, plan: { on: false, days: [], block: 'morning', start: '', ...(p.plan || {}) } }));
  return base;
}
// SHA-256 hex of pin+salt. This is a soft lock (deters casual access); it is not
// full-disk encryption and the underlying data remains readable to anyone with
// technical access to the device's storage.
async function hashPin(pin, salt) {
  try {
    const enc = new TextEncoder().encode(`${salt}:${pin}`);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Fallback if SubtleCrypto is unavailable — weaker, still non-plaintext.
    let h = 0; const str = `${salt}:${pin}`; for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; } return 'x' + (h >>> 0).toString(16);
  }
}
const mkSubs = (arr) => (arr || []).map((s) => ({ id: uid(), title: typeof s === 'string' ? s : s.title, done: false }));
const PRAYER_BLOCKS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const mm2 = (m) => `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`;
// Structured start/end with lazy migration from the old free-text `time` field.
const tStartMin = (t) => { if (t.start) return minutesOf(t.start); const r = parseRange(t.time); return r ? r.start : null; };
const tEndMin = (t) => { if (t.end) return minutesOf(t.end); if (t.start) return null; const r = parseRange(t.time); return r && r.end != null ? r.end : null; };
const timeLabel = (t) => { if (t.start) return t.end ? `${fmtTime(t.start)}–${fmtTime(t.end)}` : fmtTime(t.start); return t.time || ''; };

/* ------------------------------------------------------------------ */
/*  Multi-day tasks — one task, several days.                          */
/*                                                                     */
/*  A task carries an `until` date and then belongs to every day from   */
/*  its own through that one. There is still exactly ONE task: it is    */
/*  stored once, in the week that owns its first day, and ticking it    */
/*  anywhere finishes it everywhere. The later days show a reference to  */
/*  it, not a copy — which is why "day 2 of 4" can be true rather than   */
/*  four separate tasks that happen to share a name.                    */
/*                                                                     */
/*  The consequence that matters: a spanning task is NOT overdue while   */
/*  its span is still running. That is the whole reason to have the      */
/*  feature — "read the report by Thursday" should sit on Tuesday        */
/*  without shouting, and start shouting on Friday.                      */
/* ------------------------------------------------------------------ */
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const taskUntil = (t) => (t && typeof t.until === 'string' && ISO_RE.test(t.until) ? t.until : null);
const spans = (t) => !!taskUntil(t);
/* Days the span runs for, counting its own day. A backwards `until` (the date
   picker allows one) reads as a single day rather than a negative span. */
function spanLength(t, taskDate) {
  const u = taskUntil(t);
  if (!u || !(taskDate instanceof Date)) return 1;
  const a = new Date(taskDate); a.setHours(0, 0, 0, 0);
  const b = parseISO(u);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}
/* Where `date` falls inside the span: 1-based, or 0 when it is outside. */
function spanDayIndex(t, taskDate, date) {
  if (!(taskDate instanceof Date) || !(date instanceof Date)) return 0;
  const a = new Date(taskDate); a.setHours(0, 0, 0, 0);
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const n = Math.round((d - a) / 86400000) + 1;
  return n >= 1 && n <= spanLength(t, taskDate) ? n : 0;
}
const spanCovers = (t, taskDate, date) => spanDayIndex(t, taskDate, date) > 0;

/* ------------------------------------------------------------------ */
/*  Which period a timed task belongs to.                              */
/*                                                                     */
/*  A start time already says when something happens, so asking for     */
/*  the period as well is asking the same question twice — and the two  */
/*  answers drift apart: a 3pm task filed under Morning shows in the    */
/*  wrong row, goes overdue at Dhuhr, and the slotter cannot place it.  */
/*  The time decides. Before Fajr belongs to Isha, the same as the      */
/*  Fajr-anchored day everywhere else. Null when there is no time.      */
/* ------------------------------------------------------------------ */
const blockForTime = (t, timings) => {
  if (!t || !timings) return null;
  const st = tStartMin(t);
  return st == null ? null : activeBlockAt(timings, st);
};

/* ------------------------------------------------------------------ */
/*  Focus targets — "an hour on this today", and whether you did it.   */
/*                                                                     */
/*  Kept per date on the task itself rather than in a separate log,     */
/*  because a target is a property of the work and sync already merges  */
/*  a week document per key. A task deleted takes its focus history      */
/*  with it, which is right: nobody wants the minutes without the task.  */
/* ------------------------------------------------------------------ */
const focusTargetMin = (t) => { const n = Number(t && t.focusTarget); return n > 0 ? Math.round(n) : null; };
const focusSpent = (t, iso) => Math.round(Number((t && t.focusLog && t.focusLog[iso]) || 0));
const focusMet = (t, iso) => { const g = focusTargetMin(t); return g != null && focusSpent(t, iso) >= g; };
/* Adding measured minutes. Returns a NEW task — callers hand this to the same
   mutate path every other edit goes through, so it syncs like anything else. */
function addFocusMinutes(t, iso, minutes) {
  const n = Math.round(Number(minutes) || 0);
  if (!t || !iso || n <= 0) return t;
  const log = { ...(t.focusLog || {}) };
  log[iso] = Math.round((Number(log[iso]) || 0) + n);
  return { ...t, focusLog: log };
}

/* ------------------------------------------------------------------ */
/*  Time vault — a task can carry a `secret` that is only legible      */
/*  inside its own start–end window. Write whenever you like; read     */
/*  only when the window is open.                                      */
/*                                                                     */
/*  This is FRICTION, NOT SECURITY. The value sits in localStorage in  */
/*  plain text (and lands in Settings → Backup exports the same way),  */
/*  so anyone with devtools or the device can read it at any hour.     */
/*  It exists to put a speed bump between you and an impulse, which    */
/*  is a real thing to want — just don't mistake it for a safe.        */
/* ------------------------------------------------------------------ */
const hasVault = (t) => !!(t && typeof t.secret === 'string' && t.secret.length > 0);
// A vault needs BOTH ends of a window; without them it would never re-lock.
const vaultWindowed = (t) => hasVault(t) && tStartMin(t) != null && tEndMin(t) != null;
const vaultUnlocked = (t, curMin) => vaultWindowed(t) && inWindow(tStartMin(t), tEndMin(t), curMin);

/* ------------------------------------------------------------------ */
/*  Rescheduling an overdue task onto today.                           */
/* ------------------------------------------------------------------ */
/* Moving the date alone isn't enough. A task parked in Fajr that is
   dragged to a today whose Fajr ended nine hours ago is overdue the
   instant it lands, so the button would look like it did nothing. A
   block already behind us therefore moves to the block in progress; a
   block still ahead is left where it is, because the plan for later
   today is still the plan.

   A fixed start/end is a stronger claim than a block, and one that has
   already passed today is simply wrong, so it is dropped and the task
   becomes an ordinary block task. Vault windows are the exception —
   there the window IS the feature, and clearing it would leave a secret
   hanging open that was meant to stay shut. A vault task keeps its
   window and only changes day, which is the one thing the vault has
   always allowed. */
/* Has this task's slot already gone by? A day before today is wholly
   past; within today it turns on the task's own end time, or its block's
   if it has none. Measured on the Fajr-anchored clock, so the pre-dawn
   hours belong to the day that is ending rather than the one starting.

   The overdue scan and the points ledger both ask this question, and if
   they ever answered differently you would see a task listed as overdue
   and still paid in full. One function, one answer. */
function slotPassed(t, taskDate, today, { timings, sinceFajr, curSinceFajr }) {
  /* A multi-day task is judged on the LAST day of its span, not the first.
     Anything else makes the feature self-defeating: a task told to run
     Tuesday through Thursday would be overdue on Wednesday morning. */
  const until = taskUntil(t);
  if (until) {
    const last = parseISO(until);
    if (last > today) return false;
    if (fmtISO(last) !== fmtISO(today)) return true;
    taskDate = last;
  }
  if (taskDate < today) return true;
  if (fmtISO(taskDate) !== fmtISO(today)) return false;
  const st = tStartMin(t), en = tEndMin(t);
  let endMin = null;
  if (en != null) endMin = (st != null && en <= st) ? en + 1440 : en;
  // No end: the period ends it — the period its time falls in, when it has one.
  else { const ek = blockById(blockForTime(t, timings) || t.block).endKey; endMin = ek ? minutesOf(timings[ek]) : null; }
  return endMin != null && sinceFajr(endMin) <= curSinceFajr;
}

/* ------------------------------------------------------------------ */
/*  Structuring the day — strict time slots at the press of a button.  */
/* ------------------------------------------------------------------ */
/* The whole computation happens in MINUTES SINCE FAJR, not clock time.
   Isha is the only block that crosses midnight, but it is also the one
   where slotting matters most, and in Fajr-space every window is a plain
   ordered interval: fajr [0..sunrise), …, isha [isha..1440). Convert to
   clock time only at the very end.

   Estimates are deliberately not asked for. The size is read off the
   task (same philosophy as points): 25 minutes base, +10 per subtask,
   capped at 90. When a block holds more intent than time, every slot in
   it shrinks proportionally rather than the last tasks falling off —
   a day that is too full should FEEL too full in every slot, not look
   fine until 6pm and then fall apart. The floor is 10 minutes; below
   that a slot is a lie, so what can't get 10 minutes goes unplaced and
   is reported instead. */
const SLOT = { base: 25, perSubtask: 10, cap: 90, min: 10, estCap: 480 };
/* A stored estimate (t.est, minutes — remembered from the person's own hands,
   or from the AI sizing pass) wins over the heuristic. The cap is 8 hours:
   AI answers are clamped much tighter at the parse boundary (5..180), but a
   duration the person set themselves is ground truth and must round-trip
   uncut. The heuristic stays the floor the app can always stand on when
   there is no key, no network, or no answer. */
/* A duration typed on the task itself (the editor's Duration field, or "for
   45m" in a quick add) outranks all of it — memory, AI and heuristic are all
   ways of guessing a number the person has now simply said. */
const taskDuration = (t) => { const n = Math.round(Number(t && t.duration)); return n > 0 ? Math.min(SLOT.estCap, n) : null; };
const estimateMinutes = (t) => {
  const own = taskDuration(t);
  if (own != null) return Math.max(SLOT.min, own);
  const e = Number(t && t.est);
  if (Number.isFinite(e) && e > 0) return Math.max(SLOT.min, Math.min(SLOT.estCap, Math.round(e)));
  return Math.min(SLOT.cap, SLOT.base + ((t && t.subtasks) || []).length * SLOT.perSubtask);
};
/* What the estimate was based on. Stored alongside t.est so a renamed or
   re-stepped task stops trusting a stale number — djb2 is plenty: this is a
   change detector, not a security boundary. */
function taskTextSig(t) {
  const s = `${(t && t.title) || ''}${(((t && t.subtasks) || []).map((x) => x.title).join(''))}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* `opts.busy` is time that is already spoken for by something outside the
   planner: calendar events, read-only, treated as walls rather than
   suggestions. Each entry is { start, end } in minutes from the day's own
   midnight, and `end` MAY exceed 1440 — an event running to 01:00 tomorrow is
   one wall, not two, and splitting it at midnight would let a task be slotted
   into the middle of it. Length, not the end stamp, is what survives the
   conversion into Fajr-space below.

   `opts.prayerReserveMin` holds the opening minutes of each prayer block for
   the prayer itself. The blocks are already bounded BY the adhan times, so
   without this the scheduler would happily start a task at the exact minute
   the adhan sounds — technically inside the window, and exactly the collision
   the person asked to stop having. */
function structureDay(tasks, timings, curMin, opts = {}) {
  const fajrM = minutesOf(timings.Fajr);
  if (fajrM == null) return { slots: [], unplaced: tasks.map((t) => t.id) };
  const sf = (m) => (((m - fajrM) % 1440) + 1440) % 1440;
  const toClock = (m) => mm2((fajrM + m) % 1440);
  const cur = curMin == null ? 0 : sf(curMin);

  // Block windows in Fajr-space. Isha runs to the next Fajr.
  const windows = BLOCKS.map((b) => ({
    id: b.id,
    start: sf(minutesOf(timings[b.startKey])),
    end: b.endKey ? sf(minutesOf(timings[b.endKey])) : 1440,
  }));

  // Outside obstacles, converted once. Their LENGTH is carried across, not
  // their end minute: sf() wraps, so sf(end) of a midnight-crossing event
  // would land before its own start and silently vanish.
  const external = (opts.busy || [])
    .map((b) => {
      const start = Number(b.start), end = Number(b.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      const bs = sf(start);
      return [bs, Math.min(1440, bs + (end - start))];
    })
    .filter(Boolean);
  const reserve = Math.max(0, Math.round(Number(opts.prayerReserveMin) || 0));

  /* Where a task lives for slotting. A start time is the stronger statement,
     so a timed task counts in the period its time falls in whatever its
     `block` field says — otherwise a 3pm task left under Morning would be
     read as an 8-hour-long obstacle inside the wrong window. */
  const home = (t) => (t.start && minutesOf(t.start) != null ? activeBlockAt(timings, minutesOf(t.start)) : vBlock(t.block));
  const over = new Set(windows.filter((w) => w.end <= cur).map((w) => w.id));
  const firstLive = windows.find((w) => w.end > cur);
  /* Untimed work in a period that is already over, today, is not done and
     not placeable where it is. It used to be skipped without a word — which
     made the button answer "Nothing to slot" to a day full of tasks, since
     new tasks default to Morning and the button is most often pressed after
     it. Slotting is the person asking for a time for everything left, so it
     rolls forward into the first period that still has time in it. Timed
     tasks stay where they are: their time was a decision, not a default. */
  const carried = (t) => !t.start && over.has(home(t));
  const timed = tasks.filter((t) => !t.done && t.start && t.end).length;

  const slots = [], unplaced = [];
  for (const w of windows) {
    if (w.end <= cur) continue; // the block is over; its untimed tasks roll forward (above)
    const from = Math.max(w.start, cur);

    const inBlock = tasks.filter((t) => !t.done && (home(t) === w.id || (w === firstLive && carried(t))));
    // Anything with a fixed position stays exactly where it is and becomes an
    // obstacle: a manually timed task, a vault window (never touched), or a
    // start-only task, which keeps its start and gets an end by estimate.
    const busy = [];
    const floating = [];
    for (const t of inBlock) {
      const st = t.start ? minutesOf(t.start) : null;
      if (hasVault(t) && vaultWindowed(t)) { busy.push([sf(tStartMin(t)), sf(tEndMin(t))]); continue; }
      if (st != null && t.end) { busy.push([sf(st), sf(minutesOf(t.end))]); continue; }
      if (st != null) {
        const s = sf(st);
        const e = Math.min(w.end, s + estimateMinutes(t));
        if (e > s) { busy.push([s, e]); slots.push({ id: t.id, start: t.start, end: toClock(e), block: w.id, autoSlot: true, pinned: true }); }
        continue;
      }
      floating.push(t);
    }
    // Outside obstacles apply whether or not this block holds any floating
    // task — but only a block with something to place needs the gap maths.
    for (const [es, ee] of external) {
      const s = Math.max(es, w.start), e = Math.min(ee, w.end);
      if (e > s) busy.push([s, e]);
    }
    if (reserve && PRAYER_BLOCKS.includes(w.id)) {
      const e = Math.min(w.end, w.start + reserve);
      if (e > w.start) busy.push([w.start, e]);
    }

    if (!floating.length) continue;
    busy.sort((a, b) => a[0] - b[0]);

    // Free gaps between the obstacles, clipped to [from, w.end).
    const gaps = [];
    let cursor = from;
    for (const [bs, be] of busy) {
      if (be <= cursor) continue;
      if (bs > cursor) gaps.push([cursor, Math.min(bs, w.end)]);
      cursor = Math.max(cursor, be);
      if (cursor >= w.end) break;
    }
    if (cursor < w.end) gaps.push([cursor, w.end]);
    const freeTotal = gaps.reduce((n, [a, b]) => n + Math.max(0, b - a), 0);

    // Scale to fit, floor at SLOT.min; whoever the floor pushes past the end
    // of the free time goes unplaced (reported, never silently dropped).
    const wanted = floating.map((t) => estimateMinutes(t));
    const wantTotal = wanted.reduce((a, b) => a + b, 0);
    const scale = wantTotal > freeTotal ? freeTotal / wantTotal : 1;
    // Cumulative floors, not per-slot rounding: rounding each slot up can
    // overflow the block by a minute and push the LAST task out entirely,
    // which is exactly the silent drop this function promises not to do.
    const durs = [];
    let acc = 0, prev = 0;
    for (const m of wanted) {
      acc += m * scale;
      const d = Math.floor(acc) - prev; prev += d;
      durs.push(Math.max(SLOT.min, d));
    }

    /* First fit: each task takes the earliest hole it fits in. Walking the
       holes strictly forward left a 34-minute gap empty behind a 44-minute
       task that had to jump past it, and then reported the 33-minute task
       after it as "didn't fit". Order is kept wherever the time allows. */
    const free = gaps.map(([a, b]) => [a, b]);   // [cursor, end] per hole
    for (let i = 0; i < floating.length; i++) {
      const need = durs[i];
      let placedAt = null;
      for (const hole of free) {
        if (hole[1] - hole[0] >= need) { placedAt = hole[0]; hole[0] += need; break; }
      }
      if (placedAt == null) { unplaced.push(floating[i].id); continue; }
      slots.push({ id: floating[i].id, start: toClock(placedAt), end: toClock(placedAt + need), block: w.id, autoSlot: true });
    }
  }
  return { slots, unplaced, timed };
}

/* ------------------------------------------------------------------ */
/*  Points — what a thing is worth.                                    */
/* ------------------------------------------------------------------ */
/* The weight is read off signals the task already carries, because
   asking for a rating on every task is itself an executive-function
   tax — it is the step that gets skipped, and it is the knob that gets
   inflated when you want something.

   `dread` is the interesting one: a task you have pushed to a later day
   four times is, by revealed preference, the hardest thing on your
   list, and that is exactly the avoidance loop points exist to break.
   It only ever pays out on completion, so pushing something forever
   earns nothing.

   Decomposition paying more is deliberate, not a leak: breaking a task
   into subtasks is the behaviour worth reinforcing, so it should be the
   profitable move. */
const POINTS = {
  base: 10,
  perQuarterHour: 1, sizeCap: 20, untimed: 5,
  perSubtask: 5, subtaskCap: 25,
  perPush: 5, pushCap: 20,
  project: 5,
  habit: 10, streakStep: 0.2, streakCap: 2, streakWindow: 30,
  goal: 200, goalDone: 50, goalUntargeted: 5,
};

/* Progress logged toward a project's goal ("+12 pages").

   Paid by SHARE OF THE GOAL, not by the raw amount, because units differ
   wildly — 12 pages, 3 chapters and 4000 words are all a person's evening,
   and paying per unit would make a word-count project a points mine. The
   whole goal is worth POINTS.goal (about a busy week of tasks), so a project
   carried from nothing to done pays roughly what the work behind it did.

   Only progress up to the target counts: logging past the finish line is
   welcome but is not the same achievement twice. Crossing it pays a bonus
   once. A project with no numeric target pays a small flat amount per log,
   since there is no scale to measure a share against. Nothing is paid for a
   correction (a negative amount). */
function goalWorth(p, amount, before) {
  const amt = Number(amount) || 0;
  if (!p || amt <= 0) return 0;
  const target = Number(p.target) || 0;
  if (!(target > 0)) return POINTS.goalUntargeted;
  const prior = Math.max(0, Number(before) || 0);
  const credited = Math.max(0, Math.min(amt, target - prior));
  if (!credited) return 0;
  return Math.max(1, Math.round((credited / target) * POINTS.goal));
}
/* Does this log carry the project over its target? */
const goalCrossed = (p, amount, before) => {
  const target = Number(p && p.target) || 0;
  const prior = Number(before) || 0;
  return target > 0 && prior < target && prior + (Number(amount) || 0) >= target;
};

function autoWorth(t) {
  if (!t) return 0;
  let n = POINTS.base;
  const st = tStartMin(t), en = tEndMin(t);
  if (st != null && en != null) {
    const mins = en > st ? en - st : en + 1440 - st; // windows may cross midnight
    n += Math.min(POINTS.sizeCap, Math.round(mins / 15) * POINTS.perQuarterHour);
  } else {
    n += POINTS.untimed;
  }
  n += Math.min(POINTS.subtaskCap, ((t.subtasks || []).length) * POINTS.perSubtask);
  n += Math.min(POINTS.pushCap, Math.max(0, Number(t.pushes) || 0) * POINTS.perPush);
  if (t.projectId || t.projectRef) n += POINTS.project;
  return n;
}
// An explicit `worth` overrides the reading. This is the inflation lever —
// the ledger, not the formula, is what keeps it honest.
const taskWorth = (t) => {
  const raw = t == null ? null : t.worth;
  // Guard the empty string explicitly: Number('') is 0, which is a perfectly
  // valid override, so a cleared field would silently make the task worthless.
  if (raw == null || raw === '') return autoWorth(t);
  const o = Number(raw);
  return Number.isFinite(o) && o >= 0 ? Math.round(o) : autoWorth(t);
};

/* Split a total into n whole parts that still sum to the total. The
   remainder goes to the LAST parts, so finishing is worth marginally more
   than starting and nothing is lost to rounding. */
function shares(total, n) {
  if (n <= 0) return [];
  const each = Math.floor(total / n), rem = total - each * n;
  return Array.from({ length: n }, (_, i) => each + (i >= n - rem ? 1 : 0));
}
const subtaskWorth = (t, subId) => {
  const subs = (t && t.subtasks) || [];
  const i = subs.findIndex((s) => s.id === subId);
  return i < 0 ? 0 : shares(taskWorth(t), subs.length)[i];
};
// Late still pays. Ceil rather than floor so a 1-point share never rounds
// away to nothing — "you did it eventually" must never be worth zero.
const latePay = (n) => Math.ceil(n / 2);

/* Streak level, derived rather than stored: +1 for a kept day, -1 for a
   missed one, clamped to 0..5 and walked over a bounded window.

   Derived matters. A stored counter is mutable state that two devices
   would fight over under last-write-wins, and the log is already the
   truth. Deriving it also gives the rule its shape for free: a missed
   day costs one step, not the whole streak. */
function habitLevel(h, uptoISO, windowDays = POINTS.streakWindow) {
  if (!h) return 0;
  const upto = parseISO(uptoISO);
  let start = addDays(upto, -windowDays);
  const born = h.createdAt ? parseISO(h.createdAt) : null;
  if (born && born > start) start = born;
  let level = 0;
  // Days strictly before `uptoISO`: the day being awarded shouldn't pay
  // itself a bonus for having just happened.
  for (let d = new Date(start); d < upto; d = addDays(d, 1)) {
    level = habitDoneOn(h, fmtISO(d)) ? Math.min(5, level + 1) : Math.max(0, level - 1);
  }
  return level;
}
const habitMultiplier = (level) => Math.min(POINTS.streakCap, 1 + POINTS.streakStep * Math.max(0, level));
const habitWorth = (h, iso) => Math.round(POINTS.habit * habitMultiplier(habitLevel(h, iso)));

function pushToToday(t, { activeBlock, curSinceFajr, sinceFajr }) {
  const next = { ...t };
  const st = tStartMin(t), en = tEndMin(t);
  const windowEnd = en != null ? en : st;
  if (!hasVault(t) && windowEnd != null && sinceFajr(windowEnd) <= curSinceFajr) {
    next.start = ''; next.end = ''; next.time = '';
  }
  // BLOCKS is in Fajr→Isha order, which is the logical day's own order.
  const from = BLOCKS.findIndex((b) => b.id === vBlock(next.block));
  const now = BLOCKS.findIndex((b) => b.id === activeBlock);
  if (from >= 0 && now >= 0 && from < now) next.block = activeBlock;
  return next;
}

export { taskDuration,blockForTime,taskUntil,spans,spanLength,spanDayIndex,spanCovers,focusTargetMin,focusSpent,focusMet,addFocusMinutes,hasVault,vaultWindowed,vaultUnlocked,pushToToday,slotPassed,SLOT,estimateMinutes,taskTextSig,structureDay,POINTS,goalWorth,goalCrossed,autoWorth,taskWorth,shares,subtaskWorth,latePay,habitLevel,habitMultiplier,habitWorth,OATH_AR,normalizeArabic,isOath,hashPin,APP_VERSION,BLOCKS,CAIRO,D2R,DEFAULT_LABELS,DEFAULT_SETTINGS,DEFAULT_TIMINGS,LABEL_ICON,LABEL_SWATCHES,LANG,LANGS,MONTHS,MONTHS_AR,PRAYER_BLOCKS,SKY_KEYFRAMES,TIME_24,WEEKDAYS,WEEKDAYS_AR,WEEKDAYS_FULL,WEEKDAYS_FULL_AR,activeBlockAt,addDays,bHint,bName,bSub,blockById,cleanTime,computePrayerTimes,darcsin,darctan2,dsin,firstJsonObject,fixAngle,fixHour,fmtISO,fmtTime,glowLevel,habitDoneOn,habitStreak,inWindow,isRTL,julianDay,lerpArr,lerpN,mdInline,migrateSettings,minutesOf,mkSubs,mm2,mon,newHabit,newProject,pad,parseISO,parseRange,projectPace,projectProgress,renderMarkdown,rgbStr,rgbaStr,sameDay,setLang,setTime24,skyAt,startOfWeek,sunPosition,tx,tEndMin,tStartMin,timeLabel,timeOrder,toHM,uid,vBlock,wd,wdFull,weekdayFullList,windowBounds };

/* The shared key pool, if this copy has been pointed at one.
 *
 * A build can carry defaults (VITE_BROKER_URL / VITE_BROKER_TOKEN) and settings
 * override them. Worth being plain about the trade: a browser app has nowhere
 * to hide a token, so anyone with the bundle has it. That is why each app holds
 * its own, revocable on its own, and why the keys in Settings stay exactly
 * where they are — they are what answers when the pool cannot be reached. */
export function brokerFrom(settings) {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
  const url = String(settings?.brokerUrl || env.VITE_BROKER_URL || '').trim().replace(/\/+$/, '');
  const token = String(settings?.brokerToken || env.VITE_BROKER_TOKEN || '').trim();
  return url && token ? { url, token } : null;
}
