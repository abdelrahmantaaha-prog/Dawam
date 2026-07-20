import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Plus, X, Check, ChevronLeft, ChevronRight, Settings, Sparkles, Trash2, Link as LinkIcon, Image as ImageIcon, StickyNote, Loader2, CheckCircle2, Circle, AlertCircle, Tag, Clock, GripVertical, Inbox, LayoutTemplate, CornerUpRight, Copy, Calendar, Target, TrendingUp, Flag, Languages, Repeat, ChevronDown, Flame, Lock, Shield, KeyRound, Delete } from 'lucide-react';
import { isOath,OATH_AR,hashPin,APP_VERSION,BLOCKS,CAIRO,D2R,DEFAULT_LABELS,DEFAULT_SETTINGS,DEFAULT_TIMINGS,LABEL_ICON,LABEL_SWATCHES,LANG,LANGS,MONTHS,MONTHS_AR,PRAYER_BLOCKS,SKY_KEYFRAMES,TIME_24,WEEKDAYS,WEEKDAYS_AR,WEEKDAYS_FULL,WEEKDAYS_FULL_AR,activeBlockAt,addDays,bHint,bName,bSub,blockById,cleanTime,computePrayerTimes,darcsin,darctan2,dsin,firstJsonObject,fixAngle,fixHour,fmtISO,fmtTime,glowLevel,habitDoneOn,habitStreak,inWindow,isRTL,julianDay,lerpArr,lerpN,mdInline,migrateSettings,minutesOf,mkSubs,mm2,mon,newHabit,newProject,pad,parseISO,parseRange,projectPace,projectProgress,renderMarkdown,rgbStr,rgbaStr,sameDay,setLang,setTime24,skyAt,startOfWeek,sunPosition,tx,tEndMin,tStartMin,timeLabel,timeOrder,toHM,uid,vBlock,wd,wdFull,weekdayFullList,windowBounds } from './core.jsx';
import { rawGet, rawSet, rawDelete, rawList, loadKey, saveKey, storageAvailable, setSaveHook } from './storage.js';
import { createSync, AUTO_EVERY_MS } from './sync.js';
import { ASSISTANT_SYSTEM, buildDaySnapshot, parseAssistantReply, callAssistant } from './assistant.js';

import { AppIcon,BlockRow,FlameGlyph,HabitLine,Landscape,NoteBlock,NotesEditor,PlanSide,PoolEditor,SkyScene,SubtaskEditor,TaskEditor,pyramidPath } from './components.jsx';
import { HabitCard,HabitsView,PinPad,PinScreen,ProjectCard,ProjectsView,SettingsPanel,TemplateEditor,describeOp } from './views.jsx';

