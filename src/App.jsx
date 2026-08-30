import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Plus, X, Check, ChevronLeft, ChevronRight, Settings, Sparkles, Trash2, Link as LinkIcon, Image as ImageIcon, StickyNote, Loader2, CheckCircle2, Circle, AlertCircle, Tag, Clock, GripVertical, Inbox, LayoutTemplate, CornerUpRight, Copy, Calendar, Target, TrendingUp, Flag, Languages, Repeat, ChevronDown, Flame, Lock, Shield, KeyRound, Delete, Coins, Moon, AlarmClock, Rows3, Mic, Square, ListChecks, CalendarRange } from 'lucide-react';
import {brokerFrom, hasVault,vaultUnlocked,pushToToday,slotPassed,structureDay,taskTextSig,sleepPlan,POINTS,autoWorth,taskWorth,subtaskWorth,latePay,habitLevel,habitMultiplier,habitWorth,isOath,OATH_AR,hashPin,APP_VERSION,BLOCKS,CAIRO,D2R,DEFAULT_LABELS,DEFAULT_SETTINGS,DEFAULT_TIMINGS,LABEL_ICON,LABEL_SWATCHES,LANG,LANGS,MONTHS,MONTHS_AR,PRAYER_BLOCKS,SKY_KEYFRAMES,TIME_24,WEEKDAYS,WEEKDAYS_AR,WEEKDAYS_FULL,WEEKDAYS_FULL_AR,activeBlockAt,addDays,bHint,bName,bSub,blockById,cleanTime,computePrayerTimes,darcsin,darctan2,dsin,firstJsonObject,fixAngle,fixHour,fmtISO,fmtTime,glowLevel,habitDoneOn,habitStreak,inWindow,isRTL,julianDay,lerpArr,lerpN,mdInline,migrateSettings,minutesOf,mkSubs,mm2,mon,newHabit,newProject,pad,parseISO,parseRange,projectPace,projectProgress,renderMarkdown,rgbStr,rgbaStr,sameDay,setLang,setTime24,skyAt,startOfWeek,sunPosition,tx,tEndMin,tStartMin,timeLabel,timeOrder,toHM,uid,vBlock,wd,wdFull,weekdayFullList,windowBounds } from './core.jsx';
import { rawGet, rawSet, rawDelete, rawList, loadKey, saveKey, storageAvailable, setSaveHook } from './storage.js';
import { useSync, markDirty, markDeleted, apiBase, linkWithToken, mintPhoneCode, deviceToken } from './sync.js';
import { readLedger, balanceOf, award, revoke, spend } from './points.js';
import { updateWidget } from './widget.js';
import { writeNowFile } from './nowfile.js';
import { isNative as nativeShell, ensurePermission, permissionState, pendingCount, platformInfo, testNotification, syncReminders, setOngoing, repostOngoing, hookOngoingPersistence, scheduleWakeAlarm, cancelWakeAlarm, pendingWakeAlarm } from './notify.js';
import { ASSISTANT_SYSTEM, ESTIMATOR_SYSTEM, buildDaySnapshot, describeProposal, parseAssistantReply, parseEstimates, callAssistant, seriesDates } from './assistant.js';
import { useDictation } from './dictation.js';
import { loadDurations, durationFor, rememberDuration } from './durations.js';
import { FocusView, isDesktop, useRoundEnded } from './focus.jsx';
import { loadFeeds, saveFeeds, refreshAll, loadInstances, busyOn, eventsOn } from './calsync.js';
import { calKey, loadCalDone, toggleCalDone, pruneCalDone } from './caldone.js';
import { DayEvents } from './calview.jsx';
import { CalendarView } from './calendarview.jsx';
import { KanbanBoard } from './kanban.jsx';
import { columnsOf, isMove, patchFor } from './board.js';
import { rangeOf } from './calgrid.js';
import { loadCalProjects, setCalProject, pruneCalProjects } from './calproj.js';
import { parseTaskText, describeParse } from './parse.js';
import { nextMark, TINY } from './habits.js';
import { TrelloCards } from './trelloview.jsx';
import { refreshTrello, readCache as readTrelloCache, dueCards } from './trello.js';

import { AppIcon,BlockRow,FlameGlyph,HabitLine,Landscape,NoteBlock,NotesEditor,PlanSide,PointsPanel,PoolEditor,SkyScene,SubtaskEditor,TaskEditor,pyramidPath } from './components.jsx';
import { HabitCard,HabitsView,PinPad,PinScreen,ProjectCard,ProjectsView,SettingsPanel,TemplateEditor,describeOp } from './views.jsx';

/* The pool rejected this app's token. Said plainly, and pointing at the field
   that is wrong — the failure is indistinguishable from "the AI is broken"
   otherwise, and it is neither the Gemini key nor the network. */
const POOL_AUTH_MSG = () => tx(
  'The shared key pool rejected this app\u2019s token. Check Settings \u2192 key pool token, or clear both key pool fields to use your own Gemini key instead.',
  '\u0631\u0641\u0636 \u0645\u062e\u0632\u0646 \u0627\u0644\u0645\u0641\u0627\u062a\u064a\u062d \u062a\u0648\u0643\u0646 \u0647\u0630\u0627 \u0627\u0644\u062a\u0637\u0628\u064a\u0642. \u0631\u0627\u062c\u0639 \u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a \u2190 \u062a\u0648\u0643\u0646 \u0627\u0644\u0645\u062e\u0632\u0646\u060c \u0623\u0648 \u0627\u0645\u0633\u062d \u062d\u0642\u0644\u064a \u0627\u0644\u0645\u062e\u0632\u0646 \u0644\u0627\u0633\u062a\u062e\u062f\u0627\u0645 \u0645\u0641\u062a\u0627\u062d Gemini \u0627\u0644\u062e\u0627\u0635 \u0628\u0643.',
);

export default function Rhythm() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), 6));
  const [week, setWeek] = useState({ tasks: [] });
  const [pool, setPool] = useState([]);            // backlog items (unscheduled)
  const [templates, setTemplates] = useState([]);  // preset task templates
  const [selectedDay, setSelectedDay] = useState(0);
  /* The Plan strip is a continuous window of dates, NOT the stored week: weeks
     remain the storage and sync unit, but the person plans in days, and a week
     page made the Friday-to-Saturday move a different gesture from every other
     day-to-day move. stripStart is simply the first date on show. */
  const [stripStart, setStripStart] = useState(() => addDays(new Date(), -1));
  const [timings, setTimings] = useState(DEFAULT_TIMINGS);
  const [usingFallback, setUsingFallback] = useState(false);
  const [todayTimings, setTodayTimings] = useState(DEFAULT_TIMINGS);
  const [todayData, setTodayData] = useState(null);
  const [nowTick, setNowTick] = useState(0);
  const [storageOk, setStorageOk] = useState(true);
  const [view, setView] = useState('now');         // 'overdue' | 'now' | 'plan' | 'calendar' | 'projects' | 'habits' | 'focus'
  // The last focus round that ended and has not been answered yet. The shell
  // raises the window when a round linked to a task finishes, so the question
  // lands in front of the person while the answer still means something.
  const [pendingRound, setPendingRound] = useState(null);
  /* Read-only calendars. `calFeeds` is the person's configuration and syncs;
     `calInstances` is the expanded events, rebuilt from the device-local
     cache. `calReport` is per-feed so a calendar that quietly stopped
     updating can say so instead of just going empty. */
  const [calFeeds, setCalFeeds] = useState([]);
  const [calInstances, setCalInstances] = useState([]);
  const [calReport, setCalReport] = useState([]);
  const [calBusy, setCalBusy] = useState(false);
  /* Rhythm's own done-marks for calendar events — the calendar itself is never
     written to. Keyed by day ISO, loaded for the two days on screen (today and
     the selected one); `refresh` re-runs this after sync lands new pages. */
  const [calDone, setCalDone] = useState({});
  /* The calendar view keeps its own date and mode. Deliberately not the Plan
     page's selection: paging a month around is browsing, and it should not
     drag the day you are actually working on with it. */
  const [calMode, setCalMode] = useState('week');
  const [calDate, setCalDate] = useState(() => new Date());
  const [calProjects, setCalProjects] = useState({});
  const [calPicked, setCalPicked] = useState(null);
  const [calTasks, setCalTasks] = useState({});   // ISO -> tasks, for the range on screen
  const [boardProject, setBoardProject] = useState(null);  // project id, when its board is open
  const [boardReady, setBoardReady] = useState(false);
  // Trello, same shape of problem: a cached copy of someone else's system,
  // refreshed on a timer, never written to.
  const [trelloCards, setTrelloCards] = useState([]);
  const [trelloReport, setTrelloReport] = useState(null);
  const [trelloBusy, setTrelloBusy] = useState(false);
  const [trelloAdded, setTrelloAdded] = useState(() => new Set());
  const [overdue, setOverdue] = useState([]);
  const [refresh, setRefresh] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [odBusy, setOdBusy] = useState(false);
  const [ledger, setLedger] = useState([]);
  const ledgerRef = useRef([]);
  const [showPoints, setShowPoints] = useState(false);
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

  /* ---- dictation ----------------------------------------------------
     Two microphones, one engine. Where the browser has SpeechRecognition
     (Chrome, Safari) the words appear live and cost nothing; in the Android
     WebView and the Electron shell, which have no such thing, the clip is
     recorded and transcribed by Gemini through the shared key pool. The hook
     hides which of the two ran — a caller only ever gets text.

     The base ref is what makes dictating INTO half-typed text work: live
     recognition reports the whole utterance every time, so without a
     remembered prefix each new word would wipe what was already there. */
  const dictationError = (e) => {
    const m = String((e && e.message) || e);
    // Two engines, two vocabularies for the same refusal: getUserMedia
    // rejects with NotAllowedError (normalised to 'denied' by the hook), Web
    // Speech reports 'not-allowed'. Both mean the person said no, or the
    // browser said it for them.
    if (m === 'denied' || m === 'not-allowed') return tx('Microphone permission was refused.', 'رُفض إذن الميكروفون.');
    if (m === 'audio-capture') return tx('No microphone found.', 'لا يوجد ميكروفون.');
    if (m === 'no-speech') return tx("Didn't catch that — try again.", 'لم أسمع شيئًا — حاول مرة أخرى.');
    if (m === 'unsupported') return tx('This device has no microphone this app can use.', 'لا يوجد ميكروفون يمكن للتطبيق استخدامه على هذا الجهاز.');
    if (m === 'no API key' || m === 'pool unavailable') return tx('Dictation here needs a key — add one under Settings → AI sorting.', 'يحتاج الإملاء إلى مفتاح — أضفه من الإعدادات ← الفرز الذكي.');
    if (m === 'rate') return tx('Rate limit hit — wait a moment and try again.', 'تم بلوغ حد المعدل — انتظر قليلًا وأعد المحاولة.');
    if (m === 'network' || m === 'service-not-allowed') return tx('Speech recognition is unavailable right now.', 'خدمة التعرف على الكلام غير متاحة الآن.');
    return tx(`Dictation failed (${m}).`, `فشل الإملاء (${m}).`);
  };
  const chatBaseRef = useRef('');
  const chatMic = useDictation({
    lang: settings.lang, apiKey: settings.apiKey, broker: brokerFrom(settings),
    onText: (t) => setChatInput(chatBaseRef.current ? `${chatBaseRef.current} ${t}` : t),
    onError: (e) => setChatErr(dictationError(e)),
  });
  const toggleChatMic = () => {
    if (chatMic.state === 'idle') { chatBaseRef.current = chatInput.trim(); setChatErr(''); }
    chatMic.toggle();
  };
  const dumpBaseRef = useRef('');
  const dumpMic = useDictation({
    lang: settings.lang, apiKey: settings.apiKey, broker: brokerFrom(settings),
    onText: (t) => setDump(dumpBaseRef.current ? `${dumpBaseRef.current}\n${t}` : t),
    onError: (e) => setParseError(dictationError(e)),
  });
  const toggleDumpMic = () => {
    if (dumpMic.state === 'idle') { dumpBaseRef.current = dump.trim(); setParseError(''); }
    dumpMic.toggle();
  };
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
  const [notifyState, setNotifyState] = useState({ supported: false, state: 'unsupported' });
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
      setStripStart(addDays(today, -1));
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
          if (slotPassed(t, d, today, { timings: todayTimings, sinceFajr, curSinceFajr })) items.push({ t, ws: new Date(ws), date: d });
        }
      }
      items.sort((a, b) => (a.date - b.date) || (a.t.order - b.t.order));
      if (!cancelled) setOverdue(items);
    })();
    return () => { cancelled = true; };
  }, [ready, weekStart, week, todayData, settings.weekStartDay, todayTimings, nowTick, view, refresh, logicalDayMid]);

  useEffect(() => { const id = setInterval(() => setNowTick((x) => x + 1), 30000); return () => clearInterval(id); }, []);

  useEffect(() => {
    if (!ready) return undefined;
    let alive = true;
    (async () => {
      const isos = [...new Set([fmtISO(logicalDayMid()), fmtISO(addDays(weekStart, selectedDay))])];
      const out = {};
      for (const iso of isos) out[iso] = await loadCalDone(iso);
      if (alive) setCalDone(out);
    })();
    return () => { alive = false; };
  }, [ready, weekStart, selectedDay, refresh, logicalDayMid]);

  const toggleMeeting = async (iso, key) => {
    const on = await toggleCalDone(iso, key);
    setCalDone((prev) => {
      const day = { ...(prev[iso] || {}) };
      if (on) day[key] = Date.now(); else delete day[key];
      return { ...prev, [iso]: day };
    });
  };


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
      else if (k.startsWith("planner:week:")) { const d = new Date(k.slice(13) + "T00:00:00"); if (!isNaN(d) && d < winStartWeek) { await rawDelete(k); markDeleted(k); } }
    }
    await pruneCalDone(winStartWeek);
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
        out.push({ id: tk.id, title: tk.title, done: !!tk.done, board: tk.board || null, wsISO, day: tk.day, date: addDays(parseISO(wsISO), tk.day), block: tk.block, kind: 'task' });
      }
    });
    const curISO = fmtISO(weekStart);
    scan(weekRef.current, curISO);
    Object.entries(weeksRef.current).forEach(([iso, wk]) => { if (iso !== curISO) scan(wk, iso); });
    poolRef.current.forEach((it) => { if (it.projectRef === projId && !seen.has(it.id)) { seen.add(it.id); out.push({ id: it.id, title: it.title, done: !!it.done, board: it.board || null, wsISO: null, day: null, date: null, block: null, kind: 'pool' }); } });
    out.sort((a, b) => (a.date && b.date ? a.date - b.date : a.date ? -1 : b.date ? 1 : 0));
    return { tasks: out, total: out.length, done: out.filter((x) => x.done).length };
  };
  /* Patch a project task where it actually lives — it may be in a week that
     isn't on screen, or in the backlog. The board moves cards with this, which
     is why moving a card is an ordinary task edit rather than a second record
     that could drift out of step with the Now queue. */
  const patchProjectTask = (ref, patch) => {
    if (ref.kind === 'pool') { mutatePoolItem(ref.id, (it) => ({ ...it, ...patch })); bumpRefresh(); return; }
    if (!ref.wsISO) return;
    const wk = ref.wsISO === fmtISO(weekStart) ? weekRef.current : weeksRef.current[ref.wsISO];
    if (!wk) return;
    const next = { ...wk, tasks: (wk.tasks || []).map((tk) => (tk.id === ref.id ? { ...tk, ...patch } : tk)) };
    weeksRef.current[ref.wsISO] = next;
    saveKey(`planner:week:${ref.wsISO}`, next);
    if (ref.wsISO === fmtISO(weekStart)) { weekRef.current = next; setWeek(next); }
    bumpRefresh();
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
  /* Opening a task from a project — the card or its board — used to throw you
     onto the Plan page, which meant leaving the thing you were working through
     and, on a board, losing the board itself (leaving Projects clears it).
     Both editors are top-level modals and render whatever view is showing, so
     the jump was never needed.

     The week still has to be loaded: editingTask is looked up in the displayed
     week, and mutateTask writes back to that same document — so pointing at
     the wrong one would either find nothing or save into the wrong week. That
     is invisible from here, since the Plan page is not what you are looking
     at. */
  const openProjectTask = (ref) => {
    if (ref.kind === 'pool') { setEditingPool(ref.id); return; }
    /* Already showing that week? Open it now. The deferred path waits on the
       week CHANGING, and setting weekStart to the value it already holds
       changes nothing — so a task on the current week would have sat behind a
       pending flag that nothing ever cleared. Most tasks reached from a
       project board are on the current week. */
    if (ref.wsISO === fmtISO(weekStart)) { setSelectedDay(ref.day); setEditing(ref.id); return; }
    const ws = parseISO(ref.wsISO);
    setWeekStart(ws); setSelectedDay(ref.day); pendingEditRef.current = ref.id;
  };

  /* ---- habits (stored in settings) ---- */
  const persistHabits = (updater) => setSettings((prev) => {
    const next = typeof updater === 'function' ? updater(prev.habits || []) : updater;
    const n = { ...prev, habits: next }; saveKey('planner:settings', n); return n;
  });
  const addHabit = () => { const h = newHabit(); persistHabits((prev) => [...prev, h]); return h; };
  const updHabit = (id, patch) => persistHabits((prev) => prev.map((h) => h.id === id ? { ...h, ...patch } : h));
  const delHabit = (id) => persistHabits((prev) => prev.filter((h) => h.id !== id));
  /* The two-minute version, marked straight rather than by cycling: this is
     offered at the moment someone is deciding whether to bother at all, and
     making them press twice to reach it is exactly the friction it exists to
     remove. */
  const markHabitTiny = (id, iso) => {
    const before = (settingsRef.current.habits || []).find((h) => h.id === id);
    persistHabits((prev) => prev.map((h) => (h.id === id ? { ...h, log: { ...(h.log || {}), [iso]: TINY } } : h)));
    if (before && !habitDoneOn(before, iso)) awardHabitDay(before, iso);
  };
  const toggleHabitDay = (id, iso) => {
    const before = (settingsRef.current.habits || []).find((h) => h.id === id);
    /* Three states, not two, when the habit has a two-minute version: kept,
       kept-tiny, not kept. A tiny day still keeps the chain — showing up is
       the habit — but it is recorded as tiny rather than rounded up, because
       the log should not lie about which kind of day it was. */
    persistHabits((prev) => prev.map((h) => {
      if (h.id !== id) return h;
      const log = { ...(h.log || {}) };
      const next = nextMark(log[iso], { hasTiny: !!(h.tiny || '').trim() });
      if (next) log[iso] = next; else delete log[iso];
      return { ...h, log };
    }));
    // Points ride on the log as it stood BEFORE the toggle: the multiplier is
    // earned by the days leading up to this one, not by this one.
    if (!before) return;
    if (habitDoneOn(before, iso)) revokeRef(`habit:${id}:${iso}`); else awardHabitDay(before, iso);
  };

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

  /* ---- cross-device sync ----
     Optional and invisible unless the deployment has one: useSync probes
     /api/me on boot and reports `unavailable` when there is no backend, which
     is the normal case for the Android shell and a plain `vite dev`.

     Every local write stamps a timestamp in the sync meta; the hook decides on
     its own when to push. `localVersion` just tells it something changed —
     the actual "is anything owed?" test is a fingerprint comparison inside the
     hook, never JSON.stringify. */
  const [localVersion, setLocalVersion] = useState(0);
  useEffect(() => {
    setSaveHook((key) => { markDirty(key); setLocalVersion((n) => n + 1); });
    return () => setSaveHook(null);
  }, []);

  /* Sync writes straight to storage, so after it applies keys we re-read the
     ones it touched into live state. Deliberately NOT re-persisting: the bytes
     are already saved, and saving again would stamp a fresh timestamp and push
     the same content back — the echo that turns a sync into a loop. */
  const adoptKeys = useCallback(async (keys) => {
    // The ledger is spread over one key per day, so any of them landing means
    // the balance on screen is stale. Re-read once, not per key.
    if (keys.some((k) => k.startsWith('planner:points:'))) readLedger().then((l) => { ledgerRef.current = l; setLedger(l); });
    for (const key of keys) {
      const v = await loadKey(key);
      if (key === 'planner:settings') {
        if (!v) continue;
        const m = migrateSettings(v); setLang(m.lang); setSettings(m); if (!m.pin) setLocked(false);
      } else if (key === 'planner:pool') { const arr = Array.isArray(v) ? v : []; poolRef.current = arr; setPool(arr); }
      else if (key === 'planner:templates') { setTemplates(Array.isArray(v) ? v : []); }
      else if (key.startsWith('planner:week:')) {
        const iso = key.slice('planner:week:'.length);
        if (v == null) delete weeksRef.current[iso]; else weeksRef.current[iso] = v;
        if (iso === fmtISO(weekStart)) { const w = v || { tasks: [] }; weekRef.current = w; setWeek(w); }
      }
    }
    bumpRefresh();
  }, [weekStart]);

  const sync = useSync({ localVersion, onApplied: adoptKeys, loaded: ready });

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
      projectId: extra.projectId || null, projectRef: extra.projectRef || null,
      time: extra.time || '', start: extra.start || '', end: extra.end || '', templateId: extra.templateId || null, done: false,
      subtasks: extra.subtasks ? mkSubs(extra.subtasks.map((s) => (typeof s === 'string' ? s : s.title))) : [],
      notes: extra.notes || [], order: extra.order != null ? extra.order : (timeOrder(extra.time) + Date.now() % 1000),
    };
    persistWeek({ ...w, tasks: [...w.tasks, t] });
  };
  // Duration between a task's start and end, wrap-safe, or null.
  const spanOf = (t) => {
    const st = tStartMin(t), en = tEndMin(t);
    return st != null && en != null ? ((en - st + 1440) % 1440) || null : null;
  };
  const mutateTask = (id, fn) => {
    const w = weekRef.current;
    let learned = null;
    const tasks = w.tasks.map((t) => {
      if (t.id !== id) return t;
      const next = fn(t);
      // Both times present, set by hand (the editor clears autoSlot on manual
      // edits), and actually changed: that is the person stating a duration.
      // Vault windows are excluded — they are availability, not effort.
      if (next.start && next.end && !next.autoSlot && !hasVault(next) && (next.start !== t.start || next.end !== t.end)) {
        learned = { title: next.title, min: spanOf(next) };
      }
      return next;
    });
    persistWeek({ ...w, tasks });
    if (learned && learned.min) rememberDuration(learned.title, learned.min, 'manual');
  };

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
  /* Which week document owns a date, and the day index inside it. Tasks are
     stored per week with a 0–6 index, so a bare index is only meaningful next
     to the week it belongs to — this is the pair that makes it absolute. */
  const slotForDate = (dateISO) => {
    const target = parseISO(dateISO);
    if (!target || Number.isNaN(target.getTime())) return null;
    const ws = startOfWeek(target, settings.weekStartDay);
    return { wsISO: fmtISO(ws), day: Math.round((target - ws) / 86400000) };
  };
  /* Append a task to whichever week owns `dateISO`, which may not be the one on
     screen. */
  const putTaskOnDate = async (dateISO, task) => {
    const slot = slotForDate(dateISO);
    if (!slot) return null;
    const placed = { ...task, day: slot.day };
    if (slot.wsISO === fmtISO(weekStart)) { const w = weekRef.current; persistWeek({ ...w, tasks: [...w.tasks, placed] }); return placed; }
    const dest = await readWeek(slot.wsISO);
    await writeWeek(slot.wsISO, { ...dest, tasks: [...(dest.tasks || []), placed] });
    return placed;
  };
  const addTaskOnDate = async (dateISO, blockId, title, extra = {}) => {
    if (!title || !title.trim()) return;
    await putTaskOnDate(dateISO, {
      id: uid(), title: title.trim(), day: 0, block: blockId,
      projectId: extra.projectId || null, projectRef: extra.projectRef || null,
      time: extra.time || '', start: extra.start || '', end: extra.end || '',
      templateId: extra.templateId || null, done: false,
      subtasks: extra.subtasks ? mkSubs(extra.subtasks.map((s) => (typeof s === 'string' ? s : s.title))) : [],
      notes: extra.notes || [], order: extra.order != null ? extra.order : (timeOrder(extra.time) + Date.now() % 1000),
    });
  };
  const poolToDayOnDate = async (poolId, dateISO, blockId) => {
    const it = poolRef.current.find((p) => p.id === poolId);
    if (!it || !slotForDate(dateISO)) return; // don't drop it from the backlog if it has nowhere to land
    persistPool(poolRef.current.filter((p) => p.id !== poolId));
    await putTaskOnDate(dateISO, { id: uid(), title: it.title, day: 0, block: blockId, projectId: it.projectId || null, projectRef: it.projectRef || null, time: '', done: false, subtasks: it.subtasks || [], notes: it.notes || [], order: Date.now() });
  };

  const removeTask = (id) => { const w = weekRef.current; persistWeek({ ...w, tasks: w.tasks.filter((t) => t.id !== id) }); setEditing(null); };
  // The task's own calendar date, needed to tell an on-time finish from a late
  // one. Tasks in the displayed week carry a day index off that week's start.
  const dateOfTask = (t) => addDays(weekStart, Number(t.day) || 0);
  const toggleDone = (id) => {
    const t = (weekRef.current.tasks || []).find((x) => x.id === id);
    mutateTask(id, (x) => ({ ...x, done: !x.done }));
    if (!t) return;
    if (!t.done) {
      awardTaskDone(t, dateOfTask(t));
      // Finishing a timed task without having touched its slot is acceptance:
      // remember the duration under this title for every future slotting.
      // 'kept' for a slot the button assigned, 'manual' when the times were
      // the person's own — a kept slot never overwrites a hand-set number.
      const min = !hasVault(t) ? spanOf(t) : null;
      if (min) rememberDuration(t.title, min, t.autoSlot ? 'kept' : 'manual');
    } else revokeRef(`task:${id}`);
  };
  const toggleSub = (id, subId) => {
    const t = (weekRef.current.tasks || []).find((x) => x.id === id);
    mutateTask(id, (x) => ({ ...x, subtasks: x.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)) }));
    if (!t) return;
    const sub = (t.subtasks || []).find((s) => s.id === subId);
    if (sub && !sub.done) awardSubDone(t, subId, dateOfTask(t)); else revokeRef(`sub:${id}:${subId}`);
  };
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
    const it = { id: uid(), title: title.trim(), projectId: extra.projectId || null, projectRef: extra.projectRef || null, subtasks: extra.subtasks ? mkSubs(extra.subtasks.map((s) => (typeof s === 'string' ? s : s.title))) : [], notes: extra.notes || [], order: Date.now() };
    persistPool([...poolRef.current, it]);
    return it;
  };
  const mutatePoolItem = (id, fn) => persistPool(poolRef.current.map((p) => (p.id === id ? fn(p) : p)));
  const togglePoolDone = (id) => mutatePoolItem(id, (p) => ({ ...p, done: !p.done }));
  /* Emptying the drawer. Confirmed in the UI first — this is the one button
     here that destroys several things at once, and an undo would mean keeping
     a copy of what was just deleted, which is exactly what a backlog is
     supposed to stop being. */
  const clearDonePool = () => {
    const gone = poolRef.current.filter((p) => p.done).length;
    if (!gone) return;
    persistPool(poolRef.current.filter((p) => !p.done));
    setEditingPool(null);
    flash(gone === 1 ? tx('Deleted.', 'حُذفت.') : `${gone} ${tx('deleted.', 'حُذفت.')}`);
  };
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

  /* ---- points ---- */
  /* The clock the ledger and the overdue scan share. Rebuilt per call rather
     than memoised because "has this passed yet" is only true of the instant
     you ask it. */
  const lateCtx = useCallback(() => {
    const n = new Date(); const curMin = n.getHours() * 60 + n.getMinutes();
    const fajrM = minutesOf(todayTimings.Fajr);
    const sinceFajr = (m) => (fajrM == null ? m : (((m - fajrM) % 1440) + 1440) % 1440);
    return { today: logicalDayMid(), timings: todayTimings, sinceFajr, curSinceFajr: sinceFajr(curMin), activeBlock: activeBlockAt(todayTimings, curMin) };
  }, [todayTimings, logicalDayMid]);

  const refreshLedger = useCallback(async () => {
    const l = await readLedger(); ledgerRef.current = l; setLedger(l);
  }, []);
  useEffect(() => { if (ready) refreshLedger(); }, [ready, refreshLedger]);
  useEffect(() => { if (ready) loadDurations(); }, [ready]);

  const balance = useMemo(() => balanceOf(ledger), [ledger]);
  const paidOn = (ref) => ledgerRef.current.some((e) => e.ref === ref);
  // What this task has already handed out, counting its subtasks. Ticking the
  // parent settles the remainder, so the two routes can never total more than
  // the task is worth.
  const paidForTask = (id) => ledgerRef.current
    .filter((e) => e.ref === `task:${id}` || e.ref.startsWith(`sub:${id}:`))
    .reduce((n, e) => n + (Number(e.amount) || 0), 0);

  const showEarned = (n, late) => {
    if (!n) return;
    flash(late ? `+${n} ${tx('(late)', '(متأخر)')}` : `+${n}`);
  };

  const awardTaskDone = async (t, taskDate) => {
    const ctx = lateCtx();
    const late = slotPassed(t, taskDate, ctx.today, ctx);
    const gross = Math.max(0, taskWorth(t) - paidForTask(t.id));
    const amount = late ? latePay(gross) : gross;
    const e = await award(ledgerRef.current, { iso: fmtISO(ctx.today), ref: `task:${t.id}`, kind: 'task', amount, title: t.title, meta: late ? { late: true } : null });
    if (e) { await refreshLedger(); showEarned(amount, late); }
  };
  const awardSubDone = async (t, subId, taskDate) => {
    // The parent already settled the whole task; paying the subtask now would
    // be paying twice for the same work.
    if (paidOn(`task:${t.id}`)) return;
    const ctx = lateCtx();
    const late = slotPassed(t, taskDate, ctx.today, ctx);
    const gross = subtaskWorth(t, subId);
    const amount = late ? latePay(gross) : gross;
    const sub = (t.subtasks || []).find((s) => s.id === subId);
    const e = await award(ledgerRef.current, { iso: fmtISO(ctx.today), ref: `sub:${t.id}:${subId}`, kind: 'subtask', amount, title: (sub && sub.title) || t.title, meta: late ? { late: true } : null });
    if (e) { await refreshLedger(); showEarned(amount, late); }
  };
  const awardHabitDay = async (h, iso) => {
    const amount = habitWorth(h, iso);
    const e = await award(ledgerRef.current, { iso, ref: `habit:${h.id}:${iso}`, kind: 'habit', amount, title: h.name });
    if (e) { await refreshLedger(); showEarned(amount, false); }
  };
  // Unticking means "that didn't happen" — the entry goes, rather than being
  // cancelled out by a negative one.
  const revokeRef = async (ref) => { const n = await revoke(ledgerRef.current, ref); if (n) { await refreshLedger(); flash(`−${n}`); } };

  /* Start over: every points page goes, with tombstones so sync erases the
     other devices too instead of handing the history straight back. */
  const resetPoints = async () => {
    const keys = await rawList('planner:points:');
    for (const k of keys) { await rawDelete(k); markDeleted(k); }
    await refreshLedger();
    flash(tx('Points reset — a clean slate.', 'صُفّرت النقاط — صفحة جديدة.'));
  };

  const persistRewards = (fn) => persistSettings({ ...settingsRef.current, rewards: fn(settingsRef.current.rewards || []) });
  const addReward = () => persistRewards((prev) => [...prev, { id: uid(), name: '', cost: 100 }]);
  const updReward = (id, patch) => persistRewards((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const delReward = (id) => persistRewards((prev) => prev.filter((r) => r.id !== id));

  const cashIn = async (reward) => {
    const cost = Math.round(Number(reward.cost) || 0);
    if (cost <= 0) return;
    if (cost > balance) { flash(tx('Not enough points yet.', 'النقاط لا تكفي بعد.')); return; }
    await spend(fmtISO(lateCtx().today), { title: reward.name, cost, rewardId: reward.id });
    await refreshLedger();
    flash(`${tx('Enjoy it.', 'استمتع.')} −${cost}`);
  };

  /* ---- structuring the day into strict slots ---- */
  /* Everything a person can type into an "add a task" box goes through here.
     The same text means the same thing whichever box it was typed into, which
     is the only reason a syntax like this is worth learning at all. */
  const parseCtx = () => ({ today: logicalDayMid(), labels: settings.labels || [], projects: settings.projects || [] });
  const parseHint = useCallback(
    (text) => describeParse(parseTaskText(text, parseCtx()), { blockName: (id) => bName(blockById(id)) }),
    [settings.labels, settings.projects],
  );

  const addParsedTask = async (rawText, { dayIdx = selectedDay, blockId = null, toPool = false } = {}) => {
    const text = String(rawText || '').trim();
    if (!text) return;
    const p = parseTaskText(text, parseCtx());
    const extra = {
      start: p.start || '', end: p.end || '',
      // Only the first tag is claimed — the task model carries one label.
      projectId: p.labelNames.length ? labelIdFor(p.labelNames[0]) : null,
      projectRef: p.projectId || null,
    };
    if (toPool) { addPoolItem(p.title, extra); return; }
    const block = p.block || blockId || 'morning';
    // A date in the text outranks the row it was typed into: someone who
    // writes "tomorrow" in today's Morning box means tomorrow.
    if (p.dateISO && p.dateISO !== fmtISO(addDays(weekStart, dayIdx))) {
      await addTaskOnDate(p.dateISO, block, p.title, extra);
      flash(`${p.title} → ${p.dateISO}`);
      return;
    }
    addTask(dayIdx, block, p.title, extra);
  };

  const [slotBusy, setSlotBusy] = useState(false);
  // dayIdx is 0-6 within the week on screen; omitted means the selected day.
  // The assistant can name any day, so this can no longer read the selection
  // out of the closure and call it the answer.
  const structureSelectedDay = async (dayIdxArg) => {
    if (slotBusy) return;
    const dayIdx = dayIdxArg == null ? selectedDay : dayIdxArg;
    const isToday = sameDay(addDays(weekStart, dayIdx), logicalDayMid());
    const n = new Date(); const nowMin = n.getHours() * 60 + n.getMinutes();
    // Re-running re-flows: anything the last run placed goes back to floating
    // (its auto times stripped) instead of standing as an obstacle. 'end' marks
    // a start-only pin whose start is the person's and only the end was ours.
    let dayTasks = week.tasks
      .filter((t) => t.day === dayIdx && !t.done)
      .map((t) => (t.autoSlot === 'both' ? { ...t, start: '', end: '' } : t.autoSlot === 'end' ? { ...t, end: '' } : t));

    /* Sizing order: memory, then AI, then heuristic.

       Memory first — a duration the person accepted or set by hand is worth
       more than any fresh model opinion, it costs nothing, and it makes the
       recurring backbone of a week ("Email the client", every week) converge
       on THEIR numbers instead of guesses. Tasks memory covers are not sent
       to the model at all. */
    dayTasks = dayTasks.map((t) => {
      if (t.start && t.end) return t;
      const m = durationFor(t.title);
      return m ? { ...t, est: m, estSig: taskTextSig(t) } : t;
    });

    /* AI sizing, when a key is set. Only tasks whose text changed since the
       last answer are sent (the estimate is cached on the task with a text
       signature), and any failure — no key, offline, junk reply, timeout —
       falls through to the built-in heuristic without a word of ceremony:
       slotting must never be hostage to the network. */
    let sized = 0, aiTried = false, estMap = null, aiWhy = '';
    const needsEst = dayTasks.filter((t) => !(t.start && t.end) && (!t.est || t.estSig !== taskTextSig(t)));
    if ((settings.apiKey || brokerFrom(settings)) && needsEst.length) {
      aiTried = true;
      setSlotBusy(true);
      try {
        const listing = needsEst.map((t) => ({ id: t.id, title: t.title, steps: (t.subtasks || []).map((s) => s.title) }));
        const text = await Promise.race([
          callAssistant({ apiKey: settings.apiKey, groqKey: settings.groqKey, broker: brokerFrom(settings), system: ESTIMATOR_SYSTEM, messages: [{ role: 'user', content: JSON.stringify(listing) }] }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000)),
        ]);
        const est = parseEstimates(text, needsEst.map((t) => t.id));
        if (est) {
          sized = est.size;
          estMap = est;
          dayTasks = dayTasks.map((t) => (est.has(t.id) ? { ...t, est: est.get(t.id), estSig: taskTextSig(t) } : t));
        }
      } catch (e) { aiWhy = String((e && e.message) || e); } // heuristic it is — but say so
      setSlotBusy(false);
    }

    // The day is planned around what is already spoken for: calendar events
    // as hard walls, and the opening minutes of each prayer block held for
    // the prayer itself.
    const { slots, unplaced } = structureDay(dayTasks, timings, isToday ? nowMin : null, {
      busy: calBusyFor(addDays(weekStart, dayIdx)),
      prayerReserveMin: (settings.calendar || {}).prayerReserveMin ?? 15,
    });
    // ONE write carrying both the estimate cache and the slots, built from the
    // live ref. Two writes here once lost the estimates: the second was built
    // from the stale render-time `week` and quietly un-wrote the first, so
    // every slotting re-asked the model for the same tasks.
    const byId = new Map(slots.map((s) => [s.id, s]));
    if (slots.length || (estMap && estMap.size)) {
      const w = weekRef.current;
      persistWeek({
        ...w,
        tasks: w.tasks.map((t) => {
          let nx = t;
          if (estMap && estMap.has(t.id)) nx = { ...nx, est: estMap.get(t.id), estSig: taskTextSig(nx) };
          const s = byId.get(t.id);
          if (s) nx = { ...nx, start: s.start, end: s.end, time: '', autoSlot: s.pinned ? 'end' : 'both' };
          return nx;
        }),
      });
    }
    if (!slots.length) {
      flash(unplaced.length ? tx('No room left today for these tasks.', 'لا وقت متبقيًا اليوم لهذه المهام.') : tx('Nothing to slot.', 'لا شيء لجدولته.'));
      return;
    }
    // A quiet AI failure looks identical to AI never having run, which reads
    // as "the AI features are broken". Slotting still worked — say both.
    const sizedNote = aiTried
      ? (sized ? ` · ${sized} ${tx('sized by AI', 'قُدّرت بالذكاء الاصطناعي')}` : ` · ${tx('AI sizing failed', 'تعذّر التقدير الذكي')} (${aiWhy || tx('bad reply', 'رد غير مفهوم')})`)
      : '';
    flash(unplaced.length
      ? `${slots.length} ${tx('slotted', 'تمت جدولتها')} · ${unplaced.length} ${tx("didn't fit", 'لم تتسع لها')}${sizedNote}`
      : `${slots.length} ${tx('tasks slotted. Follow the clock.', 'مهمة جُدولت. اتبع الساعة.')}${sizedNote}`);
  };
  const clearSlots = (dayIdxArg) => {
    const dayIdx = dayIdxArg == null ? selectedDay : dayIdxArg;
    persistWeek({
      ...week,
      tasks: week.tasks.map((t) => (t.day !== dayIdx || !t.autoSlot ? t
        : t.autoSlot === 'end' ? { ...t, end: '', autoSlot: null }
        : { ...t, start: '', end: '', autoSlot: null })),
    });
    flash(tx('Slots cleared.', 'أُزيلت الجدولة.'));
  };
  const dayHasSlots = week.tasks.some((t) => t.day === selectedDay && t.autoSlot);

  /* ---- sleep: cycle-aligned wake alarm (native) ---- */
  const [alarmAt, setAlarmAt] = useState(null);
  useEffect(() => {
    if (!ready) return;
    (async () => { if (await nativeShell()) setAlarmAt(await pendingWakeAlarm()); })();
  }, [ready]);
  // Next real occurrence of a minute-of-day: today if still ahead, else tomorrow.
  const nextOccurrence = (minOfDay) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setMinutes(minOfDay);
    if (d.getTime() <= Date.now() + 60000) d.setDate(d.getDate() + 1);
    return d;
  };
  const setWake = async (minOfDay, label) => {
    if (!(await ensurePermission())) { flash(tx('Allow notifications first (Settings → Sync).', 'فعّل الإشعارات أولًا (الإعدادات ← المزامنة).')); return; }
    const at = nextOccurrence(minOfDay);
    if (await scheduleWakeAlarm(at, label)) { setAlarmAt(at); flash(`${tx('Alarm set for', 'ضُبط المنبه على')} ${fmtTime(mm2(minOfDay))}`); }
    else flash(tx("Couldn't set the alarm.", 'تعذّر ضبط المنبه.'));
  };
  const clearWake = async () => { await cancelWakeAlarm(); setAlarmAt(null); flash(tx('Alarm cancelled.', 'أُلغي المنبه.')); };

  /* ---- overdue actions ---- */
  const completeOverdue = async (item) => {
    const wsISO = fmtISO(item.ws);
    const cur = await readWeek(wsISO);
    await writeWeek(wsISO, { ...cur, tasks: (cur.tasks || []).map((x) => (x.id === item.t.id ? { ...x, done: true } : x)) });
    setOverdue((prev) => prev.filter((x) => x.t.id !== item.t.id));
    await awardTaskDone(item.t, item.date); // late by definition — pays half
  };
  const completeAllOverdue = async () => {
    if (!overdue.length || odBusy) return; setOdBusy(true);
    const byWeek = {}; for (const it of overdue) (byWeek[fmtISO(it.ws)] = byWeek[fmtISO(it.ws)] || []).push(it);
    for (const [wsISO, list] of Object.entries(byWeek)) {
      const ids = new Set(list.map((x) => x.t.id));
      const cur = await readWeek(wsISO);
      await writeWeek(wsISO, { ...cur, tasks: (cur.tasks || []).map((x) => (ids.has(x.id) ? { ...x, done: true } : x)) });
    }
    let earned = 0;
    for (const it of overdue) {
      const ctx = lateCtx();
      const gross = Math.max(0, taskWorth(it.t) - paidForTask(it.t.id));
      const amount = latePay(gross);
      const e = await award(ledgerRef.current, { iso: fmtISO(ctx.today), ref: `task:${it.t.id}`, kind: 'task', amount, title: it.t.title, meta: { late: true } });
      if (e) { ledgerRef.current = [...ledgerRef.current, e]; earned += amount; }
    }
    await refreshLedger();
    setOverdue([]); setOdBusy(false); bumpRefresh();
    flash(earned ? `${tx('Overdue cleared — all marked done.', 'تم إنجاز كل المتأخرات.')} +${earned}` : tx('Overdue cleared — all marked done.', 'تم إنجاز كل المتأخرات.'));
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
  /* Pull everything overdue onto today, keeping the order it is listed in
     (oldest first) and landing it after whatever today already holds. */
  const moveAllOverdueToToday = async () => {
    if (!overdue.length || odBusy) return; setOdBusy(true);
    const wsd = settings.weekStartDay;
    const today = logicalDayMid();
    const destISO = fmtISO(startOfWeek(today, wsd));
    const destDay = Math.round((today - startOfWeek(today, wsd)) / 86400000);

    const ctx = lateCtx();

    const byWeek = {}; for (const it of overdue) (byWeek[fmtISO(it.ws)] = byWeek[fmtISO(it.ws)] || []).push(it);
    // Read every source week before writing any of it — today is often both a
    // source and the destination, and re-reading mid-flight would pick up the
    // half-finished version.
    const weeks = {}; for (const wsISO of Object.keys(byWeek)) weeks[wsISO] = await readWeek(wsISO);
    // Take the live copies in the order they are shown, not the snapshot the
    // scan captured, so an edit made since then travels with the task.
    const moving = [];
    for (const it of overdue) {
      const found = ((weeks[fmtISO(it.ws)] || {}).tasks || []).find((x) => x.id === it.t.id);
      if (found) moving.push(found);
    }
    for (const [wsISO, list] of Object.entries(byWeek)) {
      const ids = new Set(list.map((x) => x.t.id));
      await writeWeek(wsISO, { ...weeks[wsISO], tasks: (weeks[wsISO].tasks || []).filter((x) => !ids.has(x.id)) });
    }

    const dest = await readWeek(destISO);
    const kept = dest.tasks || [];
    // One base for the whole day rather than per block: order values come from
    // several eras of this code and aren't on a common scale, so the only safe
    // claim is "after everything already here".
    const base = kept.reduce((m, x) => (x.day === destDay ? Math.max(m, Number(x.order) || 0) : m), 0) + 1;
    // `pushes` is the dread signal the points weighting reads. It counts here
    // and nowhere else: a task you keep shoving forward is the hardest thing
    // on the list, and it should be worth more when you finally do it.
    const added = moving.map((t, i) => ({ ...pushToToday(t, ctx), day: destDay, order: base + i, pushes: (Number(t.pushes) || 0) + 1 }));
    await writeWeek(destISO, { ...dest, tasks: [...kept, ...added] });

    setOverdue([]); setOdBusy(false); bumpRefresh();
    flash(added.length === 1
      ? tx('Moved to today.', 'تم النقل لليوم.')
      : tx(`${added.length} tasks moved to today.`, `تم نقل ${added.length} مهام لليوم.`));
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
    if (isDesktop()) {
      const mins = Math.max(1, Math.round((endsAt - now) / 60000));
      // Habits come through here too, and a habit id is not a task id — only
      // pass one the planner can actually tick off afterwards.
      const known = (weekRef.current.tasks || []).some((x) => x.id === task.id);
      window.rhythmFocus.startWork({ task: task.title || 'Focus', workMin: mins, allowed: [], taskId: known ? task.id : null });
      setView('focus');
      return;
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
        if (el.dataset.dropday && kind === 'task') return { type: 'day', iso: el.dataset.dropday };
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
        } else if (d.over.type === 'day') moveTaskToDate(d.id, d.over.iso);
        else if (d.over.type === 'pool') taskToPool(d.id);
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
    if (!settings.apiKey && !settings.groqKey && !brokerFrom(settings)) { setParseError(tx('The sorter needs a key — add a free Gemini key under Settings → AI sorting (aistudio.google.com/apikey). Stored only on this device.', 'يحتاج الفرز إلى مفتاح — أضف مفتاح Gemini مجانيًا من الإعدادات ← الفرز الذكي (aistudio.google.com/apikey). يُحفظ على هذا الجهاز فقط.')); return; }
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
      // Shared transport: Gemini primary, Groq fallback on outages — one
      // implementation for the sorter, the chat and the estimator, so they
      // can never disagree about how to reach a model.
      let text;
      try {
        text = await callAssistant({ apiKey: settings.apiKey, groqKey: settings.groqKey, broker: brokerFrom(settings), system, messages: [{ role: 'user', content: dump.trim() }], maxTokens: 4096 });
      } catch (e) {
        setParseError(e.code === 'rate'
          ? tx('Free-tier limit hit (per-minute or daily). Wait a minute and retry — daily quotas reset at midnight Pacific.', 'تم بلوغ الحد المجاني (بالدقيقة أو اليومي). انتظر دقيقة وأعد المحاولة — تتجدد الحصة اليومية منتصف الليل بتوقيت المحيط الهادئ.')
          : e.code === 'pool_auth' ? POOL_AUTH_MSG()
            : `${tx('Sorter request failed', 'فشل طلب الفرز')} (${e.message || e}). ${tx('Add items by hand instead.', 'أضف العناصر يدويًا.')}`);
        setParsing(false); return;
      }
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
  const stripMax = addDays(navMax, 6);
  const clampDate = (d) => (d < navMin ? navMin : d > stripMax ? stripMax : d);
  /* Selecting a date picks the week that owns it behind the scenes; every task
     operation keeps working on "the displayed week" exactly as before. */
  const selectDate = (d) => {
    const dd = clampDate(d);
    const ws = startOfWeek(dd, settings.weekStartDay);
    setWeekStart(ws);
    setSelectedDay(Math.round((dd - ws) / 86400000));
  };
  const shiftStrip = (n) => {
    let ns = addDays(stripStart, n);
    if (ns < navMin) ns = navMin;
    if (addDays(ns, 6) > stripMax) ns = addDays(stripMax, -6);
    setStripStart(ns);
    selectDate(addDays(selectedDate, Math.round((ns - stripStart) / 86400000)));
  };
  const canPrev = stripStart > navMin;
  const canNext = addDays(stripStart, 6) < stripMax;
  const goToday = () => { const today = logicalDayMid(); setStripStart(addDays(today, -1)); selectDate(today); };
  const rangeLabel = () => { const end = addDays(stripStart, 6); return `${mon(stripStart.getMonth())} ${stripStart.getDate()} – ${mon(end.getMonth())} ${end.getDate()}`; };
  /* Which week document owns a date — live state when it is one of the loaded
     ones, the session cache otherwise, so chip counts stay right across the
     boundary the strip no longer shows. */
  const weekDocFor = (d) => {
    const wsISO = fmtISO(startOfWeek(d, settings.weekStartDay));
    if (wsISO === fmtISO(weekStart)) return week;
    if (todayData && wsISO === fmtISO(startOfWeek(logicalDayMid(), settings.weekStartDay))) return todayData;
    return weeksRef.current[wsISO] || { tasks: [] };
  };
  const dateMeta = (d) => {
    const ws = startOfWeek(d, settings.weekStartDay);
    const idx = Math.round((d - ws) / 86400000);
    const dt = (weekDocFor(d).tasks || []).filter((t) => t.day === idx);
    return { date: d, iso: fmtISO(d), label: wd(d.getDay()), num: d.getDate(), total: dt.length, done: dt.filter((t) => t.done).length, isToday: sameDay(d, logicalDayMid()) };
  };

  /* ---- "right now" derivation ----
     NB: this runs before the not-ready bail-out below, because the Now-queue
     notification effects live down here and hooks must run in the same order
     on every render. Every value it reads has a safe default, so computing it
     once against empty state before `ready` flips is harmless. */
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
  /* ---- calendars ----
     Refreshed on boot and every half hour the app stays open. A feed is a
     file over HTTP: there is nothing to subscribe to, and asking more often
     than the calendar changes is just noise on someone's connection. */
  const calFeedsRef = useRef([]);
  const refreshCalendars = useCallback(async (feeds, { force = false } = {}) => {
    const list = feeds || calFeedsRef.current;
    if (!list.length) { setCalInstances([]); setCalReport([]); return []; }
    setCalBusy(true);
    const report = await refreshAll(list, { apiBase: apiBase(), force });
    setCalReport(report);
    setCalInstances(await loadInstances(list));
    setCalBusy(false);
    return report;
  }, []);
  useEffect(() => { calFeedsRef.current = calFeeds; }, [calFeeds]);

  const persistFeeds = useCallback(async (feeds) => {
    setCalFeeds(feeds);
    calFeedsRef.current = feeds;
    await saveFeeds(feeds);
    markDirty('planner:calendars');
    setCalInstances(await loadInstances(feeds));
    return feeds;
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    let alive = true;
    (async () => {
      const feeds = await loadFeeds();
      if (!alive) return;
      setCalFeeds(feeds);
      calFeedsRef.current = feeds;
      setCalInstances(await loadInstances(feeds));
      refreshCalendars(feeds);
    })();
    const id = setInterval(() => refreshCalendars(calFeedsRef.current), 30 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, [ready, refreshCalendars]);

  /* Assignments load once and are pruned against the live project list: a
     deleted project would otherwise leave meetings filed under nothing, which
     reads as a bug rather than as an empty project. */
  useEffect(() => {
    if (!ready) return;
    (async () => {
      const m = await loadCalProjects();
      const live = (settingsRef.current.projects || []).map((p) => p.id);
      setCalProjects(Object.keys(m).length ? await pruneCalProjects(m, live) : m);
    })();
  }, [ready]);

  const assignCalProject = useCallback(async (seriesKey, projectId) => {
    setCalProjects(await setCalProject(calProjects, seriesKey, projectId));
    flash(projectId ? tx('Filed.', 'تم الإسناد.') : tx('Cleared.', 'أُزيل الإسناد.'));
  }, [calProjects]);

  /* Tasks for whatever the calendar is showing. A month spans up to six week
     documents, so this reads them rather than assuming the displayed week —
     readWeek is session-cached, so paging back and forth costs nothing after
     the first look. */
  useEffect(() => {
    if (!ready || view !== 'calendar') return;
    let cancelled = false;
    (async () => {
      const [fromMs, toMs] = rangeOf(calMode, calDate, settings.weekStartDay);
      const out = {};
      const seen = new Set();
      for (let t = fromMs; t < toMs; t += 86400000) {
        const d = new Date(t);
        const wsISO = fmtISO(startOfWeek(d, settings.weekStartDay));
        if (seen.has(wsISO)) continue;
        seen.add(wsISO);
        const wk = await readWeek(wsISO);
        const ws = parseISO(wsISO);
        for (const task of wk.tasks || []) {
          const iso = fmtISO(addDays(ws, Number(task.day) || 0));
          (out[iso] = out[iso] || []).push(task);
        }
      }
      if (!cancelled) setCalTasks(out);
    })();
    return () => { cancelled = true; };
  }, [ready, view, calMode, calDate, settings.weekStartDay, refresh, localVersion]);

  /* projectTaskList only sees weeks already in the session cache, which is
     fine for a summary line and wrong for a board — a card in a week nobody
     happened to open would simply not be there, and a board that silently
     omits cards is worse than no board. So opening one sweeps a window of
     weeks into the cache first. Bounded rather than unbounded: the planner's
     own navigation window is what the rest of the app considers reachable. */
  const BOARD_WEEKS_BACK = 12, BOARD_WEEKS_FWD = 12;
  useEffect(() => {
    if (!ready || !boardProject) { setBoardReady(false); return; }
    let cancelled = false;
    (async () => {
      const here = startOfWeek(logicalDayMid(), settings.weekStartDay);
      for (let i = -BOARD_WEEKS_BACK; i <= BOARD_WEEKS_FWD; i++) {
        if (cancelled) return;
        await readWeek(fmtISO(addDays(here, i * 7)));
      }
      if (!cancelled) { setBoardReady(true); bumpRefresh(); }
    })();
    return () => { cancelled = true; };
  }, [ready, boardProject, settings.weekStartDay]);

  /* Every sticky bar below the app header hangs off --hdr-h, and the header
     wraps to two lines on a narrow screen — a hard-coded height would let the
     board's own bar slide underneath it exactly where the screen is smallest.
     Measured instead, and kept measured. */
  const hdrRef = useRef(null);
  useEffect(() => {
    const el = hdrRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const apply = () => document.documentElement.style.setProperty('--hdr-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener('resize', apply);
    return () => { ro.disconnect(); window.removeEventListener('resize', apply); };
  }, [ready]);

  useEffect(() => { if (view !== 'projects') setBoardProject(null); }, [view]);

  const moveBoardCard = useCallback((card, col) => {
    const proj = (settingsRef.current.projects || []).find((x) => x.id === boardProject);
    if (!isMove(card, col, columnsOf(proj))) return;
    // Through the same fields the rest of the app reads, so a card moved to
    // Done is genuinely a task ticked off.
    patchProjectTask(card, patchFor(col));
  }, [weekStart, boardProject]);

  const calSettings = settings.calendar || {};
  // What the scheduler must not schedule over, for the day being looked at.
  const calBusyFor = useCallback(
    (date) => busyOn(calInstances, date, { includeAllDay: calSettings.includeAllDay === true }),
    [calInstances, calSettings.includeAllDay]
  );
  const selectedDayEvents = useMemo(
    () => eventsOn(calInstances, addDays(weekStart, selectedDay)),
    [calInstances, weekStart, selectedDay]
  );
  /* The day flow owns the meetings now: each timed event is assigned to the
     prayer block its start falls in and handed to that BlockRow, where it is
     tucked between the tasks by clock time. All-day events stay in a strip —
     they do not occupy an hour, so they have no seat in the timeline. */
  const selDayStartMs = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()).getTime();
  const selMinOf = (ms) => Math.max(0, Math.min(1439, Math.round((ms - selDayStartMs) / 60000)));
  const allDayEvents = useMemo(() => selectedDayEvents.filter((e) => e.allDay), [selectedDayEvents]);
  const eventsByBlock = useMemo(() => {
    const out = {};
    for (const e of selectedDayEvents) {
      if (e.allDay) continue;
      const startMin = selMinOf(e.startMs);
      const endMin = e.endMs > selDayStartMs + 86400000 ? 1439 : selMinOf(e.endMs);
      const bid = activeBlockAt(timings, startMin);
      const key = calKey(e);
      (out[bid] = out[bid] || []).push({ ...e, startMin, endMin, key, done: !!((calDone[fmtISO(selectedDate)] || {})[key]) });
    }
    for (const bid of Object.keys(out)) out[bid].sort((a, b) => a.startMin - b.startMin);
    return out;
  }, [selectedDayEvents, timings, selDayStartMs, calDone]); // eslint-disable-line

  /* ---- Trello ----
     Refreshed alongside the calendars. Cards are shown, never imported: one
     becomes a Rhythm task only when the person presses the button, and the
     card itself is left exactly as it was. */
  const refreshTrelloCards = useCallback(async (cfg, { force = false } = {}) => {
    const t = cfg || settingsRef.current.trello || {};
    if (!t.key || !t.token || !(t.boards || []).length) { setTrelloCards([]); setTrelloReport(null); return null; }
    setTrelloBusy(true);
    const r = await refreshTrello({ key: t.key, token: t.token }, t.boards);
    setTrelloReport(r);
    if (r.ok) setTrelloCards(r.cards);
    setTrelloBusy(false);
    return r;
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    let alive = true;
    (async () => {
      const cached = await readTrelloCache();
      if (alive && cached.cards.length) setTrelloCards(cached.cards);
      refreshTrelloCards();
    })();
    const id = setInterval(() => refreshTrelloCards(), 30 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, [ready, refreshTrelloCards]);

  const trelloDue = useMemo(
    () => dueCards(trelloCards, { withinDays: (settings.trello || {}).withinDays ?? 14 }),
    [trelloCards, settings.trello]
  );
  /* Cards due on the day being looked at sit inside the timeline at their due
     hour, next to everything else that hour holds; the rest of the fortnight
     stays in its own strip below. */
  const trelloToday = useMemo(() => trelloDue.filter((c) => c.dueMs && sameDay(new Date(c.dueMs), selectedDate)), [trelloDue, selectedDate]);
  const trelloLater = useMemo(() => trelloDue.filter((c) => !(c.dueMs && sameDay(new Date(c.dueMs), selectedDate))), [trelloDue, selectedDate]);
  const cardsByBlock = useMemo(() => {
    const out = {};
    for (const c of trelloToday) {
      const dueMin = selMinOf(c.dueMs);
      const bid = activeBlockAt(timings, dueMin);
      (out[bid] = out[bid] || []).push({ ...c, dueMin });
    }
    for (const bid of Object.keys(out)) out[bid].sort((a, b) => a.dueMin - b.dueMin);
    return out;
  }, [trelloToday, timings, selDayStartMs]);
  /* Today's meetings, as Rhythm sees them: read-only toward the calendar, but
     checkable, focusable, and present in Now once their hour arrives.
       - running now and unchecked  → the "In a meeting" live card
       - ended and unchecked        → a queue item at its clock position, so a
                                      meeting can no more silently vanish than
                                      a task can
       - not started yet            → nowhere in Now (it shows when time comes)
       - checked                    → done, wherever it was */
  const todayEventsAll = useMemo(() => eventsOn(calInstances, todayMid), [calInstances, fmtISO(todayMid)]); // eslint-disable-line
  const calDoneToday = calDone[fmtISO(todayMid)] || {};
  const timedToday = todayEventsAll
    .filter((e) => !e.allDay)
    .map((e) => { const key = calKey(e); return { ...e, key, done: !!calDoneToday[key] }; });
  const nowMsTick = Date.now() + nowTick * 0; // nowTick keeps this live across the half-minute ticks
  const liveMeetings = timedToday.filter((m) => !m.done && m.startMs <= nowMsTick && m.endMs > nowMsTick);
  const pastMeetings = timedToday.filter((m) => !m.done && m.endMs <= nowMsTick);
  const startedOrDoneMeetings = timedToday.filter((m) => m.done || m.startMs <= nowMsTick);
  const fmtMs = (ms) => fmtTime(new Date(ms).toTimeString().slice(0, 5));
  const meetingFocusMin = (m) => Math.max(1, Math.round((m.endMs - Math.max(m.startMs, Date.now())) / 60000));
  // A card becomes an ordinary task in the block the day is looking at. It
  // keeps no link back: Rhythm has read access to that board and nothing more,
  // so pretending the two stay in step would be a lie.
  const addTrelloCard = async (card) => {
    await addTaskOnDate(fmtISO(addDays(weekStart, selectedDay)), activeBlock.id, card.title);
    setTrelloAdded((prev) => new Set(prev).add(card.id));
    flash(tx('Added to the day.', 'أُضيفت إلى اليوم.'));
  };

  /* ---- focus suite (desktop only) ----
     What can be focused on: today's unfinished tasks, sized by their own slot
     when they have one and by what past rounds taught us when they don't. A
     vaulted task is left out — its point is a time window, not a work session. */
  const focusTasks = [
    ...nowList
      .filter((t) => !t.done && !hasVault(t))
      .map((t) => ({ id: t.id, title: t.title, minutes: spanOf(t) || durationFor(t.title) || null, when: timeLabel(t) })),
    // Meetings still ahead or running: a round sized to what remains of them.
    ...timedToday
      .filter((m) => !m.done && m.endMs > Date.now())
      .map((m) => ({ id: `cal:${m.key}`, title: m.summary || tx('Meeting', 'اجتماع'), minutes: meetingFocusMin(m), when: `${fmtMs(m.startMs)}–${fmtMs(m.endMs)}` })),
  ];
  // Measured time is stronger evidence than a slot the person drew, so it is
  // written after toggleDone's own guess — but still as 'kept', so a duration
  // they typed themselves is never overwritten by a round that ran short.
  const focusMarkDone = (id, minutes) => {
    const t = (weekRef.current.tasks || []).find((x) => x.id === id);
    if (!t) return;
    if (!t.done) toggleDone(id);
    rememberDuration(t.title, minutes, 'kept');
  };
  const focusLearn = (title, minutes) => { rememberDuration(title, minutes, 'kept'); };
  useRoundEnded((entry) => { setPendingRound(entry); setView('focus'); });

  const nowStart = cleanTime(todayTimings[activeBlock.startKey]) || '';
  const nowEnd = activeBlock.endKey ? cleanTime(todayTimings[activeBlock.endKey]) || '' : '';
  const clockLabel = `${((now.getHours() + 11) % 12) + 1}:${pad(now.getMinutes())} ${now.getHours() < 12 ? 'AM' : 'PM'}`;
  const nowHourFloat = now.getHours() + now.getMinutes() / 60;
  const sky = skyAt(nowHourFloat);
  // Night = after Maghrib, before Sunrise (falls back to 19:00–06:00 if timings missing)
  const maghribMin = minutesOf(todayTimings.Maghrib) ?? 19 * 60;
  const sunriseMin = minutesOf(todayTimings.Sunrise) ?? 6 * 60;
  const isNight = curMin >= maghribMin || curMin < sunriseMin;
  const theme = settings.theme || (settings.autoDark === false ? 'light' : 'auto');
  const darkOn = theme === 'dark' || (theme === 'auto' && isNight);
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
  /* Everything the assistant is allowed to name. An id that isn't in here is
     dropped by validateProposal, so this list — not the prompt — is what
     actually decides what a proposal can reach. Prayer "habits" are omitted
     deliberately: they are not real habit records, and mark_prayer exists so
     the assistant never has to pretend otherwise. */
  const chatIds = () => ({
    taskIds: (weekRef.current.tasks || []).map((t) => t.id),
    poolIds: (poolRef.current || []).map((p) => p.id),
    habitIds: (settings.habits || []).map((h) => h.id),
    projectIds: (settings.projects || []).map((p) => p.id),
    // Names too: the model routinely answers with the one the person said.
    projects: (settings.projects || []).map((p) => ({ id: p.id, name: p.name })),
    recurringIds: (templates || []).map((t) => t.id),
    todayISO: fmtISO(todayMid),
  });
  const buildSnapshot = () => {
    const todayISO = fmtISO(todayMid);
    const projName = (t) => (settings.projects.find((p) => p.id === t.projectRef) || {}).name || (labelById(t.projectId) || {}).name || '';
    return buildDaySnapshot({
      dateLabel: `${wdFull(selectedDate.getDay())} ${selectedDate.getDate()} ${mon(selectedDate.getMonth())}`,
      dayIdx: selectedDay,
      dayNames: Array.from({ length: 7 }, (_, i) => wdFull(addDays(weekStart, i).getDay())),
      dayDates: Array.from({ length: 7 }, (_, i) => fmtISO(addDays(weekStart, i))),
      todayISO,
      timings, activeBlock: activeId,
      shownDate: fmtISO(selectedDate),
      // Sorted by day so the grouping headers come out in order; the week is
      // exactly the set of ids chatIds() will accept, so the two agree.
      tasks: (week.tasks || []).slice().sort((a, b) => (a.day - b.day) || (a.order - b.order)).map((t) => ({
        id: t.id, date: fmtISO(addDays(weekStart, Number(t.day) || 0)),
        block: t.block, time: timeLabel(t), done: t.done, title: t.title, project: projName(t),
        // Numbered rather than id'd: complete_step names a position, which
        // costs one integer instead of a uid per subtask in every snapshot.
        steps: (t.subtasks || []).map((sub) => ({ title: sub.title, done: !!sub.done })),
      })),
      pool: (pool || []).map((p) => ({ id: p.id, title: p.title, done: !!p.done })),
      recurring: (templates || []).map((t) => ({ id: t.id, title: t.title, block: t.block, time: t.start ? `${t.start}${t.end ? `-${t.end}` : ''}` : '' })),
      habits: [...prayerHabits, ...(settings.habits || [])].map((h) => ({ id: h.id, name: h.name, block: h.block || 'morning', streak: habitStreak(h, todayISO), doneToday: habitDoneOn(h, todayISO), builtin: !!h.prayer })),
      prayersDone: PRAYER_BLOCKS.filter((pid) => prayersToday[pid]),
      overdue: (overdue || []).map((o) => ({ title: o.t.title, when: `${wd(o.date.getDay())} ${o.date.getDate()} ${mon(o.date.getMonth())}` })),
      projects: (settings.projects || []).map((p) => {
        const pc = projectPace(p);
        const status = p.completedAt ? 'completed' : pc.notStarted ? 'not started' : pc.onPace === true ? 'on pace' : pc.onPace === false ? 'behind' : 'in progress';
        return { id: p.id, name: p.name, target: p.target, done: pc.done, unit: p.unit || 'units', status, perDay: pc.perDay ? Math.ceil(pc.perDay) : null, daysLeft: pc.daysLeft };
      }),
      labels: (settings.labels || []).map((l) => l.name),
      rewards: (settings.rewards || []).map((r) => ({ id: r.id, name: r.name, cost: r.cost })),
      balance,
      view,
      alarm: alarmAt ? `${pad(alarmAt.getHours())}:${pad(alarmAt.getMinutes())}` : '',
      options: { lang: settings.lang, theme: settings.theme || 'auto', time24: !!settings.time24, prayerGate: settings.prayerGate !== false },
    });
  };
  const sendChat = async () => {
    const q = chatInput.trim();
    if (!q || chatBusy) return;
    if (!settings.apiKey && !settings.groqKey && !brokerFrom(settings)) { setChatErr(tx('The assistant needs an API key — add one under Settings → Backup → AI sorting (Gemini has a free tier).', 'يحتاج المساعد إلى مفتاح — أضفه من الإعدادات ← النسخ ← الفرز الذكي (لدى Gemini خطة مجانية).')); return; }
    setChatErr(''); setChatBusy(true);
    const prior = chatMsgs.slice(-6).map((m) => ({ role: m.role, content: m.text }));
    setChatMsgs((prev) => [...prev, { role: 'user', text: q }]);
    setChatInput('');
    try {
      const messages = [...prior, { role: 'user', content: `Current state of my planner:\n\n${buildSnapshot()}\n\n---\n${q}` }];
      const text = await callAssistant({ apiKey: settings.apiKey, groqKey: settings.groqKey, broker: brokerFrom(settings), system: ASSISTANT_SYSTEM, messages });
      const { reply, proposals } = parseAssistantReply(text, chatIds());
      setChatMsgs((prev) => [...prev, { role: 'assistant', text: reply, proposals, applied: {} }]);
    } catch (e) {
      setChatErr(e.code === 'rate'
        ? tx('Rate limit hit — wait a moment and try again.', 'تم بلوغ حد المعدل — انتظر قليلًا وأعد المحاولة.')
        : e.code === 'pool_auth' ? POOL_AUTH_MSG()
          : tx(`Assistant unavailable (${e.message || e}).`, `المساعد غير متاح (${e.message || e}).`));
    }
    setChatBusy(false);
  };
  /* ---------------------------------------------------------------- */
  /*  Applying what the assistant proposed                              */
  /* ---------------------------------------------------------------- */
  /* Applying is always a deliberate act by the person — the model never
     reaches the plan on its own. What HAS changed is the reach: an approved
     proposal can now touch anything the app itself can, so this is one
     dispatcher rather than a five-line if-chain, and every branch goes
     through the same helper the buttons use. Going through toggleDone rather
     than setting done:true is the whole reason a task the assistant ticks off
     still pays its points.

     Returns true when the change landed. False means "not applied" — the
     proposal keeps its buttons instead of claiming a change that never
     happened. */

  // A task's label is written by name; the label list is created on demand,
  // exactly as the brain-dump sorter does it.
  const labelIdFor = (name) => {
    if (!name) return null;
    const cur = settingsRef.current.labels || [];
    const found = cur.find((l) => (l.name || '').toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const np = { id: uid(), name, color: LABEL_SWATCHES[cur.length % LABEL_SWATCHES.length] };
    setSettings((prev) => { const n = { ...prev, labels: [...(prev.labels || []), np] }; saveKey('planner:settings', n); return n; });
    return np.id;
  };
  // Functional, so several approved proposals in a row can't each write over
  // the one before from a stale snapshot.
  const patchSettings = (patch) => setSettings((prev) => { const n = { ...prev, ...patch }; saveKey('planner:settings', n); return n; });

  // Where an absolute date lands in the week on screen, or -1 for elsewhere.
  const dayIdxOf = (iso) => {
    const d = parseISO(iso);
    if (!d || Number.isNaN(d.getTime())) return -1;
    const i = Math.round((d - weekStart) / 86400000);
    return i >= 0 && i <= 6 ? i : -1;
  };
  const liveTask = (id) => (weekRef.current.tasks || []).find((t) => t.id === id) || null;

  const applyAction = async (p) => {
    switch (p.kind) {
      /* ---- tasks on a day ---- */
      case 'add_task':
        await addTaskOnDate(p.date, p.block, p.title, {
          start: p.start || '', end: p.end || '', subtasks: p.steps || null,
          // Two different things that both read as "project" in conversation:
          // projectId is the coloured label, projectRef is the long-term
          // project with a target. The editor's Project dropdown writes the
          // second one, so that is what "assign it to my book project" means.
          projectId: labelIdFor(p.label), projectRef: p.project || null,
        });
        return true;
      /* One sentence, many days. Sequential on purpose: putTaskOnDate reads
         weekRef/weeksRef and persistWeek writes them back synchronously, so
         each task sees the one before it — a Promise.all here would have every
         write build on the same stale week and keep only the last. */
      case 'add_task_series': {
        const dates = seriesDates(p);
        if (!dates.length) return false;
        const labelId = labelIdFor(p.label);
        for (const iso of dates) {
          await addTaskOnDate(iso, p.block, p.title, {
            start: p.start || '', end: p.end || '',
            projectId: labelId, projectRef: p.project || null,
          });
        }
        flash(`${dates.length} × "${p.title}" ${tx('added.', 'أُضيفت.')}`);
        return true;
      }
      // Every date here is absolute and may land outside the week on screen —
      // "move it to Saturday" on a Friday means NEXT Saturday, a different
      // week document. Routing through the date-aware helpers is what makes
      // that work; a bare day index could only ever address the displayed
      // week, and 0 would silently mean the Saturday six days BEHIND.
      case 'move_task':
        if (!liveTask(p.taskId)) return false;
        mutateTask(p.taskId, (t) => ({ ...t, block: p.block }));
        await moveTaskToDate(p.taskId, p.date);
        return true;
      case 'edit_task': {
        if (!liveTask(p.taskId)) return false;
        const patch = {};
        if (p.title) patch.title = p.title;
        // A hand-given time is the person's, so it drops the auto-slot mark
        // the same way editing it in the task editor would.
        if (p.start) { patch.start = p.start; patch.time = ''; patch.autoSlot = null; }
        if (p.end) { patch.end = p.end; patch.time = ''; patch.autoSlot = null; }
        const label = p.label ? labelIdFor(p.label) : null;
        if (label) patch.projectId = label;
        if (!Object.keys(patch).length) return false;
        mutateTask(p.taskId, (t) => ({ ...t, ...patch }));
        return true;
      }
      case 'complete_task': { const t = liveTask(p.taskId); if (!t) return false; if (!t.done) toggleDone(p.taskId); return true; }
      case 'reopen_task': { const t = liveTask(p.taskId); if (!t) return false; if (t.done) toggleDone(p.taskId); return true; }
      case 'delete_task': if (!liveTask(p.taskId)) return false; removeTask(p.taskId); return true;
      case 'task_to_backlog': if (!liveTask(p.taskId)) return false; taskToPool(p.taskId); return true;
      case 'add_step':
        if (!liveTask(p.taskId)) return false;
        mutateTask(p.taskId, (t) => ({ ...t, subtasks: [...(t.subtasks || []), ...mkSubs([p.title])] }));
        return true;
      case 'complete_step': {
        // The model names a position, not an id — that is what the snapshot
        // showed it. Resolve it against the live task, and refuse if the list
        // has changed underneath.
        const t = liveTask(p.taskId);
        const sub = t && (t.subtasks || [])[p.step - 1];
        if (!sub) return false;
        if (!sub.done) toggleSub(p.taskId, sub.id);
        return true;
      }

      /* ---- backlog ---- */
      case 'add_backlog': addPoolItem(p.title, { subtasks: p.steps || null }); return true;
      case 'backlog_to_day':
        if (!(poolRef.current || []).some((x) => x.id === p.poolId)) return false;
        await poolToDayOnDate(p.poolId, p.date, p.block);
        return true;
      case 'complete_backlog': {
        const it = (poolRef.current || []).find((x) => x.id === p.poolId);
        if (!it) return false;
        if (!it.done) togglePoolDone(p.poolId);
        return true;
      }
      case 'delete_backlog':
        if (!(poolRef.current || []).some((x) => x.id === p.poolId)) return false;
        removePoolItem(p.poolId);
        return true;

      /* ---- recurring task definitions ---- */
      case 'add_recurring': addTemplate({ title: p.title, block: p.block, start: p.start || '', end: p.end || '', projectId: labelIdFor(p.label) }); return true;
      case 'recurring_to_day': {
        const tpl = (templates || []).find((t) => t.id === p.recurringId);
        if (!tpl) return false;
        // Copied by value, exactly as templateToDay does — a recurring task is
        // a definition, and editing it later must not reach into what it made.
        await addTaskOnDate(p.date, p.block || tpl.block, tpl.title, {
          projectId: tpl.projectId, start: tpl.start || '', end: tpl.end || '', time: tpl.time || '',
          templateId: tpl.id, subtasks: [...(tpl.subtasks || [])],
        });
        return true;
      }
      case 'delete_recurring':
        if (!(templates || []).some((t) => t.id === p.recurringId)) return false;
        delTemplate(p.recurringId);
        return true;

      /* ---- habits and prayers ---- */
      case 'add_habit': { const h = addHabit(); updHabit(h.id, { name: p.name, block: p.block }); return true; }
      case 'mark_habit':
        if (!(settingsRef.current.habits || []).some((h) => h.id === p.habitId)) return false;
        toggleAnyHabitDay(p.habitId, p.date);
        return true;
      case 'delete_habit':
        if (!(settingsRef.current.habits || []).some((h) => h.id === p.habitId)) return false;
        delHabit(p.habitId);
        return true;
      case 'mark_prayer': { const d = parseISO(p.date); if (!d) return false; await togglePrayer(p.prayer, d); return true; }

      /* ---- long-term projects ---- */
      case 'add_project': {
        const np = addProjectItem();
        updProjectItem(np.id, {
          name: p.name,
          ...(p.target ? { target: p.target } : {}),
          ...(p.unit ? { unit: p.unit } : {}),
          ...(p.deadline ? { deadline: p.deadline } : {}),
          ...(p.goal ? { goal: p.goal } : {}),
        });
        return true;
      }
      case 'log_project':
        if (!(settingsRef.current.projects || []).some((x) => x.id === p.projectId)) return false;
        logProgress(p.projectId, p.amount, p.note || '');
        return true;
      case 'complete_project':
        if (!(settingsRef.current.projects || []).some((x) => x.id === p.projectId)) return false;
        updProjectItem(p.projectId, { completedAt: fmtISO(new Date()) });
        return true;

      /* ---- points ---- */
      case 'add_reward': persistRewards((prev) => [...prev, { id: uid(), name: p.name, cost: p.cost }]); return true;

      /* ---- the day as a whole ---- */
      case 'slot_day': {
        const i = dayIdxOf(p.date);
        // Slotting reads and rewrites one week document, and that is the one
        // on screen. Rather than silently slotting the wrong day, go there and
        // leave the proposal standing for a second press.
        if (i < 0) { selectDate(parseISO(p.date)); flash(tx('Opened that day — approve again to slot it.', 'فُتح ذلك اليوم — وافق مرة أخرى لتوزيعه.')); return false; }
        await structureSelectedDay(i);
        return true;
      }
      case 'clear_slots': {
        const i = dayIdxOf(p.date);
        if (i < 0) { selectDate(parseISO(p.date)); flash(tx('Opened that day — approve again to clear it.', 'فُتح ذلك اليوم — وافق مرة أخرى لمسحه.')); return false; }
        clearSlots(i);
        return true;
      }
      case 'start_focus': { const t = liveTask(p.taskId); if (!t) return false; startFocus(t, p.minutes || 25, false); return true; }
      case 'set_alarm': { const m = minutesOf(p.at); if (m == null) return false; await setWake(m, p.label || tx('Wake up', 'استيقظ')); return true; }
      case 'cancel_alarm': await clearWake(); return true;
      case 'overdue_to_today':
        if (!overdue.length) { flash(tx('Nothing overdue.', 'لا متأخرات.')); return false; }
        await moveAllOverdueToToday();
        return true;

      /* ---- moving around, and settings ---- */
      case 'go_to_date': { const d = parseISO(p.date); if (!d) return false; selectDate(d); setView('plan'); return true; }
      case 'open_view':
        // The focus screen is the desktop shell's; on a phone there is nothing
        // behind that door, and opening a blank one is worse than saying so.
        if (p.view === 'focus' && !isDesktop()) { flash(tx('Focus mode is on the desktop app.', 'وضع التركيز في تطبيق سطح المكتب.')); return false; }
        setView(p.view);
        return true;
      case 'set_language': changeLang(p.lang); return true;
      case 'set_theme': patchSettings({ theme: p.theme }); return true;
      case 'set_option': patchSettings({ [p.option]: p.on }); return true;

      default: return false;
    }
  };

  const [applyBusy, setApplyBusy] = useState(false);
  const markApplied = (msgIdx, pIdx, state) => setChatMsgs((prev) => prev.map((m, i) => (i === msgIdx ? { ...m, applied: { ...(m.applied || {}), [pIdx]: state } } : m)));

  const applyProposal = async (msgIdx, pIdx) => {
    const msg = chatMsgs[msgIdx];
    const prop = msg?.proposals?.[pIdx];
    if (!prop || applyBusy || (msg.applied || {})[pIdx]) return;
    setApplyBusy(true);
    let ok = false;
    try { ok = await applyAction(prop); }
    catch { flash(tx('Could not apply that.', 'تعذّر التطبيق.')); }
    setApplyBusy(false);
    if (!ok) return;
    markApplied(msgIdx, pIdx, 'done');
    flash(tx('Applied.', 'تم التطبيق.'));
  };

  /* Approving one at a time is the honest default, and it stays the default.
     But dictating "move all of today to tomorrow" and then tapping eight
     buttons is not consent, it is a chore — so there is one button that walks
     the same list through the same code path, in order. Anything that refuses
     stays pending rather than being marked done. */
  const applyAllProposals = async (msgIdx) => {
    const msg = chatMsgs[msgIdx];
    if (!msg || applyBusy) return;
    const list = msg.proposals || [];
    const applied = { ...(msg.applied || {}) };
    setApplyBusy(true);
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      if (applied[i]) continue;
      try { if (await applyAction(list[i])) { applied[i] = 'done'; n++; } }
      catch { /* leave it pending, and keep going */ }
    }
    setChatMsgs((prev) => prev.map((m, ix) => (ix === msgIdx ? { ...m, applied } : m)));
    setApplyBusy(false);
    flash(n ? `${n} ${tx('applied.', 'طُبّقت.')}` : tx('Nothing could be applied.', 'تعذّر تطبيق أي شيء.'));
  };

  const dismissProposal = (msgIdx, pIdx) => markApplied(msgIdx, pIdx, 'skip');

  /* Titles the description needs and only the app knows. */
  const proposalNames = {
    task: (id) => ((weekRef.current.tasks || []).find((t) => t.id === id) || {}).title,
    pool: (id) => ((poolRef.current || []).find((x) => x.id === id) || {}).title,
    habit: (id) => ((settings.habits || []).find((h) => h.id === id) || {}).name,
    project: (id) => ((settings.projects || []).find((x) => x.id === id) || {}).name,
    recurring: (id) => ((templates || []).find((t) => t.id === id) || {}).title,
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
    // Walk back from the LOGICAL day (Fajr→Fajr), not calendar midnight, so
    // before dawn the log still ends on the day that is currently running.
    for (let i = 0; i < 366; i++) { const iso = fmtISO(addDays(todayMid, -i)); if (prayerDoneOn(pid, iso)) log[iso] = 1; }
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

  /* ---- the Now queue ----
     Derived at component level (not inside the Now view) because the Android
     notification layer mirrors it too, and must stay right whichever tab you
     are looking at. */
  const activeIdx = blockIdx(activeId);
  const habitsOf = (bid) => (settings.habits || []).filter((h) => (h.block || 'morning') === bid);
  // A task with BOTH a start and an end is a commitment to a slot, not a queue
  // item: while the clock sits inside its window it surfaces on its own,
  // wherever it happens to fall in the order. Outside that window it rejoins
  // the queue so it can't quietly disappear.
  const liveNow = nowList.filter((t) => {
    if (t.done) return false;
    const st = tStartMin(t), en = tEndMin(t);
    return st != null && en != null && inWindow(st, en, curMin);
  });
  const liveIds = new Set(liveNow.map((t) => t.id));
  const todayStartMsQ = new Date(todayMid.getFullYear(), todayMid.getMonth(), todayMid.getDate()).getTime();
  const mStartMin = (m) => Math.max(0, Math.min(1439, Math.round((m.startMs - todayStartMsQ) / 60000)));
  const pastByBlock = {};
  for (const m of pastMeetings) {
    const bid = activeBlockAt(todayTimings, mStartMin(m));
    (pastByBlock[bid] = pastByBlock[bid] || []).push(m);
  }
  for (const bid of Object.keys(pastByBlock)) pastByBlock[bid].sort((a, b) => a.startMs - b.startMs);
  const queue = [];
  for (const b of BLOCKS) {
    if (PRAYER_BLOCKS.includes(b.id) && blockIdx(b.id) <= activeIdx && !prayersToday[b.id]) queue.push({ kind: 'prayer', block: b });
    for (const h of habitsOf(b.id)) if (!habitDoneOn(h, nowHabitISO)) queue.push({ kind: 'habit', block: b, h });
    // An ended, unchecked meeting takes its place among the tasks by clock
    // time — the same tucking rule the Plan timeline uses.
    const ms = pastByBlock[b.id] || [];
    let mi = 0;
    for (const t of nowList.filter((t) => t.block === b.id && !t.done && !liveIds.has(t.id))) {
      const ts = tStartMin(t) ?? Infinity;
      while (mi < ms.length && mStartMin(ms[mi]) <= ts) queue.push({ kind: 'cal', block: b, m: ms[mi++] });
      queue.push({ kind: 'task', block: b, t });
    }
    while (mi < ms.length) queue.push({ kind: 'cal', block: b, m: ms[mi++] });
  }
  const startedPrayers = PRAYER_BLOCKS.filter((pid) => blockIdx(pid) <= activeIdx).length;
  const totalN = nowList.length + (settings.habits || []).length + startedPrayers + startedOrDoneMeetings.length;
  const doneN = totalN - queue.length - liveNow.length - liveMeetings.length;
  const next = queue[0] || null;
  // Everything up to and through the current period is clear when the head of
  // the queue belongs to a LATER block. Then it stops being "do this now" and
  // becomes a look-ahead under Next, until its period arrives.
  const nextIsLater = !!next && blockIdx(next.block.id) > activeIdx;
  const caughtUp = nextIsLater && liveNow.length === 0;

  /* ---- Android notifications (no-ops in the browser) ----
     Reminders are keyed to today's timed tasks; the ongoing card mirrors the
     Now page. Both are described as plain strings first so the effects only
     re-fire when the *content* actually changes, not on every tick. */
  const reminderPlan = todayTasks
    .filter((t) => !t.done && tStartMin(t) != null && tEndMin(t) != null)
    .map((t) => `${t.id}|${t.title}|${tStartMin(t)}`)
    .join('\n');
  const ongoingText = liveNow.length > 0
    ? { title: liveNow[0].title, body: `${tx('Happening now', 'يحدث الآن')} · ${timeLabel(liveNow[0])}` }
    : caughtUp
      ? { title: tx("You're all caught up.", 'أنجزت كل ما عليك الآن.'), body: next ? `${tx('Next', 'التالي')}: ${next.kind === 'task' ? next.t.title : next.kind === 'habit' ? next.h.name : next.kind === 'cal' ? (next.m.summary || tx('Meeting', 'اجتماع')) : bName(next.block)} · ${bName(next.block)}` : '' }
      : next
        ? { title: next.kind === 'task' ? next.t.title : next.kind === 'habit' ? next.h.name : next.kind === 'cal' ? (next.m.summary || tx('Meeting', 'اجتماع')) : tx(`${next.block.name} prayer`, `صلاة ${next.block.ar}`), body: `${bName(next.block)}${queue.length > 1 ? ` · ${queue.length - 1} ${tx('more today', 'أخرى اليوم')}` : ''}` }
        : totalN > 0 ? { title: tx('All done for today. Rest easy.', 'أنجزت كل شيء اليوم. ارتَح.'), body: '' } : null;
  const ongoingKey = ongoingText ? `${ongoingText.title} ${ongoingText.body}` : '';

  /* Home-screen widget. Same headline as the ongoing notification, plus the
     next couple of items so the widget answers "and then what?" at a glance
     without becoming the full list the Now page deliberately refuses to be. */
  const widgetLabel = (it) => (it.kind === 'task' ? it.t.title : it.kind === 'habit' ? it.h.name : it.kind === 'cal' ? (it.m.summary || tx('Meeting', 'اجتماع')) : tx(`${it.block.name} prayer`, `صلاة ${it.block.ar}`));
  const widgetUpcoming = queue.slice(1, 3).map(widgetLabel);
  const widgetPayload = ongoingText
    ? { title: ongoingText.title, body: ongoingText.body, upcoming: widgetUpcoming.length ? `${tx('then', 'ثم')}: ${widgetUpcoming.join(' · ')}` : '' }
    : null;
  const widgetKey = widgetPayload ? `${widgetPayload.title}|${widgetPayload.body}|${widgetPayload.upcoming}` : '';
  useEffect(() => {
    if (!ready) return;
    updateWidget(widgetPayload);
    /* Same payload, same trigger, out to a file Bawwab can read. It gates the
       phone by the clock and has never known what the hour was for, so a
       refusal there is subtraction and nothing else — this gives it something
       to offer instead. Failure is swallowed inside; the planner does not
       depend on it. */
    writeNowFile(widgetPayload);
  }, [ready, widgetKey]); // eslint-disable-line

  useEffect(() => {
    if (!ready) return;
    let stop = false;
    (async () => {
      if (!(await nativeShell())) return;      // browser: nothing to do
      if ((await permissionState()) !== 'granted') return; // never prompt from an effect
      if (stop) return;
      const day = todayMid;
      await syncReminders(todayTasks
        .filter((t) => !t.done && tStartMin(t) != null && tEndMin(t) != null)
        .map((t) => {
          const at = new Date(day); at.setHours(0, 0, 0, 0); at.setMinutes(tStartMin(t));
          return { id: t.id, title: t.title, body: `${tx('Starts now', 'يبدأ الآن')} · ${timeLabel(t)}`, at };
        }));
    })();
    return () => { stop = true; };
  }, [ready, reminderPlan]); // eslint-disable-line

  useEffect(() => {
    if (!ready) return;
    let stop = false;
    (async () => {
      if (!(await nativeShell())) return;
      if ((await permissionState()) !== 'granted') return;
      if (stop) return;
      await setOngoing(ongoingText);
    })();
    return () => { stop = true; };
  }, [ready, ongoingKey]); // eslint-disable-line

  // Probe notification support/permission for Settings (native only).
  // Deliberately has NO cancellation guard. An earlier version bailed on a
  // `stop` flag before the final setState, so whenever the effect re-ran while
  // the bridge calls were in flight the result was thrown away and the panel
  // sat on "checking" forever. A late setState is a harmless no-op in React 18;
  // a stranded UI is not. `probes` counts completions so the panel can show
  // whether this is actually running.
  const probeNotify = useCallback(async () => {
    const stamp = (patch) => setNotifyState((p) => ({ ...p, ...patch }));
    const info = platformInfo();
    stamp(info);
    // Step tracing: the state is stamped SYNCHRONOUSLY before each await, so
    // if any bridge call never settles — even if timers were dead, defeating
    // the withTimeout guards — the readout freezes on the step's name instead
    // of an ambiguous "checking". A watchdog names the stall explicitly when
    // timers do work.
    let step = '@native';
    let finished = false;
    const dog = setTimeout(() => { if (!finished) stamp({ state: `stuck${step}` }); }, 12000);
    try {
      stamp({ state: step });
      const nat = await nativeShell();
      if (!nat) { finished = true; setNotifyState((p) => ({ ...p, ...info, supported: false, state: 'unsupported', probes: (p.probes || 0) + 1 })); return; }
      step = '@permission'; stamp({ supported: true, state: step });
      const st = await permissionState();
      step = '@pending'; stamp({ state: step });
      const pend = await pendingCount();
      finished = true;
      setNotifyState((p) => ({ ...p, supported: true, state: st, pending: pend, probes: (p.probes || 0) + 1 }));
    } catch (e) {
      finished = true;
      setNotifyState((p) => ({ ...p, supported: true, state: `error${step}: ${e && e.message ? e.message : e}`, probes: (p.probes || 0) + 1 }));
    } finally {
      clearTimeout(dog);
    }
  }, []); // eslint-disable-line
  useEffect(() => { probeNotify(); }, [ready, reminderPlan, probeNotify]);
  // Trap invisible failures: an uncaught error or unhandled rejection anywhere
  // lands in the readout instead of dying silently in the WebView console
  // nobody can see.
  useEffect(() => {
    const onErr = (ev) => setNotifyState((p) => ({ ...p, lastErr: String(ev.message || ev.reason || ev).slice(0, 140) }));
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onErr);
    return () => { window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr); };
  }, []);
  // Re-probe on resume: permission can be changed in Android settings while
  // we're backgrounded, and it self-heals a probe that failed earlier. Also
  // re-assert the ongoing card, so if Android 14+ let it be dismissed it comes
  // straight back the moment the app is touched.
  useEffect(() => {
    const onVis = () => { if (!document.hidden) { probeNotify(); repostOngoing(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [probeNotify]);
  useEffect(() => { if (ready) hookOngoingPersistence(); }, [ready]);
  const enableNotify = async () => {
    const ok = await ensurePermission();
    const st = ok ? 'granted' : await permissionState();
    const pend = await pendingCount();
    setNotifyState((p) => ({ ...p, supported: true, state: st, pending: pend }));
    if (ok) flash(tx('Reminders enabled.', 'تم تفعيل التنبيهات.'));
  };
  const testNotify = async () => {
    const r = await testNotification();
    const pend = await pendingCount();
    setNotifyState((p) => ({ ...p, test: r, pending: pend }));
    flash(r === 'sent' ? tx('Test sent.', 'تم إرسال الاختبار.') : r);
  };

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

  // Every hook has now run, so bailing out here keeps their order stable.
  if (!ready) {
    return (<div className="load-screen"><Loader2 size={18} className="spin" style={{ marginRight: 8 }} /> Loading your day…</div>);
  }
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
      <header className="hdr" ref={hdrRef}>
        <div className="brand">
          <AppIcon size={36} />
          <div className="brand-en"><strong>Rhythm <span className="ver-tag">v{APP_VERSION}</span></strong><span>{tx('plan your day around the day', 'خطّط يومك حول اليوم')}</span></div>
        </div>
        <div className="hdr-actions">
          <button className="icon pts-chip" onClick={() => setShowPoints(true)} aria-label={tx('Points', 'النقاط')} title={tx('Points', 'النقاط')}><Coins size={16} /><span>{balance}</span></button>
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
        // A key that changes whenever an item changes, so React mounts a fresh
        // node and the enter animation runs.
        const itemKeyOf = (it) => {
          if (!it) return 'none';
          if (it.kind === 'prayer') return `p:${it.block.id}`;
          if (it.kind === 'habit') return `h:${it.h.id}`;
          if (it.kind === 'cal') return `c:${it.m.key}`;
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
          if (it.kind === 'cal') { const m = it.m; return (
            <div key={k} className={`now-one-card now-item current ${cls}`}>
              <button className="tcheck big" onClick={() => advanceNow(k, () => toggleMeeting(fmtISO(todayMid), m.key))} aria-label={tx('Mark attended', 'تم الحضور')}><Circle size={22} /></button>
              <div className="now-col">
                <span className="now-item-title">{m.summary || tx('Meeting', 'اجتماع')}</span>
                <span className="now-cal-meta"><Calendar size={12} /> <span className="ttime">{fmtMs(m.startMs)}–{fmtMs(m.endMs)}</span>{m.calName ? <span className="now-cal-src"> · {m.calName}</span> : null}</span>
              </div>
            </div>
          ); }
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
                {/* The vault's whole point: the window is open, so hand it over. */}
                {vaultUnlocked(t, curMin) && (
                  <div className="vault-reveal">
                    <code className="vault-value">{t.secret}</code>
                    <button className="ghost sm" onClick={() => { navigator.clipboard?.writeText(t.secret).then(() => flash(tx('Copied.', 'تم النسخ.')), () => {}); }}><Copy size={13} /> {tx('Copy', 'نسخ')}</button>
                  </div>
                )}
                {hasVault(t) && !vaultUnlocked(t, curMin) && (
                  <span className="vault-when"><Lock size={12} /> {tx('Unlocks', 'تُفتح')} {timeLabel(t)}</span>
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
            {liveMeetings.length > 0 && (
              <div className="now-one now-live">
                <div className="now-one-top">
                  <span className="now-one-label">{tx('In a meeting', 'في اجتماع')}</span>
                  <span className="now-one-block live-tag">{tx('calendar', 'التقويم')}</span>
                </div>
                {liveMeetings.map((m) => (
                  <div key={m.key} className={`now-one-card now-item current live ${nowLeaving === `c:${m.key}` ? 'leaving' : ''}`}>
                    <button className="tcheck big" onClick={() => advanceNow(`c:${m.key}`, () => toggleMeeting(fmtISO(todayMid), m.key))} aria-label={tx('Mark attended', 'تم الحضور')}><Circle size={22} /></button>
                    <div className="now-col">
                      <span className="now-item-title">{m.summary || tx('Meeting', 'اجتماع')}</span>
                      <span className="now-cal-meta"><Calendar size={12} /> <span className="ttime">{fmtMs(m.startMs)}–{fmtMs(m.endMs)}</span>{m.calName ? <span className="now-cal-src"> · {m.calName}</span> : null}</span>
                      <div className="now-cal-actions">
                        <button className="ghost sm" onClick={() => startFocus({ id: `cal:${m.key}`, title: m.summary || tx('Meeting', 'اجتماع') }, meetingFocusMin(m))}>
                          <AlarmClock size={13} /> {tx('Focus until it ends', 'ركّز حتى نهايته')}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {nextIsLater ? (
              <div className="now-one">
                {caughtUp && <div className="now-caught"><CheckCircle2 size={18} /> {tx("You're all caught up.", 'أنجزت كل ما عليك الآن.')}</div>}
                <div className="now-one-top">
                  <span className="now-one-label">{tx('Next', 'التالي')}{` · ${tx('when', 'عند')} ${bName(next.block)}`}</span>
                  <span className="now-one-block blk-ink" style={{ '--bi-light': next.block.accentDeep, '--bi-dark': next.block.accent }}>{bName(next.block)}</span>
                </div>
                {renderCard(next, { preview: true })}
              </div>
            ) : next ? (
              <div className="now-one">
                <div className="now-one-top">
                  <span className="now-one-label">{tx('One thing at a time', 'شيء واحد في كل مرة')}{queue.length > 1 ? ` · ${queue.length - 1} ${tx('more today', 'أخرى اليوم')}` : ''}</span>
                  <span className="now-one-block blk-ink" style={{ '--bi-light': next.block.accentDeep, '--bi-dark': next.block.accent }}>{bName(next.block)}</span>
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

            {activeId === 'isha' && (() => {
              const fajrMin = minutesOf(todayTimings.Fajr);
              const plan = sleepPlan(curMin, fajrMin);
              if (!plan) return null;
              const hm = (mins) => `${Math.floor(mins / 60)}${tx('h', 'س')} ${mins % 60}${tx('m', 'د')}`;
              return (
                <div className="sleep-card">
                  <div className="sleep-h"><Moon size={14} /> {tx('Sleep', 'النوم')}
                    <span className="sleep-until">{tx('Fajr', 'الفجر')} {fmtTime(todayTimings.Fajr)} · {tx('in', 'بعد')} {hm(plan.untilFajr)}</span>
                  </div>
                  {plan.bedtimes.length > 0 && (
                    <div className="sleep-beds">
                      {plan.bedtimes.map((b) => (
                        <span key={b.cycles} className="sleep-bed">
                          <strong>{b.cycles}</strong> {tx('cycles', 'دورات')} → {tx('sleep by', 'نَم قبل')} <strong>{fmtTime(mm2(b.at))}</strong>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="sleep-now-line">
                    {plan.cyclesIfNow > 0
                      ? <>{tx('Sleeping now fits', 'النوم الآن يتسع لـ')} <strong>{plan.cyclesIfNow}</strong> {tx('full cycles — boundary wake at', 'دورات كاملة — استيقاظ عند حد الدورة')} <strong>{fmtTime(mm2(plan.alignedWake))}</strong>.</>
                      : tx('Less than one full cycle until Fajr — a short nap beats a broken cycle.', 'أقل من دورة كاملة حتى الفجر — غفوة قصيرة أفضل من دورة مقطوعة.')}
                  </p>
                  {notifyState.supported ? (
                    <div className="sleep-actions">
                      <button className="ghost sm" onClick={() => setWake(fajrMin, tx('Fajr — time to wake', 'الفجر — وقت الاستيقاظ'))}><AlarmClock size={13} /> {tx('Alarm at Fajr', 'منبه عند الفجر')}</button>
                      {plan.cyclesIfNow > 0 && plan.alignedWake !== fajrMin && (
                        <button className="ghost sm" onClick={() => setWake(plan.alignedWake, tx('Cycle boundary — time to wake', 'حد الدورة — وقت الاستيقاظ'))}><AlarmClock size={13} /> {fmtTime(mm2(plan.alignedWake))} ({plan.cyclesIfNow} {tx('cycles', 'دورات')})</button>
                      )}
                      {alarmAt && <button className="ghost sm sleep-cancel" onClick={clearWake}><X size={13} /> {tx('Alarm', 'منبه')} {fmtTime(mm2(alarmAt.getHours() * 60 + alarmAt.getMinutes()))}</button>}
                    </div>
                  ) : (
                    <p className="hint-text" style={{ margin: 0 }}>{tx('The wake alarm needs the Android app — times above still hold.', 'المنبه يحتاج تطبيق أندرويد — المواعيد أعلاه صحيحة على أي حال.')}</p>
                  )}
                  <p className="sleep-note">{tx('Arithmetic, not measurement: ~90-minute cycles plus 15 minutes to fall asleep. No phone can feel your sleep phase from the nightstand.', 'حساب لا قياس: دورات ~٩٠ دقيقة + ١٥ دقيقة للنوم. لا يمكن لهاتف أن يستشعر مرحلة نومك من على الطاولة.')}</p>
                </div>
              );
            })()}
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
                  <button className="ghost sm" onClick={moveAllOverdueToToday} disabled={odBusy}><CornerUpRight size={14} /> {tx('Move all to today', 'نقل الكل لليوم')}</button>
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
                      <span className="od-meta"><span className="od-date">{wd(it.date.getDay())} {it.date.getDate()} {mon(it.date.getMonth())}</span><span className="od-block blk-ink" style={{ '--bi-light': b.accentDeep, '--bi-dark': b.accent }}>{bName(b)}</span>{p && <span className="pdot" style={{ background: p.color }} />}{p && <span className="pname">{p.name}</span>}</span>
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
                      <span className="od-meta"><span className="od-date">{wd(date.getDay())} {date.getDate()} {mon(date.getMonth())}</span><span className="od-block blk-ink" style={{ '--bi-light': blockById(h.block || 'morning').accentDeep, '--bi-dark': blockById(h.block || 'morning').accent }}>{bName(blockById(h.block || 'morning'))}</span></span>
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
          <button className="icon" onClick={() => shiftStrip(-7)} disabled={!canPrev} aria-label={tx('Earlier days', 'أيام أسبق')}>{isRTL() ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}</button>
          <button className="today-btn" onClick={goToday}>{rangeLabel()}</button>
          <button className="icon" onClick={() => shiftStrip(7)} disabled={!canNext} aria-label={tx('Later days', 'أيام لاحقة')}>{isRTL() ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}</button>
        </div>

        {/* Continuous days: any 7 consecutive dates, week boundary invisible.
            Chips are drop targets — dragging a task onto one moves it to that
            date, whichever week document it lands in. */}
        <div className="strip">
          {Array.from({ length: 7 }, (_, i) => dateMeta(addDays(stripStart, i))).map((m) => (
            <button key={m.iso} data-dropday={m.iso}
              className={`chip ${sameDay(m.date, selectedDate) ? 'sel' : ''} ${m.isToday ? 'today' : ''} ${drag && drag.kind === 'task' && drag.over && drag.over.type === 'day' && drag.over.iso === m.iso ? 'drop' : ''}`}
              onClick={() => selectDate(m.date)}>
              <span className="chip-d">{m.label}</span><span className="chip-n">{m.num}</span>{m.total > 0 && <span className="chip-count">{m.done}/{m.total}</span>}
            </button>
          ))}
        </div>

        <div className="plan-actions-row">
          <button className="plan-day-btn" onClick={startWizard}><Sparkles size={15} /> {tx('Plan the day', 'خطّط اليوم')}</button>
          <button className="plan-day-btn slot-btn" onClick={structureSelectedDay} disabled={slotBusy} title={tx('Give every remaining task a strict time slot', 'امنح كل مهمة متبقية وقتًا محددًا')}>
            {slotBusy ? <Loader2 size={15} className="spin" /> : <Rows3 size={15} />} {slotBusy ? tx('Sizing…', 'جارٍ التقدير…') : tx('Slot the day', 'جدول اليوم')}
          </button>
          {dayHasSlots && <button className="ghost sm" onClick={clearSlots}><X size={13} /> {tx('Clear slots', 'إزالة الجدولة')}</button>}
        </div>

        {/* Timed meetings and due-today cards live INSIDE the timeline now.
            Only what has no hour of its own stays up here: all-day events, and
            Trello cards due on some other day. */}
        {allDayEvents.length > 0 && (
          <div className="cal-strip">
            <div className="cal-strip-h"><Calendar size={12} /> {tx('All day', 'طوال اليوم')}</div>
            <DayEvents events={allDayEvents} />
          </div>
        )}

        {trelloLater.length > 0 && (
          <div className="cal-strip">
            <div className="cal-strip-h"><LayoutTemplate size={12} /> {tx('Due later on Trello', 'مستحق لاحقًا في ترللو')}</div>
            <TrelloCards cards={trelloLater} onAdd={addTrelloCard} added={trelloAdded} />
          </div>
        )}

        {/* Day timeline (left) + Recurring/Backlog sidebar (right) — kept side by side so both stay visible as drop targets while dragging */}
        <div className="plan-columns">
          <div className="timeline">
            {BLOCKS.map((b) => (
              <BlockRow key={b.id} block={b}
                start={cleanTime(timings[b.startKey]) || ''} end={b.endKey ? cleanTime(timings[b.endKey]) || '' : ''}
                tasks={tasksFor(selectedDay, b.id)} labelById={labelById}
                events={eventsByBlock[b.id] || []} cards={cardsByBlock[b.id] || []}
                onAddCard={addTrelloCard} addedCards={trelloAdded}
                onToggleCalEvent={(key) => toggleMeeting(fmtISO(selectedDate), key)}
                habits={settings.habits.filter((h) => (h.block || 'morning') === b.id)}
                habitDate={fmtISO(selectedDate)} onToggleHabit={toggleHabitDay}
                current={isSelectedToday && b.id === activeId}
                prayer={isSelectedToday && PRAYER_BLOCKS.includes(b.id) ? { done: !!(week.prayers?.[selectedDay]?.[b.id]) } : null}
                onPrayer={() => togglePrayer(b.id, selectedDate)}
                onToggle={toggleDone} onToggleSub={toggleSub} onOpen={setEditing}
                onAdd={(title) => addParsedTask(title, { blockId: b.id })}
                parseHint={parseHint}
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
              onAddPool={(title) => addParsedTask(title, { toPool: true })}
              onClearDonePool={clearDonePool}
              parseHint={parseHint}
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
            {/* Speaking is how a brain dump actually happens — it is a list of
                things half-remembered on the way somewhere, not a paragraph
                anyone sits down to type. */}
            {dumpMic.available && (
              <button
                className={`mic-btn ${dumpMic.state}`}
                onClick={toggleDumpMic}
                disabled={dumpMic.state === 'transcribing' || parsing}
                style={dumpMic.state === 'listening' ? { '--mic-level': dumpMic.level } : undefined}
                aria-label={dumpMic.state === 'listening' ? tx('Stop dictating', 'أوقف الإملاء') : tx('Dictate', 'إملاء')}
                title={dumpMic.state === 'listening' ? tx('Stop dictating', 'أوقف الإملاء') : tx('Dictate', 'إملاء')}
              >
                {dumpMic.state === 'transcribing' ? <Loader2 size={16} className="spin" />
                  : dumpMic.state === 'listening' ? <Square size={14} />
                    : <Mic size={17} />}
              </button>
            )}
            <button className="primary" disabled={parsing || dumpMic.busy || !dump.trim()} onClick={runParse}>{parsing ? <><Loader2 size={15} className="spin" /> {tx('Sorting…', 'جارٍ الفرز…')}</> : <><Sparkles size={15} /> {tx('Sort it', 'افرزها')}</>}</button>
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

      {view === 'calendar' && (
        <CalendarView
          mode={calMode}
          date={calDate}
          onMode={setCalMode}
          onDate={setCalDate}
          events={calInstances}
          tasksByISO={calTasks}
          projects={settings.projects || []}
          calProjects={calProjects}
          weekStartDay={settings.weekStartDay}
          onAssign={assignCalProject}
          picked={calPicked}
          onPick={setCalPicked}
        />
      )}

      {/* A project's board takes over the Projects screen rather than opening
          in a modal: it is a work surface, and a board in a dialog on a phone
          is three columns in a letterbox. */}
      {view === 'projects' && boardProject && (() => {
        const proj = (settings.projects || []).find((x) => x.id === boardProject);
        if (!proj) return null;
        return (
          <KanbanBoard
            project={proj}
            cards={projectTaskList(proj.id).tasks}
            onMove={moveBoardCard}
            onOpenTask={openProjectTask}
            onBack={() => setBoardProject(null)}
            /* New cards land in the backlog: a board card does not need a day,
               and forcing one would make "add a task" a scheduling decision. */
            onColumns={(cols) => updProjectItem(proj.id, { columns: cols })}
            onAddTask={() => {
              const it = addPoolItem(tx('New task', 'مهمة جديدة'), {});
              if (it) { mutatePoolItem(it.id, (x) => ({ ...x, projectRef: proj.id })); setEditingPool(it.id); }
            }}
          />
        );
      })()}

      {/* PROJECTS (long-term) */}
      {view === 'projects' && !boardProject && (
        <ProjectsView
          projects={settings.projects}
          sky={sky} stars={stars} heroLight={heroLight}
          onAdd={addProjectItem} onUpd={updProjectItem} onDel={delProjectItem} onBoard={setBoardProject}
          onLog={logProgress} taskList={projectTaskList}
          onToggleTask={toggleProjectTask} onOpenTask={openProjectTask}
        />
      )}

      {/* HABITS */}
      {view === 'habits' && (
        <HabitsView
          habits={[...prayerHabits, ...settings.habits]} sky={sky} stars={stars} heroLight={heroLight} todayISO={nowHabitISO}
          onAdd={addHabit} onUpd={updHabit} onDel={delHabit} onToggleDay={toggleAnyHabitDay} onMarkTiny={markHabitTiny}
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
          vaultOpen={vaultUnlocked(editingTask, curMin)}
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

      {showPoints && (
        <PointsPanel balance={balance} ledger={ledger} rewards={settings.rewards || []}
          onClose={() => setShowPoints(false)}
          onAddReward={addReward} onUpdReward={updReward} onDelReward={delReward}
          onCashIn={cashIn} onForget={(ref) => revokeRef(ref)} onReset={resetPoints} />
      )}

      {showSettings && (
        <SettingsPanel settings={settings} onChange={persistSettings} onLang={changeLang}
          templates={templates} onAddTemplate={addTemplate} onUpdTemplate={updTemplate} onDelTemplate={delTemplate}
          onExport={buildExport} onImport={applyImport}
          onSetPin={setPin}
          sync={{ ...sync, linkWithToken, mintPhoneCode, isLinkedDevice: !!deviceToken() }}
          notify={notifyState} onEnableNotify={enableNotify} onTestNotify={testNotify} onRecheck={probeNotify}
          storageOk={storageOk} onClose={() => setShowSettings(false)}
          onClearDay={() => { const w = weekRef.current; persistWeek({ ...w, tasks: w.tasks.filter((t) => t.day !== selectedDay) }); flash(tx('Day cleared.', 'تم مسح اليوم.')); }}
          calendar={{ feeds: calFeeds, onFeedsChange: persistFeeds, report: calReport, onRefresh: (feeds, o) => refreshCalendars(feeds, o), refreshing: calBusy }}
          trello={{ report: trelloReport, onRefresh: (cfg, o) => refreshTrelloCards(cfg, o), refreshing: trelloBusy }}
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
                  {b && <span className="blk-ink" style={{ '--bi-light': b.accentDeep, '--bi-dark': b.accent, fontWeight: 700 }}>{bName(b)}</span>}
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
                  <p>{tx('Ask about your day, or just say what you want changed — tasks, backlog, recurring tasks, habits, prayers, projects, points, the alarm, even the settings. Every change is proposed, and nothing happens until you approve it.', 'اسأل عن يومك، أو قل ببساطة ما تريد تغييره — المهام وقائمة الانتظار والمهام المتكررة والعادات والصلوات والمشاريع والنقاط والمنبه وحتى الإعدادات. كل تغيير يُقترح فقط، ولا يحدث شيء قبل موافقتك.')}</p>
                  <div className="chat-suggests">
                    {[tx('What should I focus on today?', 'على ماذا أركّز اليوم؟'), tx('Am I overcommitted?', 'هل حمّلت نفسي أكثر من اللازم؟'), tx('Move everything left today to tomorrow', 'انقل ما تبقى اليوم إلى الغد'), tx('Slot my day', 'وزّع يومي')].map((sg) => (
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
                      {(m.proposals || []).filter((_, i) => !(m.applied || {})[i]).length > 1 && (
                        <button className="ghost sm chat-apply-all" onClick={() => applyAllProposals(mi)} disabled={applyBusy}>
                          <ListChecks size={13} /> {tx('Approve all', 'وافق على الكل')} ({(m.proposals || []).filter((_, i) => !(m.applied || {})[i]).length})
                        </button>
                      )}
                      {m.proposals.map((p, pi) => {
                        const state = (m.applied || {})[pi];
                        return (
                          <div key={pi} className={`chat-prop ${state || ''}`}>
                            <div className="chat-prop-main">
                              <span className="chat-prop-desc">{describeProposal(p, proposalNames)}</span>
                              {p.why && <span className="chat-prop-why">{p.why}</span>}
                            </div>
                            {state === 'done' ? <span className="chat-prop-state"><CheckCircle2 size={14} /> {tx('applied', 'طُبّق')}</span>
                              : state === 'skip' ? <span className="chat-prop-state muted">{tx('dismissed', 'تم التجاهل')}</span>
                                : (
                                  <span className="chat-prop-actions">
                                    <button className="primary sm" onClick={() => applyProposal(mi, pi)} disabled={applyBusy}>{tx('Approve', 'موافقة')}</button>
                                    <button className="ghost sm" onClick={() => dismissProposal(mi, pi)} disabled={applyBusy}>{tx('No', 'لا')}</button>
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
              {chatMic.available && (
                <button
                  className={`mic-btn ${chatMic.state}`}
                  onClick={toggleChatMic}
                  disabled={chatMic.state === 'transcribing' || chatBusy}
                  style={chatMic.state === 'listening' ? { '--mic-level': chatMic.level } : undefined}
                  aria-label={chatMic.state === 'listening' ? tx('Stop dictating', 'أوقف الإملاء') : tx('Dictate', 'إملاء')}
                  title={chatMic.state === 'listening' ? tx('Stop dictating', 'أوقف الإملاء') : tx('Dictate', 'إملاء')}
                >
                  {chatMic.state === 'transcribing' ? <Loader2 size={16} className="spin" />
                    : chatMic.state === 'listening' ? <Square size={14} />
                      : <Mic size={17} />}
                </button>
              )}
              <input className="chat-input" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                placeholder={chatMic.state === 'listening' ? tx('Listening…', 'أستمع…') : chatMic.state === 'transcribing' ? tx('Writing it down…', 'أكتب ما قلته…') : tx('Ask, or tell it what to change…', 'اسأل، أو قل ما تريد تغييره…')}
                aria-label={tx('Message', 'رسالة')} />
              <button className="primary" onClick={sendChat} disabled={chatBusy || chatMic.busy || !chatInput.trim()}>{tx('Send', 'إرسال')}</button>
            </div>
          </div>
        </div>
      )}

      {view === 'focus' && isDesktop() && (
        <FocusView
          tasks={focusTasks}
          durationFor={durationFor}
          pendingRound={pendingRound}
          onDismissRound={() => setPendingRound(null)}
          onMarkTaskDone={focusMarkDone}
          onLearnDuration={focusLearn}
        />
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
        <button className={`navbtn ${view === 'calendar' ? 'on' : ''}`} onClick={() => setView('calendar')} aria-label={tx('Calendar', 'التقويم')}>
          <CalendarRange size={20} /><span className="navlabel">{tx('Calendar', 'تقويم')}</span>
        </button>
        <button className={`navbtn ${view === 'projects' ? 'on' : ''}`} onClick={() => setView('projects')} aria-label={tx('Projects', 'المشاريع')}>
          <Target size={20} /><span className="navlabel">{tx('Projects', 'مشاريع')}</span>
        </button>
        <button className={`navbtn ${view === 'habits' ? 'on' : ''}`} onClick={() => setView('habits')} aria-label={tx('Habits', 'العادات')}>
          <Flame size={20} /><span className="navlabel">{tx('Habits', 'عادات')}</span>
        </button>
        {isDesktop() && (
          <button className={`navbtn ${view === 'focus' ? 'on' : ''}`} onClick={() => setView('focus')} aria-label={tx('Focus', 'تركيز')}>
            <AlarmClock size={20} /><span className="navlabel">{tx('Focus', 'تركيز')}</span>
            {pendingRound && <span className="navbadge">1</span>}
          </button>
        )}
      </nav>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FlameGlyph — the streak flame. Dead ember at 0; warms, flickers,    */
/*  and gains a pulsing halo as the streak grows; at 6–7 days it burns  */
/*  hot with rising sparks. Pure CSS animation, honours reduced-motion. */