export default function Rhythm() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), 6));
  const [week, setWeek] = useState({ tasks: [] });
  const [pool, setPool] = useState([]);            // backlog items (unscheduled)
  const [templates, setTemplates] = useState([]);  // preset task templates
  const [selectedDay, setSelectedDay] = useState(0);
  const [timings, setTimings] = useState(DEFAULT_TIMINGS);
  const [usingFallback, setUsingFallback] = useState(false);
  const [todayTimings, setTodayTimings] = useState(DEFAULT_TIMINGS);
  const [todayData, setTodayData] = useState(null);
  const [nowTick, setNowTick] = useState(0);
  const [storageOk, setStorageOk] = useState(true);
  const [view, setView] = useState('now');         // 'overdue' | 'now' | 'plan'
  const [overdue, setOverdue] = useState([]);
  const [refresh, setRefresh] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [odBusy, setOdBusy] = useState(false);
  const [poolOpen, setPoolOpen] = useState(true);
  const [templatesOpen, setTemplatesOpen] = useState(true);
  const [dumpOpen, setDumpOpen] = useState(true);
  const [wizard, setWizard] = useState(null); // { items:[{kind,id}], idx }
  const [focus, setFocus] = useState(null); // { title, endsAt }
  const [focusTick, setFocusTick] = useState(0);
  const [placer, setPlacer] = useState(null);      // { kind:'pool'|'template', id } → block chooser

  const [dump, setDump] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [preview, setPreview] = useState(null);

  const [editing, setEditing] = useState(null);        // scheduled task id
  const [editingPool, setEditingPool] = useState(null); // pool item id
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState('');
  const [locked, setLocked] = useState(false);          // PIN lock screen
  const [foldedTasks, setFoldedTasks] = useState(() => new Set()); // collapsed subtask lists (Now/Overdue)
  const [editingTpl, setEditingTpl] = useState(null); // recurring task edited from the plan sidebar
  const [oathText, setOathText] = useState('');      // the gate's typed oath
  const [chatOpen, setChatOpen] = useState(false);   // planning assistant
  const [chatMsgs, setChatMsgs] = useState([]);      // [{role:'user'|'assistant', text, proposals?, applied?}]
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatErr, setChatErr] = useState('');
  const toggleFoldTask = (id) => setFoldedTasks((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // Checking off the Now card plays it out to the left, THEN commits the change
  // so the next item slides in from the right. Committing first would swap the
  // content before the old card had left. Duration matches the CSS `now-out`.
  const NOW_EXIT_MS = 220;
  const nowLeavingRef = useRef(false);
  const advanceNow = (key, commit) => {
    if (nowLeavingRef.current) return; // ignore double taps mid-flight
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) { commit(); return; }
    nowLeavingRef.current = true; setNowLeaving(key);
    setTimeout(() => { commit(); nowLeavingRef.current = false; setNowLeaving(null); }, NOW_EXIT_MS);
  };
  const [sideTab, setSideTab] = useState('recurring');  // 'recurring' | 'backlog' — combined plan sidebar
  const [sideOpen, setSideOpen] = useState(true);       // recurring/backlog sidebar collapsed state
  const [nowLeaving, setNowLeaving] = useState(null);   // key of the Now card playing its exit
  const pendingEditRef = useRef(null);                  // open editor after jumping to an overdue task's week

  const weekRef = useRef(week);
  const poolRef = useRef(pool);
  const todayRef = useRef(todayData);
  const weeksRef = useRef({});   // session cache: weekISO -> weekObj
  const stars = useMemo(() => Array.from({ length: 40 }, () => ({ x: Math.random() * 100, y: Math.random() * 92, base: 0.35 + Math.random() * 0.55, tw: 2.5 + Math.random() * 3.5, dl: Math.random() * 4 })), []);
  const birds = useMemo(() => Array.from({ length: 11 }, () => ({ x: 4 + Math.random() * 90, y: 4 + Math.random() * 66, scale: 0.6 + Math.random() * 0.7, dl: Math.random() * 5 })), []);
  const weekKey = `planner:week:${fmtISO(weekStart)}`;
  const bumpRefresh = () => setRefresh((n) => n + 1);
  useEffect(() => { weekRef.current = week; }, [week]);
  useEffect(() => { poolRef.current = pool; }, [pool]);
  useEffect(() => { todayRef.current = todayData; }, [todayData]);

  /* ---- init ---- */
  useEffect(() => {
    (async () => {
      try {
        const token = String(Date.now());
        await rawSet('planner:__probe', JSON.stringify(token));
        setStorageOk((await loadKey('planner:__probe')) === token);
      } catch { setStorageOk(false); }
      const s = await loadKey('planner:settings');
      const pl = await loadKey('planner:pool');
      const tpl = await loadKey('planner:templates');
      const merged = migrateSettings(s);
      setLang(merged.lang);
      setSettings(merged);
      if (merged.pin && merged.pin.hash) setLocked(true);
      const poolArr = Array.isArray(pl) ? pl : (pl && pl.items) || [];
      setPool(poolArr); poolRef.current = poolArr;
      // Legacy recurring tasks stored a free-text `time`; parse it once into
      // proper start/end so the editor can use real time inputs.
      const tplMigrated = (Array.isArray(tpl) ? tpl : []).map((tp) => {
        if (tp.start || tp.end || !tp.time) return tp;
        const r = parseRange(tp.time);
        return r ? { ...tp, start: mm2(r.start), end: r.end != null ? mm2(r.end) : '', time: '' } : tp;
      });
      setTemplates(tplMigrated);
      // Land on the current Fajr→Fajr day (pre-dawn, that's still yesterday).
      const today = logicalDayMid();
      const ws = startOfWeek(today, merged.weekStartDay);
      setWeekStart(ws);
      const idx = Math.round((today - ws) / 86400000);
      setSelectedDay(idx >= 0 && idx <= 6 ? idx : 0);
      // Preload every stored week into the session cache. localStorage is on-device
      // and synchronous underneath, so this is cheap — and it makes cross-week
      // features (tasks under a Project, overdue) complete instead of limited to
      // weeks visited this session.
      try {
        const weekKeys = await rawList('planner:week:');
        for (const k of weekKeys) {
          const iso = k.slice('planner:week:'.length);
          if (!weeksRef.current[iso]) { const wk = await loadKey(k); if (wk) weeksRef.current[iso] = wk; }
        }
      } catch { /* preload is an optimization; the app works without it */ }
      setReady(true);
      pruneStorage(merged.weekStartDay);
    })();
  }, []);

  /* ---- week cache read/write (session-authoritative, storage = backup) ---- */
  const todayWeekISO = () => fmtISO(startOfWeek(new Date(), settings.weekStartDay));
  const readWeek = async (wsISO) => {
    let base = weeksRef.current[wsISO];
    if (!base) {
      base = await loadKey(`planner:week:${wsISO}`);
      if (base == null) base = await loadKey(`planner:week:${wsISO}`); // retry once: a transient read failure must not become a cached-empty week that later writes clobber
      base = base || { tasks: [] };
    }
    weeksRef.current[wsISO] = base;
    return base;
  };
  const writeWeek = async (wsISO, weekObj) => {
    weeksRef.current[wsISO] = weekObj;
    saveKey(`planner:week:${wsISO}`, weekObj);
    if (wsISO === fmtISO(weekStart)) { weekRef.current = weekObj; setWeek(weekObj); }
    else if (wsISO === todayWeekISO()) { todayRef.current = weekObj; setTodayData(weekObj); }
  };

  /* ---- load displayed week ---- */
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => { const w = await readWeek(fmtISO(weekStart)); if (!cancelled) { weekRef.current = w; setWeek(w); } })();
    return () => { cancelled = true; };
  }, [weekStart, ready]);

  // After jumping to an overdue/project task's week, open its editor once loaded.
  useEffect(() => {
    if (!pendingEditRef.current) return;
    const id = pendingEditRef.current;
    if ((week.tasks || []).some((tk) => tk.id === id)) { setEditing(id); pendingEditRef.current = null; }
  }, [week]);

  /* ---- prayer times ---- */
  const loadTimings = useCallback((date) => {
    const p = settings.prayer;
    if (!p.useLive) return { t: { ...DEFAULT_TIMINGS, ...p.customTimes }, fallback: false };
    try {
      const tz = -new Date(date).getTimezoneOffset() / 60;
      return { t: computePrayerTimes(date, CAIRO.lat, CAIRO.lng, tz, CAIRO.fajrAngle, CAIRO.ishaAngle, CAIRO.asrFactor), fallback: false };
    } catch { return { t: { ...DEFAULT_TIMINGS, ...p.customTimes }, fallback: true }; }
  }, [settings.prayer]);

  const selectedDate = addDays(weekStart, selectedDay);
  useEffect(() => { if (!ready) return; const { t, fallback } = loadTimings(selectedDate); setTimings(t); setUsingFallback(fallback); }, [selectedDay, weekStart, ready, loadTimings]);
  useEffect(() => { if (!ready) return; setTodayTimings(loadTimings(new Date()).t); }, [ready, loadTimings]);

  // The app's day runs Fajr → next Fajr. Between midnight and today's Fajr we
  // are still in *yesterday's* day, so the logical "today" is the previous date.
  // Everything that means "today" (the Now queue, overdue, the Plan highlight,
  // habits, prayers) resolves through this so the whole app agrees on the
  // boundary. `at` lets callers ask about a specific instant.
  const logicalDayMid = useCallback((at) => {
    const ref = at ? new Date(at) : new Date();
    const cm = ref.getHours() * 60 + ref.getMinutes();
    const d = new Date(ref); d.setHours(0, 0, 0, 0);
    const fm = minutesOf(todayTimings.Fajr);
    return (fm != null && cm < fm) ? addDays(d, -1) : d;
  }, [todayTimings]);

  /* ---- today's week (when not displayed) ---- */
  useEffect(() => {
    if (!ready) return;
    const today = logicalDayMid();
    const tws = startOfWeek(today, settings.weekStartDay);
    if (fmtISO(tws) === fmtISO(weekStart)) { setTodayData(null); return; }
    let cancelled = false;
    (async () => { const w = await readWeek(fmtISO(tws)); if (!cancelled) { todayRef.current = w; setTodayData(w); } })();
    return () => { cancelled = true; };
  }, [ready, weekStart, settings.weekStartDay, logicalDayMid]);

  /* ---- overdue scan ---- */
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      const wsd = settings.weekStartDay;
      // "Today" is the current Fajr→Fajr day. Days before it are fully past;
      // within today, a task is overdue once its block has ended — measured on
      // the Fajr-anchored clock so the pre-dawn hours belong to the day that is
      // ending, not the one about to begin.
      const today = logicalDayMid();
      const n = new Date(); const curMin = n.getHours() * 60 + n.getMinutes();
      const fajrM = minutesOf(todayTimings.Fajr);
      const sinceFajr = (m) => (fajrM == null ? m : (((m - fajrM) % 1440) + 1440) % 1440);
      const curSinceFajr = sinceFajr(curMin);
      const startW = startOfWeek(windowBounds().start, wsd);
      const endW = startOfWeek(today, wsd);
      const todayWS = fmtISO(startOfWeek(today, wsd));
      const items = [];
      for (let ws = new Date(startW); ws <= endW; ws = addDays(ws, 7)) {
        const wsISO = fmtISO(ws);
        let wd;
        if (wsISO === fmtISO(weekStart)) wd = week;
        else if (todayData && wsISO === todayWS) wd = todayData;
        else if (weeksRef.current[wsISO]) wd = weeksRef.current[wsISO];
        else wd = await loadKey(`planner:week:${wsISO}`);
        if (!wd || !wd.tasks) continue;
        for (const t of wd.tasks) {
          if (t.done) continue;
          const d = addDays(ws, t.day);
          if (d < today) { items.push({ t, ws: new Date(ws), date: d }); continue; }
          if (fmtISO(d) === fmtISO(today)) {
            const st = tStartMin(t), en = tEndMin(t);
            let endMin = null;
            if (en != null) endMin = (st != null && en <= st) ? en + 1440 : en;
            else { const ek = blockById(t.block).endKey; endMin = ek ? minutesOf(todayTimings[ek]) : null; }
            if (endMin != null && sinceFajr(endMin) <= curSinceFajr) items.push({ t, ws: new Date(ws), date: d });
          }
        }
      }
      items.sort((a, b) => (a.date - b.date) || (a.t.order - b.t.order));
      if (!cancelled) setOverdue(items);
    })();
    return () => { cancelled = true; };
  }, [ready, weekStart, week, todayData, settings.weekStartDay, todayTimings, nowTick, view, refresh, logicalDayMid]);

  useEffect(() => { const id = setInterval(() => setNowTick((x) => x + 1), 30000); return () => clearInterval(id); }, []);


  /* ---- persistence ---- */
  const persistWeek = useCallback((next) => {
    const wsISO = fmtISO(weekStart);
    weeksRef.current[wsISO] = next; weekRef.current = next; setWeek(next);
    saveKey(`planner:week:${wsISO}`, next);
  }, [weekStart]);
  const persistSettings = useCallback((next) => { setSettings(next); saveKey('planner:settings', next); }, []);
  const changeLang = useCallback((lng) => { setLang(lng); setSettings((prev) => { const n = { ...prev, lang: lng }; saveKey('planner:settings', n); return n; }); }, []);
  const persistPool = (next) => { poolRef.current = next; setPool(next); saveKey('planner:pool', next); };
  // Accepts a value or an updater(prev)=>next, so rapid edits are always applied
  // against the freshest recurring-task list (never a stale closure).
  const persistTemplates = (next) => setTemplates((prev) => { const v = typeof next === 'function' ? next(prev) : next; saveKey('planner:templates', v); return v; });
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2200); };

  /* ---- backup ---- */
  const buildExport = async () => {
    const data = {};
    data['planner:settings'] = settings;
    data['planner:pool'] = poolRef.current;
    data['planner:templates'] = templates;
    const today = new Date();
    const winStart = startOfWeek(new Date(today.getFullYear(), today.getMonth() - 1, 1), settings.weekStartDay);
    const winEnd = new Date(today.getFullYear(), today.getMonth() + 3, 0);
    const wkInWindow = (iso) => { const d = new Date(iso + 'T00:00:00'); return d >= winStart && d <= winEnd; };
    for (const [wsISO, v] of Object.entries(weeksRef.current)) if (v && wkInWindow(wsISO)) data[`planner:week:${wsISO}`] = v;
    const probed = [];
    for (let cur = new Date(winStart); cur <= winEnd; cur = addDays(cur, 7)) probed.push(`planner:week:${fmtISO(cur)}`);
    const keys = Array.from(new Set([...(await rawList('planner:')), ...probed]));
    for (const k of keys) {
      if (k.startsWith('planner:prayers:') || k === 'planner:__probe' || data[k] != null) continue;
      if (k.startsWith('planner:snapshot:') || k === 'planner:lastExport') continue; // snapshots must never nest inside exports/snapshots
      if (k.startsWith('planner:week:') && !wkInWindow(k.slice(13))) continue;
      try { const v = await loadKey(k); if (v != null) data[k] = v; } catch { /* skip */ }
    }
    return JSON.stringify({ app: 'rhythm-planner', version: 3, exportedAt: new Date().toISOString(), window: { from: fmtISO(winStart), to: fmtISO(winEnd) }, storageOk, data }, null, 2);
  };
  const applyImport = async (text) => {
    let parsed;
    try { parsed = JSON.parse(text); } catch { return { ok: false, msg: "That isn't valid JSON." }; }
    if (!parsed || parsed.app !== 'rhythm-planner' || !parsed.data) return { ok: false, msg: "This doesn't look like a Rhythm backup." };
    const d = parsed.data;
    let n = 0;
    for (const [k, v] of Object.entries(d)) {
      if (!k.startsWith('planner:') || k.startsWith('planner:prayers:') || k === 'planner:__probe') continue;
      await saveKey(k, v); n++;
    }
    const s = d['planner:settings'];
    const merged = s ? migrateSettings(s) : settings;
    setLang(merged.lang);
    const cache = {};
    for (const [k, v] of Object.entries(d)) if (k.startsWith('planner:week:') && v) cache[k.slice(13)] = v;
    weeksRef.current = cache;
    const plArr = Array.isArray(d['planner:pool']) ? d['planner:pool'] : ((d['planner:pool'] && d['planner:pool'].items) || []);
    const wsNew = startOfWeek(new Date(), merged.weekStartDay);
    persistSettings(merged);
    persistPool(plArr);
    setTemplates(Array.isArray(d['planner:templates']) ? d['planner:templates'] : []);
    setWeekStart(wsNew);
    const w = await readWeek(fmtISO(wsNew)); weekRef.current = w; setWeek(w);
    flash(tx('Backup imported.', 'تم استيراد النسخة الاحتياطية.'));
    return { ok: true, msg: tx(`Imported ${n} item${n !== 1 ? 's' : ''}. Your planner has been refreshed.`, `تم استيراد ${n} عنصرًا. تم تحديث مخططك.`) };
  };

  /* ---- prune ---- */
  const pruneStorage = async (wsd) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    // Keep AT LEAST 4 full weeks of history regardless of where we are in the
    // month; weeks age out one at a time as each new week starts.
    const monthWin = startOfWeek(windowBounds().start, wsd);
    const fourBack = addDays(startOfWeek(today, wsd), -28);
    const winStartWeek = monthWin < fourBack ? monthWin : fourBack;
    for (const k of await rawList('planner:')) {
      if (k.startsWith('planner:prayers:')) { const d = new Date(k.slice('planner:prayers:'.length) + 'T00:00:00'); if (isNaN(d) || d < addDays(today, -2)) await rawDelete(k); }
      else if (k.startsWith('planner:week:')) { const d = new Date(k.slice(13) + 'T00:00:00'); if (!isNaN(d) && d < winStartWeek) await rawDelete(k); }
    }
  };

  /* ---- label helpers (labels are the colored task tags) ---- */
  const labelById = (id) => settings.labels.find((p) => p.id === id) || null;
  const ensureLabel = (name, labels) => {
    if (!name) return { id: null, labels };
    const found = labels.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (found) return { id: found.id, labels };
    const np = { id: uid(), name, color: LABEL_SWATCHES[labels.length % LABEL_SWATCHES.length] };
    return { id: np.id, labels: [...labels, np] };
  };
  /* ---- long-term project helpers ---- */
  // Functional setState + persist, so fast typing in name/goal/target can't drop
  // characters against a stale snapshot.
  const persistProjects = (updater) => setSettings((prev) => {
    const nextProjects = typeof updater === 'function' ? updater(prev.projects || []) : updater;
    const n = { ...prev, projects: nextProjects };
    saveKey('planner:settings', n);
    return n;
  });
  const updProjectItem = (id, patch) => persistProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const addProjectItem = () => { const np = newProject(); persistProjects((prev) => [...prev, np]); return np; };
  const delProjectItem = (id) => persistProjects((prev) => prev.filter((p) => p.id !== id));
  const logProgress = (id, amount, note) => {
    const amt = Number(amount); if (!amt) return;
    persistProjects((prev) => prev.map((p) => (p.id === id ? { ...p, entries: [...(p.entries || []), { id: uid(), date: fmtISO(new Date()), amount: amt, note: note || '' }] } : p)));
  };
  // Tasks linked to a project via task.projectRef, gathered across every week
  // held in the session cache plus the backlog. Returns concrete refs so the
  // Projects tab can list them, toggle them, and jump to them.
  const projectTaskList = (projId) => {
    if (!projId) return { tasks: [], total: 0, done: 0 };
    const out = [];
    const seen = new Set();
    const scan = (wk, wsISO) => (wk?.tasks || []).forEach((tk) => {
      if (tk.projectRef === projId && !seen.has(tk.id)) {
        seen.add(tk.id);
        out.push({ id: tk.id, title: tk.title, done: !!tk.done, wsISO, day: tk.day, date: addDays(parseISO(wsISO), tk.day), block: tk.block, kind: 'task' });
      }
    });
    const curISO = fmtISO(weekStart);
    scan(weekRef.current, curISO);
    Object.entries(weeksRef.current).forEach(([iso, wk]) => { if (iso !== curISO) scan(wk, iso); });
    poolRef.current.forEach((it) => { if (it.projectRef === projId && !seen.has(it.id)) { seen.add(it.id); out.push({ id: it.id, title: it.title, done: !!it.done, wsISO: null, day: null, date: null, block: null, kind: 'pool' }); } });
    out.sort((a, b) => (a.date && b.date ? a.date - b.date : a.date ? -1 : b.date ? 1 : 0));
    return { tasks: out, total: out.length, done: out.filter((x) => x.done).length };
  };
  // Toggle a project task's done state in whatever week it lives in.
  const toggleProjectTask = (ref) => {
    if (ref.kind === 'pool') { togglePoolDone(ref.id); return; }
    if (!ref.wsISO) return;
    const wk = ref.wsISO === fmtISO(weekStart) ? weekRef.current : weeksRef.current[ref.wsISO];
    if (!wk) return;
    const next = { ...wk, tasks: (wk.tasks || []).map((tk) => tk.id === ref.id ? { ...tk, done: !tk.done } : tk) };
    weeksRef.current[ref.wsISO] = next;
    saveKey(`planner:week:${ref.wsISO}`, next);
    if (ref.wsISO === fmtISO(weekStart)) { weekRef.current = next; setWeek(next); }
    bumpRefresh();
  };
  const openProjectTask = (ref) => {
    if (ref.kind === 'pool') { setView('plan'); setEditingPool(ref.id); return; }
    const ws = parseISO(ref.wsISO);
    setWeekStart(ws); setSelectedDay(ref.day); setView('plan'); pendingEditRef.current = ref.id;
  };

  /* ---- habits (stored in settings) ---- */
  const persistHabits = (updater) => setSettings((prev) => {
    const next = typeof updater === 'function' ? updater(prev.habits || []) : updater;
    const n = { ...prev, habits: next }; saveKey('planner:settings', n); return n;
  });
  const addHabit = () => { const h = newHabit(); persistHabits((prev) => [...prev, h]); return h; };
  const updHabit = (id, patch) => persistHabits((prev) => prev.map((h) => h.id === id ? { ...h, ...patch } : h));
  const delHabit = (id) => persistHabits((prev) => prev.filter((h) => h.id !== id));
  const toggleHabitDay = (id, iso) => persistHabits((prev) => prev.map((h) => {
    if (h.id !== id) return h; const log = { ...(h.log || {}) }; if (log[iso]) delete log[iso]; else log[iso] = 1; return { ...h, log };
  }));

  /* ---- PIN (soft lock) ---- */
  const setPin = async (pin) => {
    if (!pin) { persistSettings({ ...settings, pin: null }); return; }
    const salt = uid() + uid();
    const hash = await hashPin(pin, salt);
    persistSettings({ ...settings, pin: { hash, salt } });
  };
  const verifyPin = async (pin) => {
    if (!settings.pin) return true;
    const h = await hashPin(pin, settings.pin.salt);
    return h === settings.pin.hash;
  };
  // An installed PWA stays alive in memory, so switching apps and returning never
  // reloads the page — the on-load lock alone never fires again. Re-lock when the
  // app comes back to the foreground after being hidden for more than a short
  // grace period (quick app switches stay frictionless).
  const PIN_RELOCK_MS = 30000;
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => {
    let hiddenAt = null;
    const onVis = () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > PIN_RELOCK_MS && settingsRef.current.pin?.hash) setLocked(true);
      hiddenAt = null;
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  /* ---- cross-device sync (last-write-wins per key) ----
     The backend was removed for now, so `getTransport` returns null and every
     sync is a clean no-op. The merge engine, the dirty queue and the twice-a-day
     cadence all stay live, so wiring a backend later is one function. */
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [lastSync, setLastSync] = useState(null);
  // Applying a remote key routes into live state WITHOUT re-persisting (the sync
  // engine already wrote storage) — persisting here would echo the key back.
  const applyRemote = useCallback((key, raw) => {
    let v; try { v = JSON.parse(raw); } catch { return; }
    if (key === 'planner:settings') { const m = migrateSettings(v); setLang(m.lang); setSettings(m); if (!m.pin) setLocked(false); }
    else if (key === 'planner:pool') { const arr = Array.isArray(v) ? v : []; poolRef.current = arr; setPool(arr); }
    else if (key === 'planner:templates') { setTemplates(Array.isArray(v) ? v : []); }
    else if (key.startsWith('planner:week:')) {
      const iso = key.slice('planner:week:'.length);
      weeksRef.current[iso] = v;
      if (iso === fmtISO(weekStart)) { weekRef.current = v; setWeek(v); }
    }
    bumpRefresh();
  }, [weekStart]);
  const syncRef = useRef(null);
  if (!syncRef.current) {
    syncRef.current = createSync({
      // No backend wired up yet — returning null keeps the app fully local.
      getTransport: () => null,
      onRemote: (k, raw) => applyRemoteRef.current(k, raw),
    });
  }
  const applyRemoteRef = useRef(applyRemote);
  useEffect(() => { applyRemoteRef.current = applyRemote; }, [applyRemote]);
  const runSync = useCallback(async ({ auto = false } = {}) => {
    if (!syncRef.current) return;
    setSyncBusy(true); setSyncMsg('');
    try {
      const r = await syncRef.current.syncNow({ auto });
      if (!r.skipped) {
        setLastSync(new Date());
        if (!auto) setSyncMsg(tx(`Synced — ${r.pulled} pulled, ${r.pushed} pushed.`, `تمت المزامنة — ${r.pulled} وارد، ${r.pushed} صادر.`));
      } else if (!auto && r.skipped === 'not configured') {
        setSyncMsg(tx('No sync backend is connected yet — your planner stays on this device.', 'لا يوجد خادم مزامنة متصل بعد — يبقى مخططك على هذا الجهاز.'));
      }
    } catch (e) { setSyncMsg(String(e.message || e)); }
    setSyncBusy(false);
  }, []);
  // Local edits only stamp the dirty queue; they no longer trigger a push.
  // Uploads happen on the twice-a-day cadence, or when you press Sync now.
  useEffect(() => {
    setSaveHook((key) => { syncRef.current && syncRef.current.markDirty(key); });
    return () => setSaveHook(null);
  }, []);
  // Automatic sync: at most twice a day. Checked on launch and whenever the app
  // comes back to the foreground — a static PWA has no background scheduler, so
  // "twice a day" means the first launch/foreground past each 12-hour mark.
  useEffect(() => {
    if (!ready) return;
    runSync({ auto: true });
    const maybeAuto = () => { if (!document.hidden) runSync({ auto: true }); };
    document.addEventListener('visibilitychange', maybeAuto);
    window.addEventListener('online', maybeAuto);
    return () => { document.removeEventListener('visibilitychange', maybeAuto); window.removeEventListener('online', maybeAuto); };
  }, [ready, runSync]);

  /* ---- scheduled task ops (operate on the displayed week) ---- */
  // Within a block, order is MANUAL (`order` asc, done last). New tasks get an
  // order seeded from their start time, so timed tasks still land in a sane
  // spot — but the arrows on the Plan page are the source of truth, because
  // this exact order drives the one-at-a-time Now queue.
  const tasksFor = (dayIdx, blockId) =>
    week.tasks.filter((t) => t.day === dayIdx && t.block === blockId).sort((a, b) => (a.done - b.done) || (a.order - b.order));

  const addTask = (dayIdx, blockId, title, extra = {}) => {
    if (!title.trim()) return;
    const w = weekRef.current;
    const t = {
      id: uid(), title: title.trim(), day: dayIdx, block: blockId,
      projectId: extra.projectId || null, time: extra.time || '', start: extra.start || '', end: extra.end || '', templateId: extra.templateId || null, done: false,
      subtasks: extra.subtasks ? mkSubs(extra.subtasks.map((s) => (typeof s === 'string' ? s : s.title))) : [],
      notes: extra.notes || [], order: extra.order != null ? extra.order : (timeOrder(extra.time) + Date.now() % 1000),
    };
    persistWeek({ ...w, tasks: [...w.tasks, t] });
  };
  const mutateTask = (id, fn) => { const w = weekRef.current; persistWeek({ ...w, tasks: w.tasks.map((t) => (t.id === id ? fn(t) : t)) }); };

  // Move a task to an absolute calendar date. If that date lands in a different
  // week object, relocate it there (tasks are stored per-week with a 0–6 day index).
  const moveTaskToDate = async (id, dateISO) => {
    const w = weekRef.current;
    const task = w.tasks.find((t) => t.id === id);
    if (!task || !dateISO) return;
    const target = parseISO(dateISO);
    const targetWS = startOfWeek(target, settings.weekStartDay);
    const newDay = Math.round((target - targetWS) / 86400000);
    if (newDay < 0 || newDay > 6) return;
    if (fmtISO(targetWS) === fmtISO(weekStart)) { mutateTask(id, (t) => ({ ...t, day: newDay })); return; }
    // cross-week: remove here, add to the target week object
    persistWeek({ ...w, tasks: w.tasks.filter((t) => t.id !== id) });
    const destISO = fmtISO(targetWS);
    const dest = await readWeek(destISO);
    await writeWeek(destISO, { ...dest, tasks: [...(dest.tasks || []), { ...task, day: newDay }] });
    setEditing(null);
    flash(`${tx('Moved to', 'نُقلت إلى')} ${wd(target.getDay())} ${target.getDate()} ${mon(target.getMonth())}.`);
  };
  const removeTask = (id) => { const w = weekRef.current; persistWeek({ ...w, tasks: w.tasks.filter((t) => t.id !== id) }); setEditing(null); };
  const toggleDone = (id) => mutateTask(id, (t) => ({ ...t, done: !t.done }));
  const toggleSub = (id, subId) => mutateTask(id, (t) => ({ ...t, subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)) }));
  const moveTaskToBlock = (id, block) => mutateTask(id, (t) => ({ ...t, block }));
  // Drag-to-reorder: drop the task into `blockId` right before/after `targetId`
  // (or at the block's end when targetId is null), then renumber 1..n so the
  // manual order is stable. This exact order drives the one-at-a-time Now queue.
  const moveTaskToPosition = (id, blockId, targetId, after) => {
    const w = weekRef.current;
    const dragged = w.tasks.find((t) => t.id === id); if (!dragged) return;
    const dest = w.tasks.filter((t) => t.block === blockId && t.id !== id).sort((a, b) => (a.done - b.done) || (a.order - b.order));
    let idx = dest.length;
    if (targetId) { const ti = dest.findIndex((t) => t.id === targetId); if (ti >= 0) idx = ti + (after ? 1 : 0); }
    const ordered = [...dest.slice(0, idx), dragged, ...dest.slice(idx)];
    const orderOf = new Map(ordered.map((t, i) => [t.id, i + 1]));
    persistWeek({ ...w, tasks: w.tasks.map((t) => (t.id === id ? { ...t, block: blockId, order: orderOf.get(t.id) } : orderOf.has(t.id) ? { ...t, order: orderOf.get(t.id) } : t)) });
  };

  /* ---- pool (backlog) ops ---- */
  const addPoolItem = (title, extra = {}) => {
    if (!title.trim()) return;
    const it = { id: uid(), title: title.trim(), projectId: extra.projectId || null, subtasks: extra.subtasks ? mkSubs(extra.subtasks.map((s) => (typeof s === 'string' ? s : s.title))) : [], notes: extra.notes || [], order: Date.now() };
    persistPool([...poolRef.current, it]);
    return it;
  };
  const mutatePoolItem = (id, fn) => persistPool(poolRef.current.map((p) => (p.id === id ? fn(p) : p)));
  const togglePoolDone = (id) => mutatePoolItem(id, (p) => ({ ...p, done: !p.done }));
  const removePoolItem = (id) => { persistPool(poolRef.current.filter((p) => p.id !== id)); setEditingPool(null); };
  const togglePoolSub = (id, subId) => mutatePoolItem(id, (p) => ({ ...p, subtasks: p.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)) }));

  // Move a scheduled task into the backlog (unschedule).
  const taskToPool = (id) => {
    const w = weekRef.current;
    const t = w.tasks.find((x) => x.id === id);
    if (!t) return;
    persistWeek({ ...w, tasks: w.tasks.filter((x) => x.id !== id) });
    persistPool([...poolRef.current, { id: uid(), title: t.title, projectId: t.projectId || null, projectRef: t.projectRef || null, subtasks: t.subtasks || [], notes: t.notes || [], order: Date.now() }]);
    flash(tx('Moved to backlog.', 'نُقلت إلى قائمة الانتظار.'));
  };
  // Schedule a backlog item onto a day/block.
  const poolToDay = (poolId, dayIdx, blockId) => {
    const it = poolRef.current.find((p) => p.id === poolId);
    if (!it) return;
    persistPool(poolRef.current.filter((p) => p.id !== poolId));
    const w = weekRef.current;
    const t = { id: uid(), title: it.title, day: dayIdx, block: blockId, projectId: it.projectId || null, projectRef: it.projectRef || null, time: '', done: false, subtasks: it.subtasks || [], notes: it.notes || [], order: Date.now() };
    // ensure we schedule on the currently-displayed week (dayIdx is within it)
    persistWeek({ ...w, tasks: [...w.tasks, t] });
  };

  /* ---- recurring tasks (stored as `templates` for backward compatibility) ---- */
  // A recurring task is only ever a *definition*. Applying it copies everything
  // by value (fresh subtask ids via mkSubs in addTask/addPoolItem), so editing a
  // recurring task later never reaches back into tasks you've already added.
  const addTemplate = (tpl) => persistTemplates((prev) => [...prev, { id: uid(), title: tpl.title || tx('New recurring task', 'مهمة متكررة جديدة'), block: vBlock(tpl.block), start: tpl.start || '', end: tpl.end || '', time: '', projectId: tpl.projectId || null, subtasks: (tpl.subtasks || []).map((s) => (typeof s === 'string' ? s : s.title)) }]);
  const updTemplate = (id, patch) => persistTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const delTemplate = (id) => persistTemplates((prev) => prev.filter((t) => t.id !== id));
  const templateToDay = (tplId, dayIdx, blockId) => {
    const tpl = templates.find((t) => t.id === tplId); if (!tpl) return;
    // clone subtasks (strings) so the created task shares nothing with the definition
    addTask(dayIdx, blockId || tpl.block, tpl.title, { projectId: tpl.projectId, start: tpl.start || '', end: tpl.end || '', time: tpl.time || '', templateId: tpl.id, subtasks: [...(tpl.subtasks || [])] });
  };
  const templateToPool = (tplId) => {
    const tpl = templates.find((t) => t.id === tplId); if (!tpl) return;
    addPoolItem(tpl.title, { projectId: tpl.projectId, subtasks: [...(tpl.subtasks || [])] });
    flash(tx('Added to backlog.', 'أُضيفت إلى قائمة الانتظار.'));
  };

  /* ---- overdue actions ---- */
  const completeOverdue = async (item) => {
    const wsISO = fmtISO(item.ws);
    const cur = await readWeek(wsISO);
    await writeWeek(wsISO, { ...cur, tasks: (cur.tasks || []).map((x) => (x.id === item.t.id ? { ...x, done: true } : x)) });
    setOverdue((prev) => prev.filter((x) => x.t.id !== item.t.id));
  };
  const completeAllOverdue = async () => {
    if (!overdue.length || odBusy) return; setOdBusy(true);
    const byWeek = {}; for (const it of overdue) (byWeek[fmtISO(it.ws)] = byWeek[fmtISO(it.ws)] || []).push(it);
    for (const [wsISO, list] of Object.entries(byWeek)) {
      const ids = new Set(list.map((x) => x.t.id));
      const cur = await readWeek(wsISO);
      await writeWeek(wsISO, { ...cur, tasks: (cur.tasks || []).map((x) => (ids.has(x.id) ? { ...x, done: true } : x)) });
    }
    setOverdue([]); setOdBusy(false); bumpRefresh(); flash(tx('Overdue cleared — all marked done.', 'تم إنجاز كل المتأخرات.'));
  };
  const deleteAllOverdue = async () => {
    if (!overdue.length || odBusy) return; setOdBusy(true);
    const byWeek = {}; for (const it of overdue) (byWeek[fmtISO(it.ws)] = byWeek[fmtISO(it.ws)] || []).push(it);
    for (const [wsISO, list] of Object.entries(byWeek)) {
      const ids = new Set(list.map((x) => x.t.id));
      const cur = await readWeek(wsISO);
      await writeWeek(wsISO, { ...cur, tasks: (cur.tasks || []).filter((x) => !ids.has(x.id)) });
    }
    setOverdue([]); setOdBusy(false); setConfirmDelete(false); bumpRefresh(); flash(tx('Overdue cleared.', 'تم مسح المتأخرات.'));
  };
  const jumpToTask = (item) => {
    const ws = startOfWeek(item.date, settings.weekStartDay);
    setWeekStart(ws); setSelectedDay(Math.round((item.date - ws) / 86400000)); setView('plan');
  };
  // Open the editor for an overdue task, loading its week first if needed.
  const editOverdue = (item) => {
    const ws = startOfWeek(item.date, settings.weekStartDay);
    const day = Math.round((item.date - ws) / 86400000);
    setView('plan'); setSelectedDay(day);
    if (fmtISO(ws) === fmtISO(weekStart) && (weekRef.current.tasks || []).some((tk) => tk.id === item.t.id)) {
      setEditing(item.t.id); // already in the loaded week
    } else {
      pendingEditRef.current = item.t.id; setWeekStart(ws); // opens via effect once the week loads
    }
  };

  // Prayer performance, stored per-day inside the week object.
  // Anti-cheat penalty: unmarking a prayer during its own window arms a fresh
  // 15-minute hard lock. Persisted in a device-local (non-synced) key so a page
  // reload can't dodge it. Keyed by day:block.
  const PENALTY_KEY = 'rhythm:prayerPenalty';
  const prayerPenaltyRef = useRef((() => {
    try {
      const raw = JSON.parse(localStorage.getItem(PENALTY_KEY) || '{}');
      const cutoff = Date.now() - 2 * 86400000; // drop entries older than ~2 days
      const out = {}; for (const k in raw) if (raw[k] > cutoff) out[k] = raw[k];
      return out;
    } catch { return {}; }
  })());
  const savePenalty = () => { try { localStorage.setItem(PENALTY_KEY, JSON.stringify(prayerPenaltyRef.current)); } catch { /* ignore */ } };
  const togglePrayer = async (blockId, forDate) => {
    const t = forDate ? new Date(forDate) : new Date(); t.setHours(0, 0, 0, 0);
    const ws = startOfWeek(t, settings.weekStartDay);
    const wsISO = fmtISO(ws);
    const dIdx = Math.round((t - ws) / 86400000);
    const cur = await readWeek(wsISO);
    const prayers = { ...(cur.prayers || {}) };
    const day = { ...(prayers[dIdx] || {}) };
    const willBeDone = !day[blockId];
    const key = `${fmtISO(t)}:${blockId}`;
    // Unmark → punish (re-lock 15 min). Re-mark → clear any pending penalty.
    if (!willBeDone) { prayerPenaltyRef.current[key] = Date.now(); savePenalty(); }
    else if (prayerPenaltyRef.current[key]) { delete prayerPenaltyRef.current[key]; savePenalty(); }
    day[blockId] = willBeDone;
    prayers[dIdx] = day;
    await writeWeek(wsISO, { ...cur, prayers });
    bumpRefresh();
  };

  // "Plan the day" wizard: walk templates then backlog, one by one.
  const startFocus = (task, minutes, untilEnd) => {
    const now = Date.now();
    let endsAt = now + (minutes || 25) * 60000;
    if (untilEnd) {
      const endMin = tEndMin(task);
      if (endMin != null) {
        const d = new Date(); const target = new Date(); target.setHours(0, 0, 0, 0);
        target.setMinutes(endMin); let ms = target.getTime();
        if (ms <= now) ms += 86400000; // end already passed today -> treat as overnight
        endsAt = ms;
      }
    }
    setFocus({ id: task.id, title: task.title || 'Focus', endsAt });
  };
  useEffect(() => {
    if (!focus) return;
    const id = setInterval(() => { setFocusTick((x) => x + 1); if (Date.now() >= focus.endsAt) setFocus(null); }, 1000);
    return () => clearInterval(id);
  }, [focus]);

  const startWizard = () => {
    const blockOrder = (id) => BLOCKS.findIndex((b) => b.id === id);
    // 1) Overdue, oldest first (already sorted in `overdue`)
    const overdueItems = overdue.map((o) => ({ kind: 'overdue', id: o.t.id, ws: fmtISO(o.ws) }));
    // 2) Existing tasks already on the selected day, ordered by block then start time
    const dayTasks = weekRef.current.tasks
      .filter((t) => t.day === selectedDay)
      .sort((a, b) => (blockOrder(a.block) - blockOrder(b.block)) || ((tStartMin(a) ?? 1e9) - (tStartMin(b) ?? 1e9)))
      .map((t) => ({ kind: 'review', id: t.id }));
    // 3) Templates, ordered by period of the day
    const tplItems = [...templates]
      .sort((a, b) => blockOrder(a.block) - blockOrder(b.block))
      .map((t) => ({ kind: 'template', id: t.id }));
    // 4) Backlog
    const poolItems = poolRef.current.map((p) => ({ kind: 'pool', id: p.id }));
    // 5) Daily habits not yet kept on the selected day
    const dISO = fmtISO(addDays(weekStart, selectedDay));
    const habitItems = (settings.habits || []).filter((h) => !habitDoneOn(h, dISO)).map((h) => ({ kind: 'habit', id: h.id }));
    const items = [...overdueItems, ...dayTasks, ...tplItems, ...poolItems, ...habitItems];
    if (!items.length) { flash(tx('Nothing to plan — all caught up.', 'لا شيء للتخطيط — كل شيء منجز.')); return; }
    setWizard({ items, idx: 0 });
  };
  const wizardNext = () => setWizard((w) => { if (!w) return null; const n = w.idx + 1; if (n >= w.items.length) { flash(tx('Day planned.', 'تم تخطيط اليوم.')); return null; } return { ...w, idx: n }; });
  // Resolve a wizard item to its live object. Items can become unresolvable
  // mid-run (e.g. the underlying task was deleted); the effect below skips them.
  const resolveWizardItem = (it) => {
    if (!it) return null;
    if (it.kind === 'template') return templates.find((tp) => tp.id === it.id) || null;
    if (it.kind === 'pool') return pool.find((p) => p.id === it.id) || null;
    if (it.kind === 'review') return (weekRef.current.tasks || []).find((tk) => tk.id === it.id) || null;
    if (it.kind === 'overdue') { const o = overdue.find((x) => x.t.id === it.id); return o ? o.t : null; }
    if (it.kind === 'habit') return settings.habits.find((h) => h.id === it.id) || null;
    return null;
  };
  // Advance past unresolvable items here, not during render.
  useEffect(() => {
    if (!wizard) return;
    if (!resolveWizardItem(wizard.items[wizard.idx])) wizardNext();
  }, [wizard, templates, pool, overdue, settings.habits]); // eslint-disable-line

  const editingTask = week.tasks.find((t) => t.id === editing) || null;
  const editingPoolItem = pool.find((p) => p.id === editingPool) || null;

  /* ---- drag & drop (pointer-based; sources: task/pool/template/subtask) ---- */
  const dragRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const dragActive = !!drag;
  // Resolve what's under the pointer: a block (and, within it, the specific task
  // being hovered so we can drop before/after it) or the backlog. Only task
  // drags get a position — pool/template drops just land in the block.
  const findTarget = (x, y) => {
    const kind = dragRef.current?.kind;
    let el = document.elementFromPoint(x, y);
    let taskEl = null;
    while (el) {
      if (el.dataset) {
        if (!taskEl && el.dataset.taskid) taskEl = el;
        if (el.dataset.dropblock) {
          if (kind === 'task' && taskEl) { const r = taskEl.getBoundingClientRect(); return { type: 'block', id: el.dataset.dropblock, taskId: taskEl.dataset.taskid, after: y > r.top + r.height / 2 }; }
          return { type: 'block', id: el.dataset.dropblock, taskId: null, after: false };
        }
        if (el.dataset.droppool != null) return { type: 'pool' };
      }
      el = el.parentElement;
    }
    return null;
  };
  const startDrag = (e, kind, item) => {
    e.preventDefault();
    const color = item.projectId ? (labelById(item.projectId)?.color || null) : null;
    const s = { kind, id: item.id, title: item.title, time: timeLabel(item) || '', color, fromBlock: item.block || null, x: e.clientX, y: e.clientY, over: null };
    dragRef.current = s; setDrag({ ...s });
  };
  useEffect(() => {
    if (!dragActive) return;
    const move = (e) => {
      e.preventDefault();
      const over = findTarget(e.clientX, e.clientY);
      dragRef.current = { ...dragRef.current, x: e.clientX, y: e.clientY, over };
      setDrag({ ...dragRef.current });
      if (e.clientY < 72) window.scrollBy(0, -14); else if (e.clientY > window.innerHeight - 72) window.scrollBy(0, 14);
    };
    const up = () => {
      const d = dragRef.current; dragRef.current = null; setDrag(null);
      if (!d || !d.over) return;
      if (d.kind === 'task') {
        if (d.over.type === 'block') {
          if (d.over.taskId && d.over.taskId !== d.id) moveTaskToPosition(d.id, d.over.id, d.over.taskId, d.over.after);
          else if (d.over.id !== d.fromBlock) moveTaskToPosition(d.id, d.over.id, null, false);
        } else if (d.over.type === 'pool') taskToPool(d.id);
      } else if (d.kind === 'pool') {
        if (d.over.type === 'block') poolToDay(d.id, selectedDay, d.over.id);
      } else if (d.kind === 'template') {
        // Templates only place onto a day block. Drag-to-backlog was removed:
        // the recurring chips live inside the combined side card, so releasing a
        // chip without leaving the card counted as a pool drop and silently
        // added it to the backlog. The explicit Inbox button covers that intent.
        if (d.over.type === 'block') templateToDay(d.id, selectedDay, d.over.id);
      }
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [dragActive, selectedDay]); // eslint-disable-line

  /* ---- tap-based placement (block chooser) ---- */
  const placeInto = (blockId) => {
    if (!placer) return;
    if (placer.kind === 'pool') poolToDay(placer.id, selectedDay, blockId);
    else if (placer.kind === 'template') templateToDay(placer.id, selectedDay, blockId);
    setPlacer(null);
  };

  /* ---- AI brain-dump parse (files into slots or the backlog) ---- */
  const runParse = async () => {
    if (!dump.trim()) return;
    // Local-only PWA: the sorter needs your own Anthropic API key, stored on-device
    // in Settings. Without one, explain rather than fail cryptically.
    if (!settings.apiKey) { setParseError(tx('The sorter needs an API key — pick a provider and add a key under Settings → Backup → AI sorting (Google Gemini has a free tier). Stored only on this device.', 'يحتاج الفرز إلى مفتاح — اختر مزوّدًا وأضف مفتاحًا من الإعدادات ← النسخ ← الفرز الذكي (لدى Google Gemini خطة مجانية). يُحفظ على هذا الجهاز فقط.')); return; }
    setParsing(true); setParseError(''); setPreview(null);
    const dayList = Array.from({ length: 7 }, (_, i) => { const d = addDays(weekStart, i); return `${i}=${wdFull(d.getDay())} ${d.getDate()} ${mon(d.getMonth())}`; }).join(', ');
    const existing = week.tasks.map((t) => `{id:"${t.id}", title:"${t.title.replace(/"/g, "'")}", day:${t.day}, block:"${t.block}"}`).join('\n');
    const labelNames = settings.labels.map((p) => p.name).join(', ');
    const todayIdx = (() => { const d = logicalDayMid(); const i = Math.round((d - weekStart) / 86400000); return i >= 0 && i <= 6 ? i : selectedDay; })();
    const blockTimes = 'fajr=before sunrise; morning=~sunrise-12:55; dhuhr=~12:55-16:30; asr=~16:30-sunset; maghrib=sunset-21:15; isha=after ~21:15';
    const system = `You sort a person's brain-dump into a prayer-time-anchored DAY planner. Return ONLY one valid JSON object, no prose, no fences.

Schema: {"operations":[ op, ... ]}
op types:
- {"type":"create_task","title":string,"day":0-6,"block":blockId,"time":string|null,"project":string|null,"subtasks":string[]|opt}
- {"type":"create_pool","title":string,"project":string|null,"subtasks":string[]|opt}   // backlog: no fixed day/time
- {"type":"add_subtask","taskId":string,"title":string}
- {"type":"add_note","taskId":string,"note":string}

Rules:
- Use create_task when a day/time is implied. Use create_pool for someday/anytime items with no clear day ("read report", "email X back", "look into Y").
- "day": 0-6 as ${dayList}. "today"=${todayIdx}. Default ${todayIdx} if a day is implied but unspecified.
- "block": one of [${BLOCKS.map((b) => b.id).join(', ')}]. By clock: ${blockTimes}.
- "time": short label e.g. "09:00","14:30-16:00", or null. 24h.
- "project": a LABEL (colored tag). Match [${labelNames || 'none'}] by name, else a short new label name, else null.
- A heading with bullets = one item with those bullets as subtasks. Keep titles tight, imperative.

Existing tasks this day (for add_subtask/add_note): ${existing || '(none)'}`;
    try {
      let res;
      try {
        if (settings.aiProvider === 'gemini') {
          // Gemini's OpenAI-compatible endpoint; free-tier keys from aistudio.google.com/apikey.
          // The "-latest" alias tracks the newest Flash-Lite so model retirements
          // (2.0-flash died 2026-03-03 and broke exactly this call) can't silently
          // return; a pinned fallback covers the alias being unavailable.
          const geminiCall = (model) => fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` }, body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'system', content: system }, { role: 'user', content: dump.trim() }] }) });
          res = await geminiCall('gemini-flash-lite-latest');
          if (res.status === 404 || res.status === 400) res = await geminiCall('gemini-2.5-flash-lite');
        } else {
          res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4096, system, messages: [{ role: 'user', content: dump.trim() }] }) });
        }
      } catch { setParseError("Can't reach the sorter — this view can't call Claude's API. Add items by hand instead."); setParsing(false); return; }
      if (res.status === 429) { setParseError(settings.aiProvider === 'gemini' ? tx('Gemini free-tier limit hit (per-minute or daily). Wait a minute and retry — daily quotas reset at midnight Pacific.', 'تم بلوغ حد Gemini المجاني (بالدقيقة أو اليومي). انتظر دقيقة وأعد المحاولة — تتجدد الحصة اليومية منتصف الليل بتوقيت المحيط الهادئ.') : tx('Rate limit hit (HTTP 429). Wait a moment and retry.', 'تم بلوغ حد المعدل (429). انتظر قليلًا وأعد المحاولة.')); setParsing(false); return; }
      if (!res.ok) { setParseError(`Sorter request failed (HTTP ${res.status}). Add items by hand instead.`); setParsing(false); return; }
      const data = await res.json();
      const text = settings.aiProvider === 'gemini'
        ? (data.choices?.[0]?.message?.content || '')
        : (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      let clean = text.replace(/```json|```/g, '').trim();
      const a = clean.indexOf('{'); const b = clean.lastIndexOf('}');
      if (a > -1 && b > a) clean = clean.slice(a, b + 1);
      const parsed = JSON.parse(clean);
      const ops = (parsed.operations || []).filter(Boolean).map((o) => ({ ...o, _keep: true, _id: uid() }));
      if (!ops.length) setParseError("Couldn't find anything to file. Try short lines.");
      else setPreview({ ops });
    } catch (e) { console.error(e); setParseError("The sorter replied, but it couldn't be read as a plan. Try shorter lines."); }
    finally { setParsing(false); }
  };
  const clampDay = (d) => { const n = d === 'today' ? selectedDay : Number(d); return Number.isInteger(n) && n >= 0 && n <= 6 ? n : selectedDay; };
  const validBlock = (b) => (BLOCKS.some((x) => x.id === b) ? b : 'morning');
  const applyPreview = async () => {
    let labels = settings.labels;
    const newTasks = [...weekRef.current.tasks];
    const newPool = [...poolRef.current];
    const findTask = (id) => newTasks.find((t) => t.id === id);
    preview.ops.filter((o) => o._keep).forEach((o) => {
      if (o.type === 'create_task') {
        const r = ensureLabel(o.project, labels); labels = r.labels;
        newTasks.push({ id: uid(), title: o.title, day: clampDay(o.day), block: validBlock(o.block), projectId: r.id, time: o.time || '', start: (() => { const rr = parseRange(o.time); return rr ? mm2(rr.start) : ''; })(), end: (() => { const rr = parseRange(o.time); return rr && rr.end != null ? mm2(rr.end) : ''; })(), done: false, subtasks: mkSubs(o.subtasks), notes: o.note ? [{ id: uid(), type: 'text', content: o.note }] : [], order: timeOrder(o.time) + 0.5 });
      } else if (o.type === 'create_pool') {
        const r = ensureLabel(o.project, labels); labels = r.labels;
        newPool.push({ id: uid(), title: o.title, projectId: r.id, subtasks: mkSubs(o.subtasks), notes: [], order: Date.now() });
      } else if (o.type === 'add_subtask') { const t = findTask(o.taskId); if (t) t.subtasks = [...t.subtasks, { id: uid(), title: o.title, done: false }]; }
      else if (o.type === 'add_note') { const t = findTask(o.taskId); if (t) t.notes = [...t.notes, { id: uid(), type: 'text', content: o.note }]; }
    });
    persistWeek({ ...weekRef.current, tasks: newTasks });
    persistPool(newPool);
    if (labels !== settings.labels) persistSettings({ ...settings, labels });
    setPreview(null); setDump('');
    flash(tx('Filed.', 'تم الحفظ.'));
  };

  /* ---- navigation ---- */
  const navMinA = startOfWeek(windowBounds().start, settings.weekStartDay);
  const navMinB = addDays(startOfWeek(new Date(), settings.weekStartDay), -28);
  const navMin = navMinA < navMinB ? navMinA : navMinB;
  const navMax = startOfWeek(windowBounds().end, settings.weekStartDay);
  const shiftWeek = (n) => setWeekStart((w) => { let nw = addDays(w, n * 7); if (nw < navMin) nw = navMin; if (nw > navMax) nw = navMax; return nw; });
  const canPrev = weekStart > navMin;
  const canNext = weekStart < navMax;
  const goToday = () => { const today = logicalDayMid(); const ws = startOfWeek(today, settings.weekStartDay); setWeekStart(ws); setSelectedDay(Math.max(0, Math.min(6, Math.round((today - ws) / 86400000)))); };
  const rangeLabel = () => { const end = addDays(weekStart, 6); return `${mon(weekStart.getMonth())} ${weekStart.getDate()} – ${mon(end.getMonth())} ${end.getDate()}`; };
  const dayMeta = (i) => { const d = addDays(weekStart, i); const dt = week.tasks.filter((t) => t.day === i); return { date: d, label: wd(d.getDay()), num: d.getDate(), total: dt.length, done: dt.filter((t) => t.done).length, isToday: sameDay(d, logicalDayMid()) }; };

  if (!ready) {
    return (<div style={{ minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B6878' }}><Loader2 size={18} className="spin" style={{ marginRight: 8 }} /> Loading your day…</div>);
  }

  /* ---- "right now" derivation ---- */
  const now = new Date();
  const curMin = now.getHours() * 60 + now.getMinutes();
  const activeId = activeBlockAt(todayTimings, curMin);
  const activeBlock = blockById(activeId);
  const fajrMin = minutesOf(todayTimings.Fajr);
  // The day runs Fajr → next Fajr, so `todayMid` is the current logical day
  // (already the previous date during the pre-dawn hours). `beforeFajr` is kept
  // only for the few UI notes that phrase things around the night crossover.
  const beforeFajr = fajrMin != null && curMin < fajrMin;
  const todayMid = logicalDayMid();
  const todayInView = sameDay(addDays(weekStart, Math.round((todayMid - weekStart) / 86400000)), todayMid) && Math.round((todayMid - weekStart) / 86400000) >= 0 && Math.round((todayMid - weekStart) / 86400000) <= 6;
  const todayCol = todayInView ? Math.round((todayMid - weekStart) / 86400000) : Math.round((todayMid - startOfWeek(todayMid, settings.weekStartDay)) / 86400000);
  const nowSrc = todayInView ? week.tasks : (todayData?.tasks || []);
  const nowDayCol = todayCol;
  const todayTasks = nowDayCol >= 0 ? nowSrc.filter((t) => t.day === nowDayCol) : [];
  // The Now queue mirrors the Plan page EXACTLY: every task from the START of the
  // day (all blocks — not just the current prayer period, so nothing left behind
  // earlier in the day gets skipped), ordered by block top-to-bottom then the
  // manual within-block order (same key as tasksFor). One item is surfaced at a
  // time; checking it reveals the next.
  const blockIdx = (id) => BLOCKS.findIndex((b) => b.id === id);
  const nowList = todayTasks.slice().sort((a, b) => (blockIdx(a.block) - blockIdx(b.block)) || (a.done - b.done) || (a.order - b.order));
  const nowStart = cleanTime(todayTimings[activeBlock.startKey]) || '';
  const nowEnd = activeBlock.endKey ? cleanTime(todayTimings[activeBlock.endKey]) || '' : '';
  const clockLabel = `${((now.getHours() + 11) % 12) + 1}:${pad(now.getMinutes())} ${now.getHours() < 12 ? 'AM' : 'PM'}`;
  const nowHourFloat = now.getHours() + now.getMinutes() / 60;
  const sky = skyAt(nowHourFloat);
  // Night = after Maghrib, before Sunrise (falls back to 19:00–06:00 if timings missing)
  const maghribMin = minutesOf(todayTimings.Maghrib) ?? 19 * 60;
  const sunriseMin = minutesOf(todayTimings.Sunrise) ?? 6 * 60;
  const isNight = curMin >= maghribMin || curMin < sunriseMin;
  const darkOn = settings.autoDark !== false && isNight;
  setTime24(settings.time24 === true);
  setLang(settings.lang === 'ar' ? 'ar' : 'en');
  const topLuma = 0.299 * sky.top[0] + 0.587 * sky.top[1] + 0.114 * sky.top[2];
  const heroLight = topLuma < 140; // light text once the sky behind it is dark enough to need it
  // Prayers hang on the current logical day (Fajr→Fajr), so during the pre-dawn
  // hours the gating prayer is last night's Isha — already handled by todayMid.
  const prayerDayCol = todayCol;
  const prayersToday = ((todayInView ? week : todayData)?.prayers || {})[prayerDayCol] || {};
  // Which prayer, if any, is gating the app right now.
  //  • Inside a prayer period → that prayer.
  //  • During Duha/morning (after sunrise, before Dhuhr) → still Fajr, until Fajr
  //    is marked done. This keeps the Fajr lock on until Dhuhr begins.
  let gateId = null;
  if (PRAYER_BLOCKS.includes(activeId)) gateId = activeId;
  else if (activeId === 'morning' && !prayersToday['fajr']) gateId = 'fajr';
  const gateBlock = gateId ? blockById(gateId) : activeBlock;
  const gateStart = cleanTime(todayTimings[gateBlock.startKey]) || '';
  // For the Fajr-through-Duha lock, show the window ending at Dhuhr (when it lifts).
  const gateEnd = gateId === 'fajr' && activeId === 'morning'
    ? (cleanTime(todayTimings.Dhuhr) || '')
    : (gateBlock.endKey ? cleanTime(todayTimings[gateBlock.endKey]) || '' : '');
  const gateActive = settings.prayerGate !== false && !!gateId && prayerDayCol >= 0 && !prayersToday[gateId];
  // Hard window: the first 15 minutes of a prayer's own period belong to the
  // prayer — the gate cannot be dismissed, not even by marking it done. The
  // modulo handles the overnight Isha wrap. (The Fajr-through-morning carryover
  // is long past its start by then, so it is never hard-locked.)
  const PRAYER_HARD_MIN = 15;
  const gateStartMin = gateStart ? minutesOf(gateStart) : null;
  const gateElapsed = gateStartMin == null ? null : ((curMin - gateStartMin) + 1440) % 1440;
  // Fresh-arrival lock (first 15 min of the period)…
  const gateArrivalLeft = gateElapsed != null && gateElapsed < PRAYER_HARD_MIN ? PRAYER_HARD_MIN - gateElapsed : 0;
  // …plus the unmark penalty (15 min from the moment it was unticked). nowTick in
  // the render deps makes this recompute each minute so the countdown advances.
  const gatePenaltyKey = gateId ? `${fmtISO(todayMid)}:${gateId}` : '';
  const gatePenaltyTs = gatePenaltyKey ? prayerPenaltyRef.current[gatePenaltyKey] : 0;
  const gatePenaltyLeft = gatePenaltyTs ? Math.ceil((PRAYER_HARD_MIN * 60000 - (Date.now() - gatePenaltyTs)) / 60000) : 0;
  const gateHardLeft = Math.max(gateArrivalLeft, gatePenaltyLeft > 0 ? gatePenaltyLeft : 0);
  /* ---- planning assistant (chat; proposes, never writes) ---- */
  const chatIds = () => ({ taskIds: (weekRef.current.tasks || []).map((t) => t.id), poolIds: (poolRef.current || []).map((p) => p.id) });
  const buildSnapshot = () => {
    const todayISO = fmtISO(todayMid);
    const projName = (t) => (settings.projects.find((p) => p.id === t.projectRef) || {}).name || (labelById(t.projectId) || {}).name || '';
    return buildDaySnapshot({
      dateLabel: `${wdFull(selectedDate.getDay())} ${selectedDate.getDate()} ${mon(selectedDate.getMonth())}`,
      dayIdx: selectedDay,
      dayNames: Array.from({ length: 7 }, (_, i) => wdFull(addDays(weekStart, i).getDay())),
      timings, activeBlock: activeId,
      tasks: (week.tasks || []).filter((t) => t.day === selectedDay).map((t) => ({ id: t.id, block: t.block, time: timeLabel(t), done: t.done, title: t.title, project: projName(t), subtasks: (t.subtasks || []).length })),
      pool: (pool || []).map((p) => ({ id: p.id, title: p.title, done: !!p.done })),
      habits: [...prayerHabits, ...(settings.habits || [])].map((h) => ({ name: h.name, block: h.block || 'morning', streak: habitStreak(h, todayISO), doneToday: habitDoneOn(h, todayISO), builtin: !!h.prayer })),
      prayersDone: PRAYER_BLOCKS.filter((pid) => prayersToday[pid]),
      overdue: (overdue || []).map((o) => ({ title: o.t.title, when: `${wd(o.date.getDay())} ${o.date.getDate()} ${mon(o.date.getMonth())}` })),
      projects: (settings.projects || []).map((p) => {
        const pc = projectPace(p);
        const status = p.completedAt ? 'completed' : pc.notStarted ? 'not started' : pc.onPace === true ? 'on pace' : pc.onPace === false ? 'behind' : 'in progress';
        return { name: p.name, target: p.target, done: pc.done, unit: p.unit || 'units', status, perDay: pc.perDay ? Math.ceil(pc.perDay) : null, daysLeft: pc.daysLeft };
      }),
      labels: (settings.labels || []).map((l) => l.name),
    });
  };
  const sendChat = async () => {
    const q = chatInput.trim();
    if (!q || chatBusy) return;
    if (!settings.apiKey) { setChatErr(tx('The assistant needs an API key — add one under Settings → Backup → AI sorting (Gemini has a free tier).', 'يحتاج المساعد إلى مفتاح — أضفه من الإعدادات ← النسخ ← الفرز الذكي (لدى Gemini خطة مجانية).')); return; }
    setChatErr(''); setChatBusy(true);
    const prior = chatMsgs.slice(-6).map((m) => ({ role: m.role, content: m.text }));
    setChatMsgs((prev) => [...prev, { role: 'user', text: q }]);
    setChatInput('');
    try {
      const messages = [...prior, { role: 'user', content: `Current state of my planner:\n\n${buildSnapshot()}\n\n---\n${q}` }];
      const text = await callAssistant({ provider: settings.aiProvider || 'anthropic', apiKey: settings.apiKey, system: ASSISTANT_SYSTEM, messages });
      const { reply, proposals } = parseAssistantReply(text, chatIds());
      setChatMsgs((prev) => [...prev, { role: 'assistant', text: reply, proposals, applied: {} }]);
    } catch (e) {
      setChatErr(e.code === 'rate'
        ? tx('Rate limit hit — wait a moment and try again.', 'تم بلوغ حد المعدل — انتظر قليلًا وأعد المحاولة.')
        : tx(`Assistant unavailable (${e.message || e}).`, `المساعد غير متاح (${e.message || e}).`));
    }
    setChatBusy(false);
  };
  // Applying is always a deliberate, per-proposal act by the person.
  const applyProposal = (msgIdx, pIdx) => {
    const p = chatMsgs[msgIdx]?.proposals?.[pIdx]; if (!p) return;
    if (p.kind === 'add_task') addTask(p.day, p.block, p.title, { start: p.start || '', end: p.end || '' });
    else if (p.kind === 'move_task') mutateTask(p.taskId, (t) => ({ ...t, day: p.day, block: p.block }));
    else if (p.kind === 'complete_task') mutateTask(p.taskId, (t) => ({ ...t, done: true }));
    else if (p.kind === 'task_to_backlog') taskToPool(p.taskId);
    else if (p.kind === 'backlog_to_day') poolToDay(p.poolId, p.day, p.block);
    setChatMsgs((prev) => prev.map((m, i) => (i === msgIdx ? { ...m, applied: { ...(m.applied || {}), [pIdx]: 'done' } } : m)));
    flash(tx('Applied.', 'تم التطبيق.'));
  };
  const dismissProposal = (msgIdx, pIdx) => setChatMsgs((prev) => prev.map((m, i) => (i === msgIdx ? { ...m, applied: { ...(m.applied || {}), [pIdx]: 'skip' } } : m)));
  const describeProposal = (p) => {
    const bn = (id) => bName(blockById(id));
    const dn = (d) => wdFull(addDays(weekStart, d).getDay());
    const tTitle = (id) => ((weekRef.current.tasks || []).find((t) => t.id === id) || {}).title || '?';
    const pTitle = (id) => ((poolRef.current || []).find((x) => x.id === id) || {}).title || '?';
    switch (p.kind) {
      case 'add_task': return `${tx('Add', 'أضف')} “${p.title}” → ${dn(p.day)} · ${bn(p.block)}${p.start ? ` · ${fmtTime(p.start)}` : ''}`;
      case 'move_task': return `${tx('Move', 'انقل')} “${tTitle(p.taskId)}” → ${dn(p.day)} · ${bn(p.block)}`;
      case 'complete_task': return `${tx('Mark done', 'علّم كمنجز')}: “${tTitle(p.taskId)}”`;
      case 'task_to_backlog': return `${tx('To backlog', 'إلى قائمة الانتظار')}: “${tTitle(p.taskId)}”`;
      case 'backlog_to_day': return `${tx('Schedule', 'جدولة')} “${pTitle(p.poolId)}” → ${dn(p.day)} · ${bn(p.block)}`;
      default: return p.kind;
    }
  };

  const confirmOath = () => {
    if (!isOath(oathText)) return; // belt and braces: the button is disabled too
    togglePrayer(gateId, todayMid);
    setOathText('');
  };
  const gateHard = gateActive && gateHardLeft > 0;
  const usedTpl = {}; week.tasks.forEach((t) => { if (t.day === selectedDay && t.templateId) usedTpl[t.templateId] = (usedTpl[t.templateId] || 0) + 1; });
  const isSelectedToday = sameDay(selectedDate, todayMid);
  // Prayers as built-in habits: derived views over the existing prayer log, so
  // marking a prayer at the gate and ticking it here are the same action. Not
  // stored in settings.habits — no duplicate state to drift.
  const prayerDoneOn = (blockId, iso) => {
    const d = parseISO(iso); const ws = startOfWeek(d, settings.weekStartDay);
    const wk = weeksRef.current[fmtISO(ws)];
    if (!wk || !wk.prayers) return false;
    const dIdx = Math.round((d - ws) / 86400000);
    return !!(wk.prayers[dIdx] && wk.prayers[dIdx][blockId]);
  };
  const prayerHabits = PRAYER_BLOCKS.map((pid) => {
    const b = blockById(pid);
    const log = {};
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    for (let i = 0; i < 366; i++) { const iso = fmtISO(addDays(today0, -i)); if (prayerDoneOn(pid, iso)) log[iso] = 1; }
    return { id: `prayer:${pid}`, name: tx(`${b.name} prayer`, `صلاة ${b.ar}`), color: b.accentDeep || '#3E8A6C', block: pid, prayer: true, createdAt: '', log };
  });
  const toggleAnyHabitDay = (id, iso) => {
    if (String(id).startsWith('prayer:')) { togglePrayer(id.slice(7), parseISO(iso)); return; }
    toggleHabitDay(id, iso);
  };
  // Overdue habits: the current logical day only — habits (including built-in
  // prayers) whose period has fully passed without being kept. In the pre-dawn
  // wind-down we don't nag (the day is ending, not begun). Plain computation,
  // deliberately not a hook (below an early return).
  const overdueHabits = (() => {
    if (beforeFajr) return [];
    const activeIdx = BLOCKS.findIndex((b) => b.id === activeId);
    const todayISO = fmtISO(todayMid);
    const out = [];
    for (const h of [...prayerHabits, ...(settings.habits || [])]) {
      const idx = BLOCKS.findIndex((b) => b.id === (h.block || 'morning'));
      if (idx < 0 || idx >= activeIdx) continue; // period still ahead or current
      if (!habitDoneOn(h, todayISO)) out.push({ h, iso: todayISO, date: todayMid });
    }
    return out;
  })();
  // ISO of the current logical day, used by the Now habit/prayer items.
  const nowHabitISO = fmtISO(todayMid);

  const poolDragActive = drag && (drag.kind === 'task');
  // Strings rendered inside item-map callbacks (where the map's item variable is
  // also named `t` and shadows the translator) are precomputed here.
  const tr = {
    now: tx('now', 'الآن'),
    done: tx('done', 'منجز'),
    task: tx('task', 'مهمة'), tasks: tx('tasks', 'مهام'),
    steps: (n) => tx(`${n} step${n > 1 ? 's' : ''}`, `${n} خطوة`),
    overdue: tx('overdue', 'متأخرة'),
  };
  return (
    <div className={`rhythm ${darkOn ? 'dark' : ''}`} dir={isRTL() ? 'rtl' : 'ltr'} lang={LANG}>

      <div className="page-bg" style={{ background: `linear-gradient(180deg, ${rgbaStr(sky.top, darkOn ? 0.5 : 0.42)}, ${darkOn ? '#0D1219' : '#EAF1EC'} 32vh)` }} aria-hidden="true" />
      <div className="page-decor" aria-hidden="true">
        {stars.map((s, i) => (<span key={`pd-s${i}`} className="star deco-star" style={{ left: `${s.x}%`, top: `${s.y}vh`, opacity: sky.night * s.base, animationDuration: `${s.tw}s`, animationDelay: `${s.dl}s` }} />))}
        {birds.map((b, i) => (
          <svg key={`pd-b${i}`} className="page-bird" style={{ left: `${b.x}%`, top: `${b.y}vh`, width: 15 * b.scale, opacity: Math.max(0, 1 - sky.night * 2.4) * 0.5, animationDelay: `${b.dl}s` }} viewBox="0 0 24 12">
            <path d="M0 8 Q6 0 12 8 Q18 0 24 8" stroke="currentColor" strokeWidth="1.6" fill="none" />
          </svg>
        ))}
      </div>
      <header className="hdr">
        <div className="brand">
          <AppIcon size={36} />
          <div className="brand-en"><strong>Rhythm <span className="ver-tag">v{APP_VERSION}</span></strong><span>{tx('plan your day around the day', 'خطّط يومك حول اليوم')}</span></div>
        </div>
        <div className="hdr-actions">
          <button className="icon today-jump" onClick={() => { goToday(); setView('plan'); }} aria-label={tx('Jump to today', 'انتقل إلى اليوم')} title={tx('Jump to today', 'انتقل إلى اليوم')}><Calendar size={16} /><span>{tx('Today', 'اليوم')}</span></button>
          <button className="icon lang-toggle" onClick={() => changeLang(LANG === 'ar' ? 'en' : 'ar')} aria-label={tx('Switch language', 'تبديل اللغة')} title={tx('Switch language', 'تبديل اللغة')}><Languages size={17} /><span>{LANG === 'ar' ? 'EN' : 'ع'}</span></button>
          <button className="icon" onClick={() => setChatOpen(true)} aria-label={tx('Planning assistant', 'مساعد التخطيط')} title={tx('Planning assistant', 'مساعد التخطيط')}><Sparkles size={17} /></button>
          <button className="icon" onClick={() => setShowSettings(true)} aria-label={tx('Settings', 'الإعدادات')}><Settings size={18} /></button>
        </div>
      </header>

      {!storageOk && (
        <div className="warn"><AlertCircle size={15} /><span>{tx("This device isn't saving between sessions. Your plan lives only in this view — export it from Settings to keep it.", 'هذا الجهاز لا يحفظ بين الجلسات. خطتك موجودة في هذا العرض فقط — صدّرها من الإعدادات للاحتفاظ بها.')}</span></div>
      )}

      {/* NOW — one thing at a time. The queue is the WHOLE day (Fajr → next
          Fajr), every block top-to-bottom in exact Plan order, with prayers,
          habits and task subtasks folded in. Nothing earlier in the day gets
          skipped: the next unchecked item is surfaced alone, and checking it
          reveals the one after. */}
      {view === 'now' && (() => {
        const activeIdx = blockIdx(activeId);
        const habitsOf = (bid) => (settings.habits || []).filter((h) => (h.block || 'morning') === bid);
        // A task with BOTH a start and an end is a commitment to a slot, not a
        // queue item: while the clock sits inside its window it surfaces on its
        // own, wherever it happens to fall in the order. Outside that window it
        // rejoins the queue so it can't quietly disappear.
        const liveNow = nowList.filter((t) => {
          if (t.done) return false;
          const st = tStartMin(t), en = tEndMin(t);
          return st != null && en != null && inWindow(st, en, curMin);
        });
        const liveIds = new Set(liveNow.map((t) => t.id));
        const queue = [];
        for (const b of BLOCKS) {
          if (PRAYER_BLOCKS.includes(b.id) && blockIdx(b.id) <= activeIdx && !prayersToday[b.id]) queue.push({ kind: 'prayer', block: b });
          for (const h of habitsOf(b.id)) if (!habitDoneOn(h, nowHabitISO)) queue.push({ kind: 'habit', block: b, h });
          for (const t of nowList.filter((t) => t.block === b.id && !t.done && !liveIds.has(t.id))) queue.push({ kind: 'task', block: b, t });
        }
        const startedPrayers = PRAYER_BLOCKS.filter((pid) => blockIdx(pid) <= activeIdx).length;
        const totalN = nowList.length + (settings.habits || []).length + startedPrayers;
        const doneN = totalN - queue.length - liveNow.length;
        const next = queue[0] || null;
        // Everything up to and through the current period is clear when the head
        // of the queue belongs to a LATER block. Then it stops being "do this
        // now" and becomes a look-ahead under Next, until its period arrives.
        const nextIsLater = !!next && blockIdx(next.block.id) > activeIdx;
        const caughtUp = nextIsLater && liveNow.length === 0;
        // A key that changes whenever an item changes, so React mounts a fresh
        // node and the enter animation runs.
        const itemKeyOf = (it) => {
          if (!it) return 'none';
          if (it.kind === 'prayer') return `p:${it.block.id}`;
          if (it.kind === 'habit') return `h:${it.h.id}`;
          const s = (it.t.subtasks || []).find((x) => !x.done);
          return `t:${it.t.id}:${s ? s.id : 'main'}`;
        };
        const renderCard = (it, { preview = false, live = false } = {}) => {
          const k = itemKeyOf(it);
          const cls = `${preview ? 'preview' : ''} ${live ? 'live' : ''} ${nowLeaving === k ? 'leaving' : ''}`;
          if (it.kind === 'prayer') return (
            <div key={k} className={`now-one-card now-item current ${cls}`}>
              {todayInView
                ? <button className="tcheck big" onClick={() => advanceNow(k, () => togglePrayer(it.block.id, todayMid))} aria-label={tx('Mark prayer performed', 'تم أداء الصلاة')}><Circle size={22} /></button>
                : <span className="now-dot" style={{ background: 'var(--verdigris)' }} />}
              <div className="now-col"><span className="now-item-title">{tx(`${it.block.name} prayer`, `صلاة ${it.block.ar}`)}</span></div>
            </div>
          );
          if (it.kind === 'habit') return (
            <div key={k} className={`now-one-card ${cls}`}>
              <HabitLine h={it.h} iso={nowHabitISO} onToggle={(id, iso) => advanceNow(k, () => toggleHabitDay(id, iso))} />
            </div>
          );
          const t = it.t;
          const tSubs = t.subtasks || [];
          const sub = tSubs.find((s) => !s.done) || null;
          const nDone = tSubs.filter((s) => s.done).length;
          const open = () => { if (todayInView) setEditing(t.id); else goToday(); };
          return (
            <div key={k} className={`now-one-card now-item current ${cls}`}>
              {todayInView
                ? <button className="tcheck big" onClick={() => advanceNow(k, () => (sub ? toggleSub(t.id, sub.id) : toggleDone(t.id)))} aria-label={sub ? tx('Mark step done', 'إنجاز الخطوة') : tx('Mark done', 'إنجاز')}><Circle size={22} /></button>
                : <span className="now-dot" style={{ background: 'var(--verdigris)' }} />}
              <div className="now-col">
                {sub ? (
                  <>
                    <button className="now-one-ctx" onClick={open}>
                      <span>{t.title}</span>
                      {timeLabel(t) ? <span className="ttime">{timeLabel(t)}</span> : null}
                      <span className="now-step-count">{nDone}/{tSubs.length} {tx('steps', 'خطوات')}</span>
                    </button>
                    <span className="now-item-title">{sub.title}</span>
                  </>
                ) : (
                  <button className="now-item-main" onClick={open}>
                    <span className="now-item-title">{t.title}</span>
                    {timeLabel(t) ? <span className="ttime">{timeLabel(t)}</span> : null}
                    {tSubs.length > 0 ? <span className="now-step-count">{nDone}/{tSubs.length} {tx('steps', 'خطوات')}</span> : null}
                  </button>
                )}
              </div>
            </div>
          );
        };
        return (
        <div className="hero-card">
          <SkyScene sky={sky} stars={stars} light={heroLight}
            label={tx('Right now', 'الآن')} time={clockLabel}
            blockName={bName(activeBlock)} blockAr={bSub(activeBlock)}
            range={`${nowStart ? `${fmtTime(nowStart)}${nowEnd ? `–${fmtTime(nowEnd)}` : '+'}` : ''}${totalN ? ` · ${doneN}/${totalN} ${tr.done}` : ''}`} />
          <div className="hero-sheet">
            {/* Scheduled slots that own the clock right now — outside the queue. */}
            {liveNow.length > 0 && (
              <div className="now-one now-live">
                <div className="now-one-top">
                  <span className="now-one-label">{tx('Happening now', 'يحدث الآن')}</span>
                  <span className="now-one-block live-tag">{tx('scheduled', 'مجدولة')}</span>
                </div>
                {liveNow.map((t) => renderCard({ kind: 'task', block: blockById(t.block), t }, { live: true }))}
              </div>
            )}
            {nextIsLater ? (
              <div className="now-one">
                {caughtUp && <div className="now-caught"><CheckCircle2 size={18} /> {tx("You're all caught up.", 'أنجزت كل ما عليك الآن.')}</div>}
                <div className="now-one-top">
                  <span className="now-one-label">{tx('Next', 'التالي')}{` · ${tx('when', 'عند')} ${bName(next.block)}`}</span>
                  <span className="now-one-block" style={{ color: next.block.accentDeep }}>{bName(next.block)}</span>
                </div>
                {renderCard(next, { preview: true })}
              </div>
            ) : next ? (
              <div className="now-one">
                <div className="now-one-top">
                  <span className="now-one-label">{tx('One thing at a time', 'شيء واحد في كل مرة')}{queue.length > 1 ? ` · ${queue.length - 1} ${tx('more today', 'أخرى اليوم')}` : ''}</span>
                  <span className="now-one-block" style={{ color: next.block.accentDeep }}>{bName(next.block)}</span>
                </div>
                {renderCard(next)}
              </div>
            ) : liveNow.length > 0 ? null
              : totalN > 0 ? (
                <div className="now-empty all-done"><CheckCircle2 size={22} /> {tx('All done for today. Rest easy.', 'أنجزت كل شيء اليوم. ارتَح.')}</div>
              ) : (
                <div className="now-empty">{tx('Nothing scheduled today.', 'لا شيء مجدول اليوم.')} {bHint(activeBlock)}.</div>
              )}
            {!todayInView && <button className="now-jump" onClick={goToday}>{tx('Jump to today', 'انتقل إلى اليوم')}</button>}
          </div>
        </div>
        );
      })()}

      {/* OVERDUE */}
      {view === 'overdue' && (
        <div className="hero-card">
          <SkyScene sky={sky} stars={stars} light={heroLight}
            label={tx('Overdue', 'المتأخرات')} time={String(overdue.length + overdueHabits.length)}
            blockName={(overdue.length + overdueHabits.length) === 1 ? tx('item needs attention', 'عنصر يحتاج انتباهك') : tx('items need attention', 'عناصر تحتاج انتباهك')} blockAr=""
            range={overdue.length ? `${tx('oldest', 'الأقدم')} — ${wd(overdue[0].date.getDay())} ${overdue[0].date.getDate()} ${mon(overdue[0].date.getMonth())}` : overdueHabits.length ? `${overdueHabits.length} ${tx('missed habits', 'عادات فائتة')}` : tx("you're all caught up", 'أنجزت كل شيء')} />
          <div className="hero-sheet">
            {overdue.length === 0 && overdueHabits.length === 0 ? (<div className="overdue-empty"><CheckCircle2 size={26} /><p>{tx("Nothing overdue. You're on top of it.", 'لا متأخرات. أنت متحكّم في الأمور.')}</p></div>) : (<>
            {overdue.length === 0 ? null : (<>
              <div className="od-bar">
                <span className="od-bar-count">{overdue.length} {tr.overdue}</span>
                <div className="od-bar-actions">
                  <button className="ghost sm" onClick={completeAllOverdue} disabled={odBusy}><CheckCircle2 size={14} /> {tx('Complete all', 'إنجاز الكل')}</button>
                  {confirmDelete ? (<span className="od-confirm">{tx('Delete all?', 'حذف الكل؟')}<button className="danger sm" onClick={deleteAllOverdue} disabled={odBusy}>{tx('Yes', 'نعم')}</button><button className="ghost sm" onClick={() => setConfirmDelete(false)} disabled={odBusy}>{tx('Cancel', 'إلغاء')}</button></span>) : (<button className="danger sm" onClick={() => setConfirmDelete(true)} disabled={odBusy}><Trash2 size={14} /> {tx('Delete all', 'حذف الكل')}</button>)}
                </div>
              </div>
              <ul className="od-list">{overdue.map((it) => { const p = labelById(it.t.projectId); const b = blockById(it.t.block); return (
                <li key={it.t.id} className="od-item">
                  <button className="tcheck" style={{ color: '#B23A3A' }} onClick={() => completeOverdue(it)} aria-label="Mark done"><Circle size={18} /></button>
                  <div className="od-col">
                    <button className="od-main" onClick={() => editOverdue(it)}>
                      <span className="od-title">{it.t.title}{timeLabel(it.t) ? <span className="ttime">{timeLabel(it.t)}</span> : null}</span>
                      <span className="od-meta"><span className="od-date">{wd(it.date.getDay())} {it.date.getDate()} {mon(it.date.getMonth())}</span><span className="od-block" style={{ color: b.accentDeep }}>{bName(b)}</span>{p && <span className="pdot" style={{ background: p.color }} />}{p && <span className="pname">{p.name}</span>}</span>
                    </button>
                    {it.t.subtasks && it.t.subtasks.length > 0 && (
                      <button className="subs-fold" onClick={() => toggleFoldTask(it.t.id)} aria-expanded={!foldedTasks.has(it.t.id)}>
                        <ChevronDown size={13} style={{ transform: foldedTasks.has(it.t.id) ? 'rotate(-90deg)' : 'none' }} />
                        {it.t.subtasks.filter((s) => s.done).length}/{it.t.subtasks.length} {tx('steps', 'خطوات')}
                      </button>
                    )}
                    {it.t.subtasks && it.t.subtasks.length > 0 && !foldedTasks.has(it.t.id) && (
                      <ul className="subs">{it.t.subtasks.map((sub) => (
                        <li key={sub.id} className={`sub ${sub.done ? 'done' : ''}`}><span className="sub-bullet" /><span>{sub.title}</span></li>
                      ))}</ul>
                    )}
                  </div>
                  <button className="od-edit" onClick={() => editOverdue(it)} aria-label={tx('Edit', 'تعديل')} title={tx('Edit', 'تعديل')}><Settings size={15} /></button>
                </li>); })}</ul>
            </>)}
            {overdueHabits.length > 0 && (
              <div className="od-habits">
                <div className="od-habits-h"><Flame size={13} /> {tx('Missed habits', 'عادات فائتة')} <span className="proj-rollup">{overdueHabits.length}</span></div>
                <ul className="od-list">{overdueHabits.map(({ h, iso, date }) => (
                  <li key={h.id + iso} className="od-item">
                    <button className="tcheck" style={{ color: '#B23A3A' }} onClick={() => toggleAnyHabitDay(h.id, iso)} aria-label={tx('Mark kept', 'تم الالتزام')}><Circle size={18} /></button>
                    <div className="od-col">
                      <span className="od-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><FlameGlyph level={glowLevel(habitStreak(h, iso))} size={12} /> {h.name}</span>
                      <span className="od-meta"><span className="od-date">{wd(date.getDay())} {date.getDate()} {mon(date.getMonth())}</span><span className="od-block" style={{ color: blockById(h.block || 'morning').accentDeep }}>{bName(blockById(h.block || 'morning'))}</span></span>
                    </div>
                  </li>
                ))}</ul>
              </div>
            )}
            </>)}
          </div>
        </div>
      )}

      {/* PLAN */}
      {view === 'plan' && (
        <div className="hero-card wide">
          <SkyScene sky={sky} stars={stars} light={heroLight}
            label={tx('Planning', 'التخطيط')} time={String(selectedDate.getDate())}
            blockName={wdFull(selectedDate.getDay())} blockAr=""
            range={`${mon(selectedDate.getMonth())} · ${week.tasks.filter((t) => t.day === selectedDay).length} ${week.tasks.filter((t) => t.day === selectedDay).length !== 1 ? tr.tasks : tr.task}${usingFallback ? ` · ${tx('prayer times estimated', 'مواقيت تقديرية')}` : ''}`} />
          <div className="hero-sheet">
        <div className="wknav plan-nav">
          <button className="icon" onClick={() => shiftWeek(-1)} disabled={!canPrev} aria-label="Previous week">{isRTL() ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}</button>
          <button className="today-btn" onClick={goToday}>{rangeLabel()}</button>
          <button className="icon" onClick={() => shiftWeek(1)} disabled={!canNext} aria-label="Next week">{isRTL() ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}</button>
        </div>

        <div className="strip">
          {Array.from({ length: 7 }, (_, i) => dayMeta(i)).map((m, i) => (
            <button key={i} className={`chip ${i === selectedDay ? 'sel' : ''} ${m.isToday ? 'today' : ''}`} onClick={() => setSelectedDay(i)}>
              <span className="chip-d">{m.label}</span><span className="chip-n">{m.num}</span>{m.total > 0 && <span className="chip-count">{m.done}/{m.total}</span>}
            </button>
          ))}
        </div>

        <button className="plan-day-btn" onClick={startWizard}><Sparkles size={15} /> {tx('Plan the day', 'خطّط اليوم')}</button>

        {/* Day timeline (left) + Recurring/Backlog sidebar (right) — kept side by side so both stay visible as drop targets while dragging */}
        <div className="plan-columns">
          <div className="timeline">
            {BLOCKS.map((b) => (
              <BlockRow key={b.id} block={b}
                start={cleanTime(timings[b.startKey]) || ''} end={b.endKey ? cleanTime(timings[b.endKey]) || '' : ''}
                tasks={tasksFor(selectedDay, b.id)} labelById={labelById}
                habits={settings.habits.filter((h) => (h.block || 'morning') === b.id)}
                habitDate={fmtISO(selectedDate)} onToggleHabit={toggleHabitDay}
                current={isSelectedToday && b.id === activeId}
                prayer={isSelectedToday && PRAYER_BLOCKS.includes(b.id) ? { done: !!(week.prayers?.[selectedDay]?.[b.id]) } : null}
                onPrayer={() => togglePrayer(b.id, selectedDate)}
                onToggle={toggleDone} onToggleSub={toggleSub} onOpen={setEditing}
                onAdd={(title) => addTask(selectedDay, b.id, title)}
                onDragStart={startDrag}
                dragActive={dragActive} dragOver={drag && drag.over && drag.over.type === 'block' && drag.over.id === b.id}
                draggingId={drag && drag.kind === 'task' ? drag.id : null}
                over={drag && drag.over ? drag.over : null} />
            ))}
          </div>
          <aside className="plan-side">
            <PlanSide
              tab={sideTab} onTab={setSideTab}
              open={sideOpen} onToggleOpen={() => setSideOpen((v) => !v)}
              templates={templates} pool={pool} labelById={labelById} usedTpl={usedTpl}
              onDragStart={startDrag}
              onTplToPool={templateToPool}
              onTplToDay={(id) => setPlacer({ kind: 'template', id })}
              onAddTpl={() => addTemplate({ title: tx('New recurring task', 'مهمة متكررة جديدة'), block: 'morning', subtasks: [] })}
              onManage={() => setShowSettings(true)}
              onAddPool={(title) => addPoolItem(title)}
              onOpenPool={setEditingPool}
              onEditTpl={setEditingTpl}
              onTogglePoolDone={togglePoolDone}
              onPoolToDay={(id) => setPlacer({ kind: 'pool', id })}
              poolDropActive={poolDragActive} poolDropOver={drag && drag.over && drag.over.type === 'pool'}
            />
          </aside>
        </div>

        {/* Brain dump */}
        <section className="dump-card">
          <div className="dump-head" onClick={() => setDumpOpen((v) => !v)}>
            <Sparkles size={15} /><span>{tx('Brain dump — filed into slots or your backlog', 'تفريغ الأفكار — تُصنّف في المواعيد أو قائمة الانتظار')}</span>
            <ChevronRight size={16} className="pool-caret" style={{ transform: dumpOpen ? 'rotate(90deg)' : 'none' }} />
          </div>
          {dumpOpen && (<>
          <textarea className="dump-input" rows={3} value={dump} onChange={(e) => setDump(e.target.value)}
            placeholder={tx(`e.g.\nCall the CBE press office tomorrow morning\nQ3 banking feature — chase Mamoun for the Wego numbers\nRead the IMF Egypt note (someday)`, `مثال:\nاتصل بالمكتب الصحفي للبنك المركزي غدًا صباحًا\nملف مصرفي للربع الثالث — تابع مأمون بشأن أرقام Wego\nاقرأ مذكرة صندوق النقد عن مصر (لاحقًا)`)} />
          <div className="dump-actions">
            {parseError && <span className="err"><AlertCircle size={13} /> {parseError}</span>}
            <button className="primary" disabled={parsing || !dump.trim()} onClick={runParse}>{parsing ? <><Loader2 size={15} className="spin" /> {tx('Sorting…', 'جارٍ الفرز…')}</> : <><Sparkles size={15} /> {tx('Sort it', 'افرزها')}</>}</button>
          </div>
          {preview && (
            <div className="preview">
              <div className="preview-head">{tx("Here's where this goes — uncheck anything you don't want:", 'إليك أين ستذهب — أزِل التحديد عن أي شيء لا تريده:')}</div>
              <ul className="preview-list">{preview.ops.map((o) => (
                <li key={o._id} className={o._keep ? '' : 'off'}>
                  <button className="pcheck" onClick={() => setPreview({ ops: preview.ops.map((x) => x._id === o._id ? { ...x, _keep: !x._keep } : x) })}>{o._keep ? <CheckCircle2 size={17} /> : <Circle size={17} />}</button>
                  <span className="ptext">{describeOp(o, week.tasks, weekStart, selectedDay)}</span>
                </li>
              ))}</ul>
              <div className="preview-actions"><button className="ghost" onClick={() => setPreview(null)}>{tx('Discard', 'تجاهل')}</button><button className="primary" onClick={applyPreview}>{tx('Apply', 'تطبيق')} {preview.ops.filter((o) => o._keep).length}</button></div>
            </div>
          )}
          </>)}
        </section>
          </div>
        </div>
      )}

      {/* PROJECTS (long-term) */}
      {view === 'projects' && (
        <ProjectsView
          projects={settings.projects}
          sky={sky} stars={stars} heroLight={heroLight}
          onAdd={addProjectItem} onUpd={updProjectItem} onDel={delProjectItem}
          onLog={logProgress} taskList={projectTaskList}
          onToggleTask={toggleProjectTask} onOpenTask={openProjectTask}
        />
      )}

      {/* HABITS */}
      {view === 'habits' && (
        <HabitsView
          habits={[...prayerHabits, ...settings.habits]} sky={sky} stars={stars} heroLight={heroLight}
          onAdd={addHabit} onUpd={updHabit} onDel={delHabit} onToggleDay={toggleAnyHabitDay}
          onFocus={(h, mins) => startFocus({ id: h.id, title: h.name }, mins)}
        />
      )}

      {/* Block chooser (tap-to-place) */}
      {placer && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setPlacer(null); }}>
          <div className="chooser">
            <div className="chooser-head"><span>{tx('Add to', 'أضف إلى')} {wdFull(selectedDate.getDay())} {selectedDate.getDate()} {mon(selectedDate.getMonth())}</span><button className="icon" onClick={() => setPlacer(null)}><X size={16} /></button></div>
            <div className="chooser-grid">
              {BLOCKS.map((b) => (
                <button key={b.id} className="chooser-block" style={{ '--accent': b.accent, '--tint': b.tint }} onClick={() => placeInto(b.id)}>
                  <span className="cb-en">{bName(b)}</span><span className="cb-ar">{bSub(b)}</span>
                  <span className="cb-time">{cleanTime(timings[b.startKey])}{b.endKey ? `–${cleanTime(timings[b.endKey])}` : '+'}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {editingTask && (
        <TaskEditor task={editingTask} projects={settings.labels} allProjects={settings.projects} weekStart={weekStart}
          dateISO={fmtISO(addDays(weekStart, editingTask.day))}
          onMoveDate={(iso) => moveTaskToDate(editingTask.id, iso)}
          onClose={() => setEditing(null)} onChange={(fn) => mutateTask(editingTask.id, fn)}
          onDelete={() => removeTask(editingTask.id)} onToPool={() => { taskToPool(editingTask.id); setEditing(null); }}
          onSaveTemplate={() => { addTemplate({ title: editingTask.title, block: editingTask.block, time: editingTask.time, projectId: editingTask.projectId, subtasks: editingTask.subtasks.map((s) => s.title) }); flash(tx('Saved as a recurring task.', 'حُفظت كمهمة متكررة.')); }}
          onFocus={(mins, untilEnd) => { startFocus(editingTask, mins, untilEnd); setEditing(null); }} />
      )}
      {editingPoolItem && (
        <PoolEditor item={editingPoolItem} projects={settings.labels} allProjects={settings.projects}
          onClose={() => setEditingPool(null)} onChange={(fn) => mutatePoolItem(editingPoolItem.id, fn)}
          onDelete={() => removePoolItem(editingPoolItem.id)}
          onToDay={() => { setEditingPool(null); setPlacer({ kind: 'pool', id: editingPoolItem.id }); }}
          onSaveTemplate={() => { addTemplate({ title: editingPoolItem.title, block: 'morning', projectId: editingPoolItem.projectId, subtasks: editingPoolItem.subtasks.map((s) => s.title) }); flash(tx('Saved as a recurring task.', 'حُفظت كمهمة متكررة.')); }} />
      )}

      {showSettings && (
        <SettingsPanel settings={settings} onChange={persistSettings} onLang={changeLang}
          templates={templates} onAddTemplate={addTemplate} onUpdTemplate={updTemplate} onDelTemplate={delTemplate}
          onExport={buildExport} onImport={applyImport}
          onSetPin={setPin}
          sync={{ busy: syncBusy, msg: syncMsg, lastSync, everyMs: AUTO_EVERY_MS }}
          onSyncNow={() => runSync()}
          storageOk={storageOk} onClose={() => setShowSettings(false)}
          onClearDay={() => { const w = weekRef.current; persistWeek({ ...w, tasks: w.tasks.filter((t) => t.day !== selectedDay) }); flash(tx('Day cleared.', 'تم مسح اليوم.')); }}
          dayLabel={`${wdFull(selectedDate.getDay())} ${selectedDate.getDate()} ${mon(selectedDate.getMonth())}`} />
      )}

      {drag && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
          {drag.kind === 'template' ? <LayoutTemplate size={13} /> : drag.kind === 'pool' ? <Inbox size={13} /> : null}
          {drag.color && <span className="pdot" style={{ background: drag.color }} />}
          {drag.time ? <span className="ttime">{drag.time}</span> : null}
          <span>{drag.title}</span>
        </div>
      )}
      {drag && drag.kind === 'task' && (<div className={`pool-drop-hint ${drag.over && drag.over.type === 'pool' ? 'on' : ''}`} data-droppool="1"><Inbox size={15} /> {tx('Drop here to move to backlog', 'أفلت هنا للنقل إلى قائمة الانتظار')}</div>)}

      {focus && !gateActive && (() => {
        const remain = Math.max(0, focus.endsAt - Date.now());
        const mm = Math.floor(remain / 60000), ssv = Math.floor((remain % 60000) / 1000);
        const ftask = week.tasks.find((t) => t.id === focus.id);
        const subs = ftask?.subtasks || [];
        const allDone = subs.length > 0 && subs.every((st) => st.done);
        return (
          <div className="gate focus-lock">
            <div className="gate-card">
              <span className="gate-eyebrow">{tx('Focusing', 'تركيز')}</span>
              <span className="gate-name">{focus.title}</span>
              <span className="focus-count">{mm}:{String(ssv).padStart(2, '0')}</span>
              {subs.length > 0 && (
                <ul className="focus-subs">{subs.map((st) => (
                  <li key={st.id} className={st.done ? 'done' : ''}>
                    <button className="focus-sub-check" onClick={() => toggleSub(focus.id, st.id)} aria-label={st.done ? 'Mark not done' : 'Mark done'}>{st.done ? <CheckCircle2 size={15} /> : <Circle size={15} />}</button>
                    <span>{st.title}</span>
                  </li>
                ))}</ul>
              )}
              <p className="gate-note">{allDone ? tx('All steps done — wrap up whenever.', 'انتهت كل الخطوات — أنهِ متى شئت.') : tx('Rhythm is locked while you focus.', 'التطبيق مقفل أثناء تركيزك.')}</p>
              <button className="ghost sm" onClick={() => setFocus(null)}>{allDone ? tx('Done', 'تم') : tx('End early', 'إنهاء مبكر')}</button>
            </div>
          </div>
        );
      })()}

      {gateActive && (
        <div className="gate">
          <div className="gate-card">
            <span className="gate-eyebrow">{tx('Time for prayer', 'حان وقت الصلاة')}</span>
            <span className="gate-name">{bName(gateBlock)} {bSub(gateBlock) && <span className="gate-ar">{bSub(gateBlock)}</span>}</span>
            <span className="gate-time">{fmtTime(gateStart)}{gateEnd ? `–${fmtTime(gateEnd)}` : ''}</span>
            <p className="gate-note">{gateHard ? tx('This time belongs to the prayer.', 'هذا الوقت للصلاة.') : gateId === 'fajr' && activeId === 'morning' ? tx('Fajr stays locked through the morning until Dhuhr.', 'يبقى قفل الفجر طوال الصباح حتى الظهر.') : tx("Rhythm is paused until you've prayed.", 'التطبيق متوقف حتى تصلّي.')}</p>
            {gateHard ? (
              <div className="gate-hard"><Lock size={15} /> {gateHardLeft} {tx('min', 'د')}</div>
            ) : (
              <div className="gate-oath">
                <label className="gate-oath-label" htmlFor="oath-in">{tx('Type', 'اكتب')} <span className="gate-oath-word">{OATH_AR}</span> {tx('to confirm you have prayed', 'لتأكيد أنك صلّيت')}</label>
                <input id="oath-in" className="gate-oath-input" dir="rtl" lang="ar" value={oathText} autoComplete="off" autoCorrect="off" spellCheck="false"
                  onChange={(e) => setOathText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && isOath(oathText)) confirmOath(); }}
                  placeholder={OATH_AR} aria-label={tx('Type the oath', 'اكتب القسم')} />
                <button className="primary gate-btn" disabled={!isOath(oathText)} onClick={confirmOath}><CheckCircle2 size={16} /> {tx('Confirm', 'تأكيد')} {bName(gateBlock)}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {wizard && (() => {
        const it = wizard.items[wizard.idx];
        const obj = resolveWizardItem(it);
        if (!obj) return null; // an effect advances past unresolvable items — no side effects in render
        const b = (it.kind === 'template' || it.kind === 'review' || it.kind === 'overdue') ? blockById(obj.block) : null;
        const usedN = it.kind === 'template' ? (usedTpl[obj.id] || 0) : 0;
        const stageLabel = { overdue: tx('overdue', 'متأخرة'), review: tx('already on this day', 'موجودة في هذا اليوم'), template: tx('recurring', 'متكررة'), pool: tx('backlog', 'قائمة الانتظار'), habit: tx('daily habit', 'عادة يومية') }[it.kind];
        const dISO = fmtISO(selectedDate);
        return (
          <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setWizard(null); }}>
            <div className="modal wizard">
              <div className="modal-head plain"><strong>{tx('Plan', 'خطّط')} {wdFull(selectedDate.getDay())} {selectedDate.getDate()} {mon(selectedDate.getMonth())}</strong><button className="icon" onClick={() => setWizard(null)}><X size={18} /></button></div>
              <div className="modal-body">
                <div className="wiz-progress">{wizard.idx + 1} {tx('of', 'من')} {wizard.items.length} · {stageLabel}</div>
                <div className="wiz-title">{obj.title}</div>
                <div className="wiz-meta">
                  {b && <span style={{ color: b.accentDeep, fontWeight: 700 }}>{bName(b)}</span>}
                  {timeLabel(obj) && <span>{timeLabel(obj)}</span>}
                  {obj.subtasks && obj.subtasks.length > 0 && <span>{tr.steps(obj.subtasks.length)}</span>}
                  {usedN > 0 && <span className="tpl-used">{tx('already added', 'أُضيفت')} ×{usedN}</span>}
                  {it.kind === 'habit' && <span style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}><FlameGlyph level={glowLevel(habitStreak(obj, dISO))} size={12} /> {habitStreak(obj, dISO)} {tx('day streak', 'يوم متتالٍ')}</span>}
                </div>
                {it.kind === 'overdue' && <p className="hint-text" style={{ marginTop: 0 }}>{tx('Overdue from', 'متأخرة من')} {wd(new Date(obj._date || Date.now()).getDay()) || ''}. {tx('Bring it to', 'انقلها إلى')} {wdFull(selectedDate.getDay())}?</p>}
                {it.kind === 'review' && <p className="hint-text" style={{ marginTop: 0 }}>{tx('Already planned for this day. Keep it, or remove it.', 'مخططة لهذا اليوم بالفعل. أبقِها أو احذفها.')}</p>}
                {it.kind === 'habit' && <p className="hint-text" style={{ marginTop: 0 }}>{tx('Keep this habit for', 'حافظ على هذه العادة يوم')} {wdFull(selectedDate.getDay())}?</p>}
                {it.kind === 'pool' && (
                  <div className="chooser-grid wiz-grid">
                    {BLOCKS.map((bb) => (
                      <button key={bb.id} className="chooser-block" style={{ '--accent': bb.accent, '--accent-deep': bb.accentDeep, '--tint': bb.tint }} onClick={() => { poolToDay(obj.id, selectedDay, bb.id); wizardNext(); }}>
                        <span className="cb-en">{bName(bb)}</span><span className="cb-ar">{bSub(bb)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="modal-foot">
                <button className="ghost" onClick={wizardNext}>{it.kind === 'review' ? tx('Keep', 'أبقِ') : tx('Skip', 'تخطّ')}</button>
                {it.kind === 'template' && <button className="primary" onClick={() => { templateToDay(obj.id, selectedDay); wizardNext(); }}>{tx('Add to', 'أضف إلى')} {wd(selectedDate.getDay())} · {bName(b)}</button>}
                {it.kind === 'overdue' && <button className="primary" onClick={() => { moveTaskToDate(obj.id, fmtISO(addDays(weekStart, selectedDay))); wizardNext(); }}>{tx('Move to', 'انقل إلى')} {wd(selectedDate.getDay())}</button>}
                {it.kind === 'review' && <button className="danger" onClick={() => { removeTask(obj.id); wizardNext(); }}>{tx('Remove', 'إزالة')}</button>}
                {it.kind === 'habit' && <button className="primary" onClick={() => { toggleHabitDay(obj.id, dISO); wizardNext(); }}><Flame size={15} /> {tx('Mark kept', 'تم الالتزام')}</button>}
              </div>
            </div>
          </div>
        );
      })()}

      {editingTpl && (() => {
        const tp = templates.find((x) => x.id === editingTpl);
        if (!tp) return null;
        return (
          <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditingTpl(null); }}>
            <div className="modal">
              <div className="modal-head plain"><strong>{tx('Recurring task', 'مهمة متكررة')}</strong><button className="icon" onClick={() => setEditingTpl(null)}><X size={18} /></button></div>
              <div className="modal-body">
                <TemplateEditor tpl={tp} projects={settings.labels} onChange={(patch) => updTemplate(tp.id, patch)} onDelete={() => { delTemplate(tp.id); setEditingTpl(null); }} />
                <p className="hint-text" style={{ marginTop: 4 }}>{tx('Edits apply to tasks you add from now on — tasks already on your calendar are untouched.', 'تسري التعديلات على ما تضيفه لاحقًا — المهام الموجودة في تقويمك لا تتغيّر.')}</p>
              </div>
              <div className="modal-foot"><button className="primary" onClick={() => setEditingTpl(null)}>{tx('Done', 'تم')}</button></div>
            </div>
          </div>
        );
      })()}

      {chatOpen && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setChatOpen(false); }}>
          <div className="modal chat-modal">
            <div className="modal-head plain">
              <strong><Sparkles size={15} /> {tx('Planning assistant', 'مساعد التخطيط')}</strong>
              <button className="icon" onClick={() => setChatOpen(false)}><X size={18} /></button>
            </div>
            <div className="modal-body chat-body">
              {chatMsgs.length === 0 && (
                <div className="chat-empty">
                  <p>{tx('Ask about your day. It can see today\u2019s tasks, habits, prayers, overdue and projects — and it proposes changes you approve one by one.', 'اسأل عن يومك. يرى مهام اليوم والعادات والصلوات والمتأخرات والمشاريع — ويقترح تغييرات توافق عليها واحدًا تلو الآخر.')}</p>
                  <div className="chat-suggests">
                    {[tx('What should I focus on today?', 'على ماذا أركّز اليوم؟'), tx('Am I overcommitted?', 'هل حمّلت نفسي أكثر من اللازم؟'), tx('What am I slipping on this week?', 'ما الذي أتراجع فيه هذا الأسبوع؟')].map((sg) => (
                      <button key={sg} className="ghost sm" onClick={() => setChatInput(sg)}>{sg}</button>
                    ))}
                  </div>
                </div>
              )}
              {chatMsgs.map((m, mi) => (
                <div key={mi} className={`chat-msg ${m.role}`}>
                  <div className="chat-bubble">{m.text}</div>
                  {m.role === 'assistant' && (m.proposals || []).length > 0 && (
                    <div className="chat-props">
                      {m.proposals.map((p, pi) => {
                        const state = (m.applied || {})[pi];
                        return (
                          <div key={pi} className={`chat-prop ${state || ''}`}>
                            <div className="chat-prop-main">
                              <span className="chat-prop-desc">{describeProposal(p)}</span>
                              {p.why && <span className="chat-prop-why">{p.why}</span>}
                            </div>
                            {state === 'done' ? <span className="chat-prop-state"><CheckCircle2 size={14} /> {tx('applied', 'طُبّق')}</span>
                              : state === 'skip' ? <span className="chat-prop-state muted">{tx('dismissed', 'تم التجاهل')}</span>
                                : (
                                  <span className="chat-prop-actions">
                                    <button className="primary sm" onClick={() => applyProposal(mi, pi)}>{tx('Approve', 'موافقة')}</button>
                                    <button className="ghost sm" onClick={() => dismissProposal(mi, pi)}>{tx('No', 'لا')}</button>
                                  </span>
                                )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
              {chatBusy && <div className="chat-msg assistant"><div className="chat-bubble thinking"><Loader2 size={14} className="spin" /> {tx('Thinking…', 'يفكّر…')}</div></div>}
              {chatErr && <p className="hint-text" style={{ color: '#9C4221' }}>{chatErr}</p>}
            </div>
            <div className="modal-foot chat-foot">
              <input className="chat-input" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                placeholder={tx('Ask about your day…', 'اسأل عن يومك…')} aria-label={tx('Message', 'رسالة')} />
              <button className="primary" onClick={sendChat} disabled={chatBusy || !chatInput.trim()}>{tx('Send', 'إرسال')}</button>
            </div>
          </div>
        </div>
      )}

      {locked && settings.pin && (
        <PinScreen onVerify={verifyPin} onSuccess={() => setLocked(false)} />
      )}

      {toast && <div className="toast">{toast}</div>}

      <nav className="bottomnav">
        <button className={`navbtn ${view === 'overdue' ? 'on' : ''}`} onClick={() => setView('overdue')} aria-label={tx('Overdue', 'المتأخرات')}>
          <AlertCircle size={20} /><span className="navlabel">{tx('Overdue', 'متأخرات')}</span>
          {overdue.length > 0 && <span className="navbadge">{overdue.length}</span>}
        </button>
        <button className={`navbtn ${view === 'now' ? 'on' : ''}`} onClick={() => setView('now')} aria-label={tx('Now', 'الآن')}>
          <Clock size={20} /><span className="navlabel">{tx('Now', 'الآن')}</span>
        </button>
        <button className={`navbtn ${view === 'plan' ? 'on' : ''}`} onClick={() => setView('plan')} aria-label={tx('Plan', 'خطّط')}>
          <Calendar size={20} /><span className="navlabel">{tx('Plan', 'خطّط')}</span>
        </button>
        <button className={`navbtn ${view === 'projects' ? 'on' : ''}`} onClick={() => setView('projects')} aria-label={tx('Projects', 'المشاريع')}>
          <Target size={20} /><span className="navlabel">{tx('Projects', 'مشاريع')}</span>
        </button>
        <button className={`navbtn ${view === 'habits' ? 'on' : ''}`} onClick={() => setView('habits')} aria-label={tx('Habits', 'العادات')}>
          <Flame size={20} /><span className="navlabel">{tx('Habits', 'عادات')}</span>
        </button>
      </nav>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FlameGlyph — the streak flame. Dead ember at 0; warms, flickers,    */
/*  and gains a pulsing halo as the streak grows; at 6–7 days it burns  */
/*  hot with rising sparks. Pure CSS animation, honours reduced-motion. */
