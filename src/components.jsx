import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Plus, X, Check, ChevronLeft, ChevronRight, Settings, Sparkles, Trash2, Link as LinkIcon, Image as ImageIcon, StickyNote, Loader2, CheckCircle2, Circle, AlertCircle, Tag, Clock, GripVertical, Inbox, LayoutTemplate, CornerUpRight, Copy, Calendar, CalendarRange, Target, TrendingUp, Flag, Languages, Repeat, ChevronDown, Flame, Lock, Shield, KeyRound, Delete, Coins, Gift, Timer, Ban } from 'lucide-react';
import { taskDuration,taskUntil,spanLength,focusTargetMin,focusSpent,focusMet,hasVault,vaultWindowed,vaultUnlocked,autoWorth,taskWorth,estimateMinutes,hashPin,APP_VERSION,BLOCKS,CAIRO,D2R,DEFAULT_LABELS,DEFAULT_SETTINGS,DEFAULT_TIMINGS,LABEL_ICON,LABEL_SWATCHES,LANG,LANGS,MONTHS,MONTHS_AR,PRAYER_BLOCKS,SKY_KEYFRAMES,TIME_24,WEEKDAYS,WEEKDAYS_AR,WEEKDAYS_FULL,WEEKDAYS_FULL_AR,activeBlockAt,addDays,bHint,bName,bSub,blockById,cleanTime,computePrayerTimes,darcsin,darctan2,dsin,firstJsonObject,fixAngle,fixHour,fmtISO,fmtTime,glowLevel,habitDoneOn,habitStreak,inWindow,isRTL,julianDay,lerpArr,lerpN,mdInline,migrateSettings,minutesOf,mkSubs,mm2,mon,newHabit,newProject,pad,parseISO,parseRange,projectPace,projectProgress,renderMarkdown,rgbStr,rgbaStr,sameDay,setLang,setTime24,skyAt,startOfWeek,sunPosition,tx,tEndMin,tStartMin,timeLabel,timeOrder,toHM,uid,vBlock,wd,wdFull,weekdayFullList,windowBounds } from './core.jsx';
import { rawGet, rawSet, rawDelete, rawList, loadKey, saveKey, storageAvailable } from './storage.js';
import { durationFor, rememberDuration } from './durations.js';
import { focusModeFor, modeKey } from './focusmode.js';
import { describeRepeat, isScheduled } from './recur.js';
import { applySuggestion, suggestFor, tokenAt } from './parse.js';
import { mergeHabits } from './habits.js';

function FlameGlyph({ level = 0, size = 14 }) {
  const l = Math.max(0, Math.min(7, level));
  return (
    <span className={`flamewrap fl-${l}`} aria-hidden="true">
      <span className="flame-halo" />
      <Flame size={size} className="flame-ic" />
      {l >= 6 && <span className="spark s1" />}
      {l >= 6 && <span className="spark s2" />}
      {l >= 7 && <span className="spark s3" />}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  A single habit, shown inside its time period (Now + Plan timeline)  */
/* ------------------------------------------------------------------ */
function HabitLine({ h, iso, onToggle }) {
  const done = habitDoneOn(h, iso);
  const streak = habitStreak(h, iso);
  const glow = glowLevel(streak);
  return (
    <div className={`habit-line glow-${glow} ${done ? 'on' : ''}`} style={{ '--hcolor': h.color }}>
      <button className="tcheck" onClick={() => onToggle(h.id, iso)} aria-label={tx('Toggle habit', 'تبديل العادة')}>{done ? <CheckCircle2 size={18} /> : <Circle size={18} />}</button>
      <div className="habit-line-col">
        <span className="habit-line-title"><FlameGlyph level={glow} size={12} /> {h.name}</span>
        <span className="habit-line-meta">{streak > 0 ? `${streak} ${tx('day streak', 'يوم متتالٍ')}${streak !== 1 && LANG !== 'ar' ? '' : ''}` : tx('daily habit', 'عادة يومية')}{glow >= 7 ? ` · ${tx('max glow', 'أقصى توهّج')}` : ''}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Block row (drop target for tasks, pool items, templates)           */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/*  Finishing the tag or project you are typing.                       */
/*                                                                     */
/*  The matching is not new — `%bu` has resolved to "Bugs and Features" */
/*  for as long as the syntax has existed. What was missing was any way */
/*  to know that it had, before pressing Enter and finding out.         */
/*                                                                     */
/*  Three things this insists on:                                       */
/*                                                                     */
/*    it uses the parser's own matcher (tokenAt / suggestFor in         */
/*      parse.js), so picking a name and typing the letters can never   */
/*      mean different things. A list that disagreed with the parser    */
/*      would teach a syntax the app does not have.                     */
/*    the caret survives. Replacing the token moves it, and setting the */
/*      value alone drops the caret to the end — mid-sentence that      */
/*      scatters the rest of what you were writing.                     */
/*    Enter picks the highlighted row instead of submitting. Submitting */
/*      out from under an open list is how you get the task you were    */
/*      half way through describing.                                    */
/*                                                                     */
/*  The key handler is published through `keys`, a ref the caller owns  */
/*  and calls from the input's own onKeyDown — because the keys that    */
/*  drive a list under an input are the same keys the input uses, and   */
/*  only the input knows which of them it still wants.                  */
/* ------------------------------------------------------------------ */
function TokenSuggest({ inputRef, keys, value, onChange, labels = [], projects = [] }) {
  const [caret, setCaret] = useState(null);
  const [sel, setSel] = useState(0);
  const tok = caret == null ? null : tokenAt(value, caret);
  const items = tok ? suggestFor(tok, { labels, projects }) : [];
  const open = items.length > 0;

  /* The caret is read from the element, not from React: every key, click and
     selection change moves it and no single React event covers all three. */
  useEffect(() => {
    const el = inputRef && inputRef.current;
    if (!el) return undefined;
    const read = () => setCaret(el.selectionStart);
    // A row is chosen on mousedown, which fires before blur; the delay is only
    // so a blur from anywhere else still closes the list.
    const blur = () => setTimeout(() => setCaret(null), 120);
    for (const ev of ['keyup', 'click', 'input', 'focus']) el.addEventListener(ev, read);
    el.addEventListener('blur', blur);
    return () => {
      for (const ev of ['keyup', 'click', 'input', 'focus']) el.removeEventListener(ev, read);
      el.removeEventListener('blur', blur);
    };
  }, [inputRef]);

  useEffect(() => { setSel(0); }, [tok && tok.query, tok && tok.kind]);

  const pick = (item) => {
    const r = applySuggestion(value, tok, item.name);
    onChange(r.text);
    const el = inputRef && inputRef.current;
    // After React has written the new value — setting it first and moving the
    // caret second is the only order that survives a controlled input.
    if (el) requestAnimationFrame(() => {
      try { el.focus(); el.setSelectionRange(r.caret, r.caret); setCaret(r.caret); } catch { /* detached */ }
    });
  };

  if (keys) {
    keys.current = (e) => {
      if (!open) return false;
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => (i + 1) % items.length); return true; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => (i - 1 + items.length) % items.length); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(items[Math.min(sel, items.length - 1)]); return true; }
      if (e.key === 'Escape') { e.preventDefault(); setCaret(null); return true; }
      return false;
    };
  }

  if (!open) return null;
  return (
    <div className="tsug" role="listbox">
      {items.map((it, i) => (
        <button key={`${it.kind}:${it.id || it.name}`} type="button" role="option" aria-selected={i === sel}
          className={`tsug-row ${i === sel ? 'on' : ''} ${it.isNew ? 'new' : ''}`}
          onMouseEnter={() => setSel(i)}
          onMouseDown={(e) => { e.preventDefault(); pick(it); }}>
          <span className="tsug-dot" style={{ background: it.color || 'var(--faint)' }} />
          <span className="tsug-name">{it.name}</span>
          <span className="tsug-kind">{it.isNew ? tx('new tag', 'وسم جديد') : it.kind === 'tag' ? tx('tag', 'وسم') : tx('project', 'مشروع')}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Quick add — one line, from anywhere.                               */
/*                                                                     */
/*  Adding a task on a phone meant: open Plan, find the day, find the   */
/*  block, tap Add. Four taps and a decision about where it goes before */
/*  you have written down the thing you were afraid of forgetting —     */
/*  which is how things get forgotten.                                  */
/*                                                                     */
/*  So: one button, one line, and the same parser every other box uses. */
/*  "call the dentist tomorrow 3pm #calls %Health" lands where it says  */
/*  it lands. Without a date it goes into today's current period, which */
/*  is the answer that needs no decision — and the backlog is one tap   */
/*  away for the things that genuinely have no home yet.                */
/*                                                                     */
/*  Sheet rather than modal, and bottom-anchored, because the keyboard  */
/*  takes the bottom half of the screen and a centred dialog would open */
/*  underneath it.                                                      */
/* ------------------------------------------------------------------ */
function QuickAdd({ onAdd, onClose, parseHint, blockName, labels = [], projects = [] }) {
  const [text, setText] = useState('');
  const ref = useRef(null);
  const keys = useRef(null);
  useEffect(() => { const id = setTimeout(() => ref.current && ref.current.focus(), 60); return () => clearTimeout(id); }, []);
  const submit = (toPool) => { if (!text.trim()) return; onAdd(text, { toPool }); setText(''); onClose(); };
  return (
    <div className="overlay qa-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="qa-sheet">
        <div className="qa-head">
          <span className="qa-title"><Plus size={15} /> {tx('Quick add', 'إضافة سريعة')}</span>
          <button className="icon" onClick={onClose} aria-label={tx('Close', 'إغلاق')}><X size={17} /></button>
        </div>
        <div className="quick qa-field">
          <input ref={ref} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (keys.current && keys.current(e)) return;
              if (e.key === 'Enter') submit(false);
              if (e.key === 'Escape') onClose();
            }}
            placeholder={tx('Anything… (tomorrow 3pm #tag %project)', 'أي شيء… (بكرة ٣ عصر #وسم %مشروع)')} />
          <TokenSuggest inputRef={ref} keys={keys} value={text} onChange={setText} labels={labels} projects={projects} />
          <ParseChip text={text} hint={parseHint} />
        </div>
        <div className="qa-actions">
          <button className="ghost" disabled={!text.trim()} onClick={() => submit(true)}><Inbox size={15} /> {tx('To backlog', 'إلى قائمة الانتظار')}</button>
          <button className="primary" disabled={!text.trim()} onClick={() => submit(false)}>
            <Plus size={15} /> {blockName ? `${tx('Add to', 'أضف إلى')} ${blockName}` : tx('Add', 'إضافة')}
          </button>
        </div>
        <p className="hint-text qa-hint">{tx('A date or a time in the words wins over the period above.', 'التاريخ أو الوقت المكتوب في النص يتقدّم على الفترة أعلاه.')}</p>
      </div>
    </div>
  );
}

function ParseChip({ text, hint }) {
  const s = hint ? hint(text || '') : '';
  if (!s) return null;
  return <div className="parse-chip">{s}</div>;
}

/* ------------------------------------------------------------------ */
/*  The project a piece of work belongs to.                            */
/*                                                                     */
/*  Tags say what KIND of work this is; a project says what it is FOR,  */
/*  and that is the thing a title usually leaves out. It lived only in  */
/*  the task editor, which meant the one place you could see it was the */
/*  one place you already knew. Now every list that shows work shows it: */
/*  Plan, Now, Overdue, the backlog.                                    */
/*                                                                     */
/*  Drawn as an outline against the tag's filled chip so two of them    */
/*  side by side read as two different things rather than two tags.     */
/* ------------------------------------------------------------------ */
function ProjectTag({ project, sm = false }) {
  if (!project) return null;
  return (
    <span className={`prj-tag${sm ? ' sm' : ''}`} style={{ '--pcolour': project.color }} title={project.name}>
      <Target size={sm ? 9 : 10} /> {project.name}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  A project's share of today, as one line you can settle from.       */
/*                                                                     */
/*  "Finish the book by March" is not a thing anyone can do today.     */
/*  "Eleven pages" is. A project that carries a number, a deadline and  */
/*  the days it is actually worked on can say the second sentence, and  */
/*  this is where it says it — in Plan and in Now, on its own days, at  */
/*  its own hour, going quiet the moment the share is logged.          */
/*                                                                     */
/*  The input logs progress against the project itself, so the number   */
/*  the card is arguing about is the number that moves. Anything else   */
/*  would make it a reminder to go somewhere else and log it, which is  */
/*  the step people skip.                                              */
/* ------------------------------------------------------------------ */
/* On pace or not, in the fewest words that still carry the number: "on pace",
   "+6 ahead", "12 pages behind". `verdict` is paceStatus() from quota.js. */
function PaceChip({ verdict, unit = '' }) {
  if (!verdict || verdict.key === 'unknown') return null;
  const n = verdict.gap == null ? 0 : Math.round(Math.abs(verdict.gap));
  const u = unit ? ` ${unit}` : '';
  const text = {
    done: tx('reached', 'اكتمل'),
    waiting: tx('not started', 'لم يبدأ'),
    on: tx('on pace', 'على المسار'),
    ahead: `${tx('ahead', 'متقدّم')} +${n}${u}`,
    behind: `${n}${u} ${tx('behind', 'متأخر')}`,
    far: `${n}${u} ${tx('behind', 'متأخر')}`,
  }[verdict.key];
  if (!text) return null;
  return <span className={`pace-chip ${verdict.key}`}>{text}</span>;
}

/* Every project with a numeric target and a deadline that is not already
   asking for its share on this page — so Plan and Now say whether each goal
   is on pace, not only the ones with a reminder switched on. */
function PaceStrip({ items, onOpen, title }) {
  if (!items || !items.length) return null;
  return (
    <div className="pace-strip">
      {title ? <div className="pace-strip-h"><TrendingUp size={12} /> {title}</div> : null}
      <div className="pace-strip-row">
        {items.map(({ project, verdict }) => (
          <button key={project.id} className={`pace-item ${verdict.key}`} style={{ '--qcolour': project.color }} onClick={onOpen}>
            <span className="quota-dot" />
            <span className="pace-name">{project.name}</span>
            <PaceChip verdict={verdict} unit={project.unit || ''} />
          </button>
        ))}
      </div>
    </div>
  );
}

/* `sittings` (from sittingsFor) are the day's share in chunks; with more than
   one, the line lists the pieces under the bar. `now` (from owedNow) is what
   the Now page passes: the sitting that has arrived and what is owed by it,
   missed earlier pieces included. */
function QuotaLine({ project, quota, onLog, onOpen, compact = false, verdict = null, sittings = null, now = null }) {
  const [n, setN] = useState('');
  const submit = () => { const v = Number(n); if (v > 0) { onLog(v); setN(''); } };
  const unit = project.unit || '';
  const pct = quota.need ? Math.min(1, quota.done / quota.need) : (quota.met ? 1 : 0);
  const pieces = (sittings || []).filter((s) => s.amount == null || s.amount > 0);
  const chunked = pieces.length > 1;
  const owed = now && now.owed != null ? now.owed : null;
  return (
    <div className={`quota-line${quota.met ? ' met' : ''}${compact ? ' compact' : ''}`} style={{ '--qcolour': project.color }}>
      <button className="quota-main" onClick={onOpen}>
        <span className="quota-name"><span className="quota-dot" />{project.name}{verdict ? <PaceChip verdict={verdict} unit={project.unit || ''} /> : null}</span>
        <span className="quota-ask">
          {quota.need == null
            ? `${quota.total}/${quota.target} ${unit}`.trim()
            : quota.met
              ? `${tx('done', 'تم')} · ${quota.done} ${unit}`.trim()
              : owed != null && chunked
                ? `${owed} ${unit} ${tx('now', 'الآن')} · ${tx('sitting', 'جلسة')} ${now.sitting.index + 1}/${pieces.length} · ${quota.done}/${quota.need} ${tx('today', 'اليوم')}`.trim()
                : `${quota.done}/${quota.need} ${unit} ${tx('today', 'اليوم')}`.trim()}
        </span>
        <span className="quota-bar"><span style={{ width: `${pct * 100}%` }} /></span>
        {chunked && (
          <span className="quota-sits">
            {pieces.map((s) => (
              <span key={s.index} className={`quota-sit${s.met ? ' met' : ''}${now && now.sitting.index === s.index ? ' cur' : ''}`}>
                {s.met ? <Check size={10} /> : null}{bName(blockById(s.block))}{s.start ? ` ${s.start}` : ''}{s.amount != null ? ` · ${s.amount}` : ''}
              </span>
            ))}
          </span>
        )}
      </button>
      {!quota.met && (
        <span className="quota-log">
          <input type="number" min="0" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder={owed != null ? String(owed) : quota.need != null ? String(Math.max(0, quota.need - quota.done)) : '0'}
            aria-label={`${tx('Log progress on', 'سجّل تقدمًا في')} ${project.name}`} />
          <button className="ghost sm" onClick={submit} disabled={!(Number(n) > 0)}><Plus size={13} /></button>
        </span>
      )}
      {quota.met && <span className="quota-tick"><Check size={14} /></span>}
    </div>
  );
}

function BlockRow({ block, start, end, tasks, habits = [], habitDate, onToggleHabit, labelById, projectById = () => null, current, prayer, onPrayer, onToggle, onToggleSub, onOpen, onAdd, onDragStart, dragActive, dragOver, draggingId, over, events = [], cards = [], onAddCard, addedCards, onToggleCalEvent, parseHint, onOpenSpan, suggestLabels = [], suggestProjects = [] }) {
  const [folded, setFolded] = useState(() => new Set()); // collapsed subtask lists, per task id (session-local)
  const toggleFold = (id) => setFolded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [quick, setQuick] = useState('');
  const [adding, setAdding] = useState(false);
  const quickRef = useRef(null);
  const quickKeys = useRef(null);
  const submit = () => { if (quick.trim()) { onAdd(quick); setQuick(''); } };
  // Insertion-line position for a task being dragged within this block.
  // Subtasks are NOT reorderable here — that lives in the task's detail editor,
  // so the timeline stays a calm read/check surface.
  const taskDrop = over && over.type === 'block' && over.id === block.id ? over : null;
  /* Meetings and due cards are fixtures: anchored to the clock, read-only (a
     card grows an Add button, nothing more). They are tucked between the tasks
     by start time — before the first task that starts later than they do —
     while untimed tasks keep their manual order after them. */
  const fixtures = [
    ...events.map((e) => ({ kind: 'event', at: e.startMin, e })),
    ...cards.map((c) => ({ kind: 'card', at: c.dueMin, c })),
  ].sort((a, b) => a.at - b.at);
  // Habits share the manual order with the tasks: each one sits after as
  // many of the period's tasks as its slot says (dragged there, or first).
  const rows = [];
  { let fi = 0;
    for (const row of mergeHabits(tasks, habits)) {
      if (row.kind === 'task') {
        const ts = tStartMin(row.t) ?? Infinity;
        while (fi < fixtures.length && fixtures[fi].at <= ts) rows.push(fixtures[fi++]);
      }
      rows.push(row);
    }
    while (fi < fixtures.length) rows.push(fixtures[fi++]);
  }
  return (
    <div className={`block ${current ? 'active' : ''} ${dragActive ? 'drop-on' : ''} ${dragOver ? 'dragover' : ''}`} style={{ '--accent': block.accent, '--accent-deep': block.accentDeep, '--tint': block.tint }} data-dropblock={block.id}>
      <div className="block-head">
        <div className="block-name"><span className="bn-en">{bName(block)}</span><span className="bn-ar">{bSub(block)}</span></div>
        <span className="block-time">{fmtTime(start)}{end ? ` – ${fmtTime(end)}` : '+'}</span>
      </div>
      {prayer && (
        <div className={`prayer-row ${prayer.done ? 'done' : ''}`}>
          <button className="tcheck" onClick={onPrayer} aria-label="Mark prayer performed">{prayer.done ? <CheckCircle2 size={17} /> : <Circle size={17} />}</button>
          <span className="prayer-title">{tx(`${block.name} prayer`, `صلاة ${block.ar}`)}</span>
        </div>
      )}
      {tasks.length === 0 && habits.length === 0 && fixtures.length === 0 && !adding && <button className="empty" onClick={() => setAdding(true)}>{bHint(block)}</button>}
      {rows.map((row, ri) => {
        if (row.kind === 'habit') { const h = row.h;
          const hBefore = taskDrop && taskDrop.habitId === h.id && !taskDrop.after;
          const hAfter = taskDrop && taskDrop.habitId === h.id && taskDrop.after;
          return (
          <div key={`hb-${h.id}`} data-habitid={h.id} className={`block-habit ${draggingId === h.id ? 'dragging' : ''} ${hBefore ? 'drop-before' : ''} ${hAfter ? 'drop-after' : ''}`}>
            <span className="grip" onPointerDown={(e) => onDragStart(e, 'habit', h)} title={tx('Drag to reorder within this period', 'اسحب لإعادة الترتيب داخل هذه الفترة')}><GripVertical size={15} /></span>
            <HabitLine h={h} iso={habitDate} onToggle={onToggleHabit} />
          </div>); }
        if (row.kind === 'event') { const e = row.e; return (
          <div key={`ev-${e.uid || ''}-${ri}`} className={`cal-inline ${e.done ? 'done' : ''}`}>
            {onToggleCalEvent
              ? <button className="tcheck" onClick={() => onToggleCalEvent(e.key)} aria-label={tx('Mark attended', 'تم الحضور')}>{e.done ? <CheckCircle2 size={17} /> : <Circle size={17} />}</button>
              : <Calendar size={14} className="cal-inline-ic" />}
            <div className="cal-inline-col">
              <span className="cal-inline-title">{e.summary || tx('(busy)', '(مشغول)')}</span>
              <span className="cal-inline-time">{fmtTime(mm2(e.startMin))}–{fmtTime(mm2(e.endMin))}{e.calName ? ` · ${e.calName}` : ''}</span>
            </div>
            <span className="cal-inline-tag">{tx('meeting', 'اجتماع')}</span>
          </div>); }
        if (row.kind === 'card') { const c = row.c; const added = addedCards && addedCards.has(c.id); return (
          <div key={`tr-${c.id}`} className="cal-inline trello">
            <LayoutTemplate size={14} className="cal-inline-ic" />
            <div className="cal-inline-col">
              <span className="cal-inline-title">{c.title}</span>
              <span className="cal-inline-time">{tx('due', 'تستحق')} {fmtTime(mm2(c.dueMin))}{c.boardName ? ` · ${c.boardName}` : ''}</span>
            </div>
            {added
              ? <span className="cal-inline-tag ok"><Check size={12} /> {tx('added', 'أُضيفت')}</span>
              : <button className="ghost sm" onClick={() => onAddCard && onAddCard(c)}><Plus size={13} /> {tx('Add', 'أضف')}</button>}
          </div>); }
        const t = row.t; const p = labelById(t.projectId); const prj = projectById(t.projectRef); const subs = t.subtasks || [];
        /* A task borrowed from an earlier day by its own span. It is the same
           task — ticking it here finishes it — but it is not stored on this
           day, so dragging it would move a task that lives somewhere else. */
        const ghost = !!t.__spanDay;
        const dBefore = taskDrop && taskDrop.taskId === t.id && !taskDrop.after;
        const dAfter = taskDrop && taskDrop.taskId === t.id && taskDrop.after;
        return (
        <div key={t.id} data-taskid={ghost ? undefined : t.id} className={`task ${p ? 'has-label' : ''} ${t.done ? 'done' : ''} ${ghost ? 'spanning' : ''} ${draggingId === t.id ? 'dragging' : ''} ${dBefore ? 'drop-before' : ''} ${dAfter ? 'drop-after' : ''}`} style={p ? { '--lcolor': p.color } : undefined}>
          {ghost
            ? <span className="grip span-grip" title={tx('Runs across several days — it lives on its first one', 'تمتد عبر عدة أيام — مكانها يومها الأول')}><CalendarRange size={14} /></span>
            : <span className="grip" onPointerDown={(e) => onDragStart(e, 'task', t)} title={tx('Drag to reorder or move to another slot', 'اسحب لإعادة الترتيب أو النقل')}><GripVertical size={15} /></span>}
          <button className="tcheck" onClick={() => onToggle(t.id)} aria-label="Toggle done">{t.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}</button>
          <div className="tcol">
            <button className="tmain" onClick={() => (ghost && onOpenSpan ? onOpenSpan(t) : onOpen(t.id))}>
              <span className="ttitle">{p && <span className="lchip" style={{ '--lcolor': p.color }}>{p.name}</span>}{t.title}{timeLabel(t) ? <span className="ttime">{timeLabel(t)}</span> : null}{t.__spanDay ? <span className="span-count">{tx('day', 'يوم')} {t.__spanDay}/{t.__spanOf}</span> : null}</span>
              {prj && <span className="tmeta"><ProjectTag project={prj} /></span>}
              {(t.notes?.length > 0 || hasVault(t)) && <span className="tmeta">{t.notes && t.notes.length > 0 && <span className="badge"><StickyNote size={11} /> {t.notes.length}</span>}{hasVault(t) && <span className="badge vault-badge" title={tx('Time vault', 'خزنة موقّتة')}><Lock size={11} /></span>}</span>}
            </button>
            {subs.length > 0 && (
              <button className="subs-fold" onClick={() => toggleFold(t.id)} aria-expanded={!folded.has(t.id)}>
                <ChevronDown size={13} style={{ transform: folded.has(t.id) ? 'rotate(-90deg)' : 'none' }} />
                {subs.filter((s) => s.done).length}/{subs.length} {tx('steps', 'خطوات')}
              </button>
            )}
            {subs.length > 0 && !folded.has(t.id) && (
              <ul className="subs">{subs.map((s) => (
                <li key={s.id} className={`sub ${s.done ? 'done' : ''}`}>
                  <button className="subcheck" onClick={() => onToggleSub(t.id, s.id)}>{s.done ? <CheckCircle2 size={13} /> : <Circle size={13} />}</button>
                  <span>{s.title}</span>
                </li>
              ))}</ul>
            )}
          </div>
          </div>); })}
        {adding ? (
          <div className="quick"><input ref={quickRef} autoFocus value={quick} onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => {
              // The list gets first refusal on Enter, Tab, the arrows and
              // Escape — submitting out from under an open list is how you get
              // the task you were half way through describing.
              if (quickKeys.current && quickKeys.current(e)) return;
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') { setAdding(false); setQuick(''); }
            }}
            onBlur={() => { submit(); setAdding(false); }} placeholder={tx('Add a task… (tomorrow 3pm #tag %project)', 'أضف مهمة… (بكرة ٣ عصر #وسم %مشروع)')} />
            <TokenSuggest inputRef={quickRef} keys={quickKeys} value={quick} onChange={setQuick} labels={suggestLabels} projects={suggestProjects} />
            <ParseChip text={quick} hint={parseHint} /></div>
        ) : (tasks.length > 0 || habits.length > 0) ? (<button className="add-row" onClick={() => setAdding(true)}><Plus size={14} /> {tx('Add', 'إضافة')}</button>) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Landscape — the illustration: gradient sky, sun/moon disc with a    */
/*  ring halo, dune waves with a pyramid silhouette on the horizon.     */
/*  Driven entirely by `sky` (from skyAt), so it shifts continuously    */
/*  through the day rather than snapping between fixed states. Used     */
/*  both as the app-wide banner (compact) and the Now page's hero.      */
/* ------------------------------------------------------------------ */
function pyramidPath(cx, baseY, halfW, h) {
  return `M ${(cx - halfW).toFixed(1)} ${baseY} L ${cx.toFixed(1)} ${(baseY - h).toFixed(1)} L ${(cx + halfW).toFixed(1)} ${baseY} Z`;
}
/* ------------------------------------------------------------------ */
/*  App icon — minimal mark: sun over the horizon, the app's core       */
/*  motif reduced to two flat shapes so it reads clean at small sizes.  */
/* ------------------------------------------------------------------ */
function AppIcon({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Rhythm">
      <rect width="32" height="32" rx="9" fill="#3E8A6C" />
      <circle cx="16" cy="13" r="6" fill="#F8FCF9" />
      <rect x="6" y="22" width="20" height="2.6" rx="1.3" fill="#F8FCF9" />
    </svg>
  );
}

function Landscape({ sky, stars }) {
  const W = 430, H = 220;
  const discSize = 66;
  const discTop = 10 + sky.discY * 42;
  const waveY = H - 54;
  const tokenStr = rgbStr(sky.token);
  const ring1 = rgbaStr(sky.token, 0.22), ring2 = rgbaStr(sky.token, 0.1);
  return (
    <div className="scape" style={{ background: `linear-gradient(180deg, ${rgbStr(sky.top)}, ${rgbStr(sky.bot)})` }}>
      <div className="scape-glow" style={{ top: `${discTop}%`, width: discSize * 2.7, height: discSize * 2.7, marginLeft: -(discSize * 1.35), marginTop: -(discSize * 1.35), background: `radial-gradient(circle, ${rgbaStr(sky.glow, 0.5)}, transparent 70%)` }} />
      <div className="scape-stars">
        {stars.map((s, i) => (<span key={i} className="star" style={{ left: `${s.x}%`, top: `${s.y * 0.75}%`, opacity: sky.night * s.base }} />))}
      </div>
      <div className="scape-disc" style={{ top: `${discTop}%`, width: discSize, height: discSize, marginLeft: -discSize / 2, marginTop: -discSize / 2, background: tokenStr, boxShadow: `0 0 0 ${discSize * 0.2}px ${ring1}, 0 0 0 ${discSize * 0.42}px ${ring2}` }} />
      <svg className="scape-waves" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path d={pyramidPath(W * 0.60, waveY + 12, 34, 38)} fill={rgbaStr(sky.waveFront, 0.55)} />
        <path d={pyramidPath(W * 0.69, waveY + 12, 25, 26)} fill={rgbaStr(sky.waveFront, 0.4)} />
        <path d={`M0,${waveY - 26} C90,${waveY - 52} 160,${waveY - 4} 240,${waveY - 30} C320,${waveY - 52} 380,${waveY - 18} ${W},${waveY - 36} L${W},${H} L0,${H} Z`} fill={rgbaStr(sky.waveBack, 0.55)} />
        <path d={`M0,${waveY} C80,${waveY - 22} 150,${waveY + 16} 230,${waveY - 4} C310,${waveY - 22} 370,${waveY + 10} ${W},${waveY - 6} L${W},${H} L0,${H} Z`} fill={rgbStr(sky.waveFront)} />
      </svg>
    </div>
  );
}
function SkyScene({ sky, stars, light, label, time, blockName, blockAr, range }) {
  return (
    <div className="scene">
      <Landscape sky={sky} stars={stars} />
      <div className={`scene-text ${light ? 'light' : 'dark'}`}>
        <span className="scene-label">{label}</span>
        <span className="scene-time">{time}</span>
        <span className="scene-block">{blockName} <span className="scene-ar">{blockAr}</span></span>
        <span className="scene-range">{range}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Plan sidebar — Recurring + Backlog in one box, switchable          */
/* ------------------------------------------------------------------ */
function PlanSide({ tab, onTab, open = true, onToggleOpen, templates, pool, labelById, projectById = () => null, usedTpl = {}, onDragStart, onTplToPool, onTplToDay, onAddTpl, onManage, onEditTpl, onAddPool, onOpenPool, onTogglePoolDone, onPoolToDay, poolDropActive, poolDropOver, parseHint, onClearDonePool, suggestLabels = [], suggestProjects = [] }) {
  const [val, setVal] = useState('');
  const [doneOpen, setDoneOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const poolRef = useRef(null);
  const poolKeys = useRef(null);
  const submitPool = () => { if (val.trim()) { onAddPool(val); setVal(''); } };
  const isBacklog = tab === 'backlog';
  return (
    <section className={`side-card ${!open ? 'collapsed' : ''} ${isBacklog && poolDropActive ? 'drop-on' : ''} ${isBacklog && poolDropOver ? 'dragover' : ''}`} data-droppool={isBacklog && open ? '1' : undefined}>
      <div className="side-tabs">
        <button className={`side-tab ${!isBacklog ? 'on' : ''}`} onClick={() => { if (!open) onToggleOpen && onToggleOpen(); onTab('recurring'); }}><Repeat size={13} /> {tx('Recurring', 'المتكررة')}{templates.length > 0 && <span className="side-count">{templates.length}</span>}</button>
        <button className={`side-tab ${isBacklog ? 'on' : ''}`} onClick={() => { if (!open) onToggleOpen && onToggleOpen(); onTab('backlog'); }}><Inbox size={13} /> {tx('Backlog', 'الانتظار')}{pool.length > 0 && <span className="side-count">{pool.length}</span>}</button>
        {onToggleOpen && <button className="side-collapse" onClick={onToggleOpen} aria-expanded={open} aria-label={open ? tx('Collapse', 'طيّ') : tx('Expand', 'توسيع')} title={open ? tx('Collapse', 'طيّ') : tx('Expand', 'توسيع')}><ChevronDown size={15} style={{ transform: open ? 'none' : 'rotate(-90deg)' }} /></button>}
      </div>

      {!open ? null : !isBacklog ? (
        <div className="tpl-rail">
          <div className="side-subhead"><button className="tpl-manage" onClick={onManage}>{tx('manage', 'إدارة')}</button></div>
          {templates.length === 0 && <button className="tpl-empty" onClick={onAddTpl}>{tx('No recurring tasks yet — add one', 'لا مهام متكررة بعد — أضف واحدة')}</button>}
          {templates.map((tp) => { const p = labelById(tp.projectId); const b = blockById(tp.block); const nSub = (tp.subtasks || []).length; return (
            <div key={tp.id} className="tpl-chip" style={{ '--accent': b.accent }}>
              <span className="grip" onPointerDown={(e) => onDragStart(e, 'template', tp)} title={tx('Drag onto a slot', 'اسحب إلى موعد')}><GripVertical size={13} /></span>
              <button className="tpl-body tpl-open" onClick={() => onEditTpl(tp.id)} title={tx('Edit recurring task', 'تعديل المهمة المتكررة')}>
                <span className="tpl-title">{tp.title}{usedTpl[tp.id] ? <span className="tpl-used"><Check size={11} />{usedTpl[tp.id] > 1 ? ` ×${usedTpl[tp.id]}` : ''}</span> : null}</span>
                <span className="tpl-sub">{p && <span className="pdot" style={{ background: p.color }} />}{bName(b)}{timeLabel(tp) ? ` · ${timeLabel(tp)}` : ''}{taskDuration(tp) != null ? ` · ${taskDuration(tp)}${tx('m', 'د')}` : ''}{nSub ? ` · ${nSub} ${LANG === 'ar' ? 'خطوة' : ('step' + (nSub > 1 ? 's' : ''))}` : ''}</span>
                {(isScheduled(tp.repeat) || tp.projectRef || tp.autoAdd) && (
                  <span className="tpl-sub tpl-meta">
                    {isScheduled(tp.repeat) && <span className="tpl-when"><Repeat size={9} /> {describeRepeat(tp.repeat, { dayName: wd, tx })}</span>}
                    {tp.autoAdd && <span className="tpl-when" title={tx('Adds itself to the day when it is due', 'تُضاف تلقائيًا في يوم استحقاقها')}><Sparkles size={9} /> {tx('auto', 'تلقائي')}</span>}
                    <ProjectTag project={projectById(tp.projectRef)} sm />
                  </span>
                )}
              </button>
              <div className="tpl-actions">
                <button className="tpl-act" title={tx('Add to the selected day', 'أضف إلى اليوم المحدد')} onClick={() => onTplToDay(tp.id)}><CornerUpRight size={14} /></button>
                <button className="tpl-act" title={tx('Add to backlog', 'أضف إلى قائمة الانتظار')} onClick={() => onTplToPool(tp.id)}><Inbox size={14} /></button>
              </div>
            </div>); })}
          {templates.length > 0 && <button className="tpl-add" onClick={onAddTpl} title={tx('New recurring task', 'مهمة متكررة جديدة')}><Plus size={16} /></button>}
        </div>
      ) : (
        <div className="pool-body">
          {poolDropActive && <div className="pool-hint drop">{tx('drop a task here to unschedule', 'أفلت مهمة هنا لإلغاء جدولتها')}</div>}
          <div className="quick pool-add"><input ref={poolRef} value={val} onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (poolKeys.current && poolKeys.current(e)) return; if (e.key === 'Enter') submitPool(); }}
            placeholder={tx('Add to backlog… (#tag %project)', 'أضف إلى قائمة الانتظار… (#وسم %مشروع)')} /><button className="ghost sm" onClick={submitPool}><Plus size={14} /></button>
            <TokenSuggest inputRef={poolRef} keys={poolKeys} value={val} onChange={setVal} labels={suggestLabels} projects={suggestProjects} />
            <ParseChip text={val} hint={parseHint} /></div>
          {(() => {
            /* A backlog is a list of what is left, so what is finished does not
               belong in it — it pushes the live items down and makes the list
               read longer than the work actually is. The finished ones are not
               thrown away either: they go in a drawer that is shut by default. */
            const live = pool.filter((it) => !it.done);
            const done = pool.filter((it) => it.done);
            const row = (it) => { const p = labelById(it.projectId); const doneN = (it.subtasks || []).filter((s) => s.done).length; return (
              <li key={it.id} className={`pool-item ${it.done ? 'done' : ''}`}>
                <span className="grip" onPointerDown={(e) => onDragStart(e, 'pool', it)} title={tx('Drag into a slot', 'اسحب إلى موعد')}><GripVertical size={15} /></span>
                <button className="tcheck" onClick={() => onTogglePoolDone(it.id)} aria-label={tx('Mark done', 'وضع كمنجز')}>{it.done ? <CheckCircle2 size={17} /> : <Circle size={17} />}</button>
                <button className="pool-main" onClick={() => onOpenPool(it.id)}>
                  <span className="pool-title">{it.title}</span>
                  <span className="tmeta">{p && <span className="lchip" style={{ '--lcolor': p.color }}>{p.name}</span>}<ProjectTag project={projectById(it.projectRef)} sm />{taskDuration(it) != null && <span className="badge"><Timer size={11} /> {taskDuration(it)}{tx('m', 'د')}</span>}{it.subtasks && it.subtasks.length > 0 && <span className="badge"><CheckCircle2 size={11} /> {doneN}/{it.subtasks.length}</span>}</span>
                </button>
                <button className="tpl-act" title={tx('Schedule on the selected day', 'جدولة في اليوم المحدد')} onClick={() => onPoolToDay(it.id)}><CornerUpRight size={15} /></button>
              </li>); };
            return (<>
              {live.length === 0
                ? <div className="pool-empty">{done.length ? tx('Nothing left. Everything here is done.', 'لم يتبقَّ شيء. كل ما هنا منجز.') : tx('Empty. Anything without a home goes here.', 'فارغة. أي شيء بلا موعد يذهب هنا.')}</div>
                : <ul className="pool-list">{live.map(row)}</ul>}
              {done.length > 0 && (
                <div className={`pool-done ${doneOpen ? 'open' : ''}`}>
                  <div className="pool-done-h">
                    <button className="pool-done-t" onClick={() => setDoneOpen((v) => !v)}>
                      <ChevronRight size={14} className="pool-caret" style={{ transform: doneOpen ? 'rotate(90deg)' : 'none' }} />
                      {tx('Done', 'المنجز')} <span className="pool-done-n">{done.length}</span>
                    </button>
                    {doneOpen && onClearDonePool && (
                      confirmClear
                        ? <span className="pool-done-confirm">
                            <button className="danger sm" onClick={() => { onClearDonePool(); setConfirmClear(false); }}>{tx('Delete all', 'احذف الكل')}</button>
                            <button className="ghost sm" onClick={() => setConfirmClear(false)}>{tx('Cancel', 'إلغاء')}</button>
                          </span>
                        : <button className="ghost sm" onClick={() => setConfirmClear(true)}><Trash2 size={13} /> {tx('Clear', 'مسح')}</button>
                    )}
                  </div>
                  {doneOpen && <ul className="pool-list">{done.map(row)}</ul>}
                </div>
              )}
            </>);
          })()}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared subtasks + notes editors                                    */
/* ------------------------------------------------------------------ */
/* Move `id` to sit before/after `targetId` in a list of {id} items. */
function moveById(list, id, targetId, after) {
  const dragged = list.find((x) => x.id === id);
  if (!dragged) return list;
  const rest = list.filter((x) => x.id !== id);
  const ti = rest.findIndex((x) => x.id === targetId);
  const idx = ti < 0 ? rest.length : ti + (after ? 1 : 0);
  return [...rest.slice(0, idx), dragged, ...rest.slice(idx)];
}

/* Subtasks reorder by dragging their text. Self-contained pointer handling —
   the modal is outside the timeline's drag system, and keeping it local means
   the two never contend for the same pointer stream. */
function SubtaskEditor({ subtasks, onAdd, onToggle, onDel, onMove }) {
  const [val, setVal] = useState('');
  const [drag, setDrag] = useState(null); // { id, overId, after }
  const dragRef = useRef(null);
  const add = () => { if (val.trim()) { onAdd(val.trim()); setVal(''); } };
  const start = (e, id) => {
    if (!onMove) return;
    e.preventDefault();
    dragRef.current = { id, overId: null, after: false };
    setDrag({ ...dragRef.current });
  };
  useEffect(() => {
    if (!drag) return;
    const move = (e) => {
      e.preventDefault();
      let el = document.elementFromPoint(e.clientX, e.clientY);
      let row = null;
      while (el) { if (el.dataset && el.dataset.subrow) { row = el; break; } el = el.parentElement; }
      if (row) {
        const r = row.getBoundingClientRect();
        dragRef.current = { ...dragRef.current, overId: row.dataset.subrow, after: e.clientY > r.top + r.height / 2 };
      } else dragRef.current = { ...dragRef.current, overId: null };
      setDrag({ ...dragRef.current });
    };
    const up = () => {
      const d = dragRef.current; dragRef.current = null; setDrag(null);
      if (d && d.overId && d.overId !== d.id) onMove(d.id, d.overId, d.after);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [drag, onMove]);
  return (<div className="sect">
    <div className="sect-h">{tx('Subtasks', 'المهام الفرعية')}</div>
    {subtasks.map((s) => {
      const isOver = drag && drag.overId === s.id && drag.id !== s.id;
      return (
        <div key={s.id} data-subrow={s.id}
          className={`subrow ${s.done ? 'done' : ''} ${drag && drag.id === s.id ? 'dragging' : ''} ${isOver && !drag.after ? 'drop-before' : ''} ${isOver && drag.after ? 'drop-after' : ''}`}>
          <button className="tcheck sm" onClick={() => onToggle(s.id)}>{s.done ? <CheckCircle2 size={15} /> : <Circle size={15} />}</button>
          <span className={onMove ? 'sub-drag' : ''} onPointerDown={(e) => start(e, s.id)} title={onMove ? tx('Drag to reorder', 'اسحب لإعادة الترتيب') : undefined}>{s.title}</span>
          <button className="mini-del" onClick={() => onDel(s.id)}><X size={13} /></button>
        </div>
      );
    })}
    {subtasks.length > 1 && onMove && <p className="hint-text" style={{ marginTop: 2 }}>{tx('Drag a step by its text to reorder — this is the order Now walks through.', 'اسحب أي خطوة من نصّها لإعادة ترتيبها — هذا هو الترتيب الذي تتبعه صفحة الآن.')}</p>}
    <div className="inline-add"><input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder={tx('Add a subtask…', 'أضف مهمة فرعية…')} /><button className="ghost sm" onClick={add}><Plus size={14} /></button></div>
  </div>);
}
function NoteBlock({ note, onChange, onDel }) {
  const [editing, setEditing] = useState(!note.content);
  if (note.type === 'link') return (<div className="noterow"><LinkIcon size={13} /><a href={note.content} target="_blank" rel="noreferrer">{note.content}</a><button className="mini-del" onClick={onDel}><X size={13} /></button></div>);
  if (note.type === 'image') return (<div className="noterow"><ImageIcon size={13} /><a href={note.content} target="_blank" rel="noreferrer"><img className="note-img" src={note.content} alt="" /></a><button className="mini-del" onClick={onDel}><X size={13} /></button></div>);
  // markdown text block
  return (
    <div className="md-block">
      {editing ? (
        <textarea className="md-input" autoFocus rows={Math.max(3, (note.content || '').split('\n').length + 1)}
          value={note.content} onChange={(e) => onChange(e.target.value)}
          onBlur={() => note.content.trim() ? setEditing(false) : onDel()}
          placeholder={tx('Write in markdown — **bold**, *italic*, - lists, # headings, [links](https://…)', 'اكتب بصيغة ماركداون — **عريض**، *مائل*، - قوائم، # عناوين، [روابط](https://…)')} />
      ) : (
        <div className="md-render" onClick={() => setEditing(true)}>{renderMarkdown(note.content)}</div>
      )}
      <button className="mini-del md-del" onClick={onDel}><X size={13} /></button>
    </div>
  );
}
function NotebookList({ notebooks = [], onOpen, onNew }) {
  if (!onNew) return null;
  return (
    <div className="nb-list">
      <div className="nb-head">{tx('Notebooks', 'الدفاتر')}</div>
      {notebooks.map((n) => (
        <button key={n.id} className="nb-row" style={{ '--ncolour': n.colour }} onClick={() => onOpen(n.id)}>
          <StickyNote size={13} />
          <span className="nb-row-t">{n.title || tx('Untitled', 'بلا عنوان')}</span>
          <span className="nb-row-x">{n.excerpt}</span>
        </button>
      ))}
      <button className="nb-add" onClick={onNew}><Plus size={13} /> {tx('New notebook', 'دفتر جديد')}</button>
    </div>
  );
}

function NotesEditor({ notes, onAdd, onUpdate, onDel }) {
  const [type, setType] = useState('link'); const [val, setVal] = useState('');
  const addUrl = () => { if (val.trim()) { onAdd({ id: uid(), type, content: val.trim() }); setVal(''); } };
  const typeLabel = (tp) => tp === 'link' ? tx('link', 'رابط') : tx('image', 'صورة');
  return (<div className="sect">
    <div className="sect-h">{tx('Description & links', 'الوصف والروابط')}</div>
    {notes.map((n) => (<NoteBlock key={n.id} note={n} onChange={(c) => onUpdate(n.id, c)} onDel={() => onDel(n.id)} />))}
    <button className="ghost sm md-add" onClick={() => onAdd({ id: uid(), type: 'text', content: '' })}><Plus size={14} /> {tx('Add description', 'أضف وصفًا')}</button>
    <div className="note-add">
      <div className="seg">{['link', 'image'].map((tp) => (<button key={tp} className={type === tp ? 'on' : ''} onClick={() => setType(tp)}>{typeLabel(tp)}</button>))}</div>
      <div className="inline-add"><input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addUrl()} placeholder={type === 'link' ? tx('Paste a URL…', 'الصق رابطًا…') : tx('Paste an image URL…', 'الصق رابط صورة…')} /><button className="ghost sm" onClick={addUrl}><Plus size={14} /></button></div>
    </div>
  </div>);
}

/* ------------------------------------------------------------------ */
/*  Task editor                                                        */
/* ------------------------------------------------------------------ */
function TaskEditor({ task, projects, allProjects = [], focusModes = [], weekStart, dateISO, todayISO, vaultOpen = false, onMoveDate, onClose, onChange, onDelete, onToPool, onSaveTemplate, onFocus, notebooks = [], onOpenNotebook, onNewNotebook }) {
  const setField = (k, v) => onChange((t) => ({ ...t, [k]: v }));
  // Vault editing is write-anytime / read-only-in-window: the stored value is
  // never rendered while the window is shut, only replaced wholesale.
  const [vaultDraft, setVaultDraft] = useState('');
  const [vaultEditing, setVaultEditing] = useState(false);
  const [vaultCopied, setVaultCopied] = useState(false);
  const vaultReady = tStartMin(task) != null && tEndMin(task) != null;
  // A vault's window is fixed once set: you can only change the times while the
  // window is actually open, so the times are effectively chosen at creation.
  // Without this you could simply move the window to now and read the secret,
  // which would make the whole lock decorative. `vaultWindowed` is required in
  // the condition so a secret saved BEFORE any times were set stays editable —
  // otherwise it could never be given a window, and so could never unlock.
  const vaultLocksTime = hasVault(task) && vaultWindowed(task) && !vaultOpen;
  // A start time decides the period (blockForTime in core.jsx, applied where
  // the edit is saved), so the period picker only speaks for untimed tasks.
  const timed = tStartMin(task) != null;
  const saveVault = () => { setField('secret', vaultDraft); setVaultDraft(''); setVaultEditing(false); };
  const clearVault = () => { setField('secret', ''); setVaultDraft(''); setVaultEditing(false); };
  const copyVault = async () => {
    try { await navigator.clipboard.writeText(task.secret || ''); setVaultCopied(true); setTimeout(() => setVaultCopied(false), 1600); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <button className="tcheck big" onClick={() => setField('done', !task.done)}>{task.done ? <CheckCircle2 size={22} /> : <Circle size={22} />}</button>
          <input className="title-edit" value={task.title} onChange={(e) => setField('title', e.target.value)} />
          <button className="icon" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body task-edit">
          <div className="edit-card">
            <div className="edit-card-h"><Clock size={13} /> {tx('When', 'الموعد')}</div>
            <div className="edit-grid">
              <label><span>{tx('Date', 'التاريخ')}</span><input className="time-input" type="date" value={dateISO} onChange={(e) => e.target.value && onMoveDate(e.target.value)} /></label>
              <label><span>{timed ? tx('Block · from the time', 'الفترة · من الوقت') : tx('Block', 'الفترة')}</span><select value={task.block} disabled={timed}
                title={timed ? tx('Set by the start time. Clear the time to pick a period by hand.', 'تحددها ساعة البداية. امسح الوقت لتختار الفترة بنفسك.') : undefined}
                onChange={(e) => setField('block', e.target.value)}>{BLOCKS.map((b) => <option key={b.id} value={b.id}>{bName(b)}</option>)}</select></label>
              {/* A hand-set time is the person's own; dropping autoSlot here keeps
                  "Clear slots" and re-slotting from ever overwriting it. */}
              <label><span>{tx('Start', 'البداية')}</span><input className="time-input" type="time" value={task.start || ''} disabled={vaultLocksTime} onChange={(e) => onChange((t) => ({ ...t, start: e.target.value, autoSlot: null }))} /></label>
              <label><span>{tx('End', 'النهاية')}</span><input className="time-input" type="time" value={task.end || ''} disabled={vaultLocksTime} onChange={(e) => onChange((t) => ({ ...t, end: e.target.value, autoSlot: null }))} /></label>
            </div>
            {/* How long it takes, said outright. "Slot the day" used to have to
                deduce this — from memory, a model, or 25 minutes and a guess —
                and a number the person states beats all three. Leaving the
                field is also a lesson: the same title next week starts from it. */}
            <label className="edit-dur">
              <span><Timer size={12} /> {tx('Duration', 'المدة')}</span>
              <span className="edit-dur-in">
                <input className="time-input" type="number" min="5" max="480" step="5" inputMode="numeric"
                  value={task.duration == null || task.duration === '' ? '' : task.duration}
                  placeholder={String(estimateMinutes((() => { const m = durationFor(task.title); return m ? { ...task, duration: null, est: m } : { ...task, duration: null }; })()))}
                  onChange={(e) => setField('duration', e.target.value === '' ? null : Math.max(0, Math.min(480, Math.round(Number(e.target.value) || 0))) || null)}
                  onBlur={() => { const d = taskDuration(task); if (d) rememberDuration(task.title, d, 'manual'); }} />
                <span className="edit-dur-unit">{tx('min', 'دقيقة')}</span>
                {taskDuration(task) != null && <button className="mini-del" onClick={() => setField('duration', null)} aria-label={tx('Clear duration', 'مسح المدة')}><X size={13} /></button>}
              </span>
              <span className="hint-text">{tStartMin(task) != null && tEndMin(task) != null
                ? tx('This task already has a start and an end, so its slot is fixed — the duration is used if you clear them.', 'لهذه المهمة بداية ونهاية، فمكانها ثابت — تُستخدم المدة إن مسحتهما.')
                : taskDuration(task) != null
                  ? tx('Slot the day gives it exactly this long.', '«جدولة اليوم» تمنحها هذه المدة بالضبط.')
                  : tx('Empty: Slot the day estimates it (the number shown).', 'فارغ: «جدولة اليوم» تقدّرها (الرقم الظاهر).')}</span>
            </label>
            {/* Runs until — the whole multi-day feature, in one date. The task
                stays a single task; it simply belongs to every day up to this
                one, and stops being overdue in the meantime. */}
            <label className="edit-span">
              <span><CalendarRange size={12} /> {tx('Runs until', 'تمتد حتى')}</span>
              <span className="edit-span-in">
                <input className="time-input" type="date" min={dateISO} value={taskUntil(task) || ''}
                  onChange={(e) => setField('until', e.target.value || null)} />
                {taskUntil(task) && (
                  <>
                    <span className="edit-span-n">{spanLength(task, parseISO(dateISO))} {tx('days', 'أيام')}</span>
                    <button className="mini-del" onClick={() => setField('until', null)} aria-label={tx('Single day', 'يوم واحد')}><X size={13} /></button>
                  </>
                )}
              </span>
              <span className="hint-text">{taskUntil(task)
                ? tx('Shows on every day in the range, and is only late after the last one.', 'تظهر في كل يوم ضمن المدة، ولا تتأخر إلا بعد آخر يوم.')
                : tx('Leave empty for a single day.', 'اتركه فارغًا ليوم واحد.')}</span>
            </label>
          </div>
          <div className="edit-card">
            <div className="edit-card-h"><Tag size={13} /> {tx('Belongs to', 'تنتمي إلى')}</div>
            <div className="edit-grid">
              <label><span>{tx('Label', 'الوسم')}</span><select value={task.projectId || ''} onChange={(e) => setField('projectId', e.target.value || null)}><option value="">{tx('— none —', '— بدون —')}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label><span>{tx('Project', 'المشروع')}</span><select value={task.projectRef || ''} onChange={(e) => setField('projectRef', e.target.value || null)}><option value="">{tx('— none —', '— بدون —')}</option>{allProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            </div>
          </div>
          {/* The reading, and the override for when the reading is wrong. Auto is
              shown even while overridden so you can always see what you argued
              with — this is the one knob that can inflate the currency. */}
          <div className="worth-row">
            <Coins size={13} />
            <span className="worth-label">{tx('Worth', 'القيمة')}</span>
            <input className="worth-input" type="number" min="0" placeholder={String(autoWorth(task))}
              value={task.worth === '' || task.worth == null ? '' : task.worth}
              onChange={(e) => setField('worth', e.target.value === '' ? null : e.target.value)} />
            <span className="worth-auto">
              {task.worth == null || task.worth === ''
                ? `${tx('auto', 'تلقائي')} · ${(task.subtasks || []).length ? tx('split across steps', 'مقسّمة على الخطوات') : tx('on completion', 'عند الإنجاز')}`
                : `${tx('auto would be', 'التلقائي')} ${autoWorth(task)}`}
              {(Number(task.pushes) || 0) > 0 ? ` · ${tx('pushed', 'مؤجّلة')} ×${Number(task.pushes)}` : ''}
              {(() => { // what "Slot the day" would give it: its own duration, then memory, cache, heuristic
                if (taskDuration(task) != null) return ` · ${taskDuration(task)}${tx('m', 'د')} ${tx('(set)', '(محددة)')}`;
                const m = durationFor(task.title);
                const est = estimateMinutes(m ? { ...task, est: m } : task);
                return ` · ~${est}${tx('m', 'د')}${m ? ` ${tx('(remembered)', '(محفوظة)')}` : ''}`;
              })()}
            </span>
          </div>
          <div className="editor-actions">
            <button className="ghost sm" onClick={onToPool}><Inbox size={14} /> {tx('To backlog', 'إلى قائمة الانتظار')}</button>
            <button className="ghost sm" onClick={onSaveTemplate}><Repeat size={14} /> {tx('Make recurring', 'اجعلها متكررة')}</button>
          </div>
          <div className="edit-focus-row">
            <span className="edit-focus-label"><Clock size={13} /> {tx('Focus for', 'ركّز لمدة')}</span>
            {[10, 20, 30, 45].map((mn) => (<button key={mn} className="ghost sm" onClick={() => onFocus(mn)}>{mn}{tx('m', 'د')}</button>))}
            {tEndMin(task) != null && <button className="ghost sm focus-whole" onClick={() => onFocus(null, true)}>{tx('Until end', 'حتى النهاية')}</button>}
          </div>
          {/* The focus mode a round on this task starts in. Empty falls back to
              its tag's, then its project's (see src/focusmode.js), and the
              first option says which — so "none" never hides an inherited one.
              Desktop only: the modes live in the shell. */}
          {focusModes.length > 0 && (() => {
            const inherited = focusModeFor({ ...task, focusMode: null }, projects, allProjects, focusModes);
            const inhName = inherited ? (focusModes.find((m) => modeKey(m.id) === inherited.id) || {}).name : '';
            const own = modeKey(task.focusMode);
            return (
              <label className="worth-row focus-mode-row">
                <Timer size={13} />
                <span className="worth-label">{tx('Focus mode', 'نمط التركيز')}</span>
                <select value={own && focusModes.some((m) => modeKey(m.id) === own) ? own : ''} onChange={(e) => setField('focusMode', e.target.value || null)}>
                  <option value="">{inherited
                    ? `${inhName} (${inherited.from === 'tag' ? tx('from its tag', 'من وسمها') : tx('from its project', 'من مشروعها')})`
                    : tx('— none —', '— بدون —')}</option>
                  {focusModes.map((m) => <option key={modeKey(m.id)} value={modeKey(m.id)}>{m.name}</option>)}
                </select>
              </label>
            );
          })()}
          {/* A target for the day, and the minutes actually measured against it.
              Ticking a task says you finished it; this says you gave it the
              time you said you would — which is the honest question for work
              that is never really "done". Counted per day, so a target on a
              task you return to all week means something on each of them. */}
          <div className="worth-row focus-target-row">
            <Timer size={13} />
            <span className="worth-label">{tx('Focus target', 'هدف التركيز')}</span>
            <input className="worth-input" type="number" min="0" step="5" placeholder={tx('none', 'بلا')}
              value={task.focusTarget == null || task.focusTarget === '' ? '' : task.focusTarget}
              onChange={(e) => setField('focusTarget', e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0))} />
            <span className="worth-auto">
              {focusTargetMin(task) == null
                ? tx('minutes a day — measured rounds count towards it', 'دقائق يوميًا — تُحسب الجولات المقيسة ضمنها')
                : (<>
                    {focusSpent(task, todayISO)}/{focusTargetMin(task)}{tx('m', 'د')} {tx('today', 'اليوم')}
                    {focusMet(task, todayISO)
                      ? <span className="focus-met"><Check size={11} /> {tx('met', 'تحقّق')}</span>
                      : <span className="focus-left">{tx('left', 'متبقٍ')} {Math.max(0, focusTargetMin(task) - focusSpent(task, todayISO))}{tx('m', 'د')}</span>}
                  </>)}
            </span>
          </div>
          {/* The vault folds shut: most tasks have no secret, and a closed fold
              is how a rarely-used lockbox should read. Open when it holds one. */}
          <details className="edit-fold" open={hasVault(task) || undefined}>
            <summary><Lock size={13} /> {tx('Time vault', 'خزنة موقّتة')}{hasVault(task) ? <span className="fold-note">{vaultOpen ? tx('open now', 'مفتوحة الآن') : tx('holding something', 'تحوي شيئًا')}</span> : null}</summary>
            <p className="hint-text" style={{ marginTop: 0, marginBottom: 8 }}>
              {tx('Hold something you only want back during this task’s window — it stays hidden until then, and re-hides after. Friction, not a safe: it is stored in plain text on this device and appears in backup exports.',
                'احتفظ بشيء لا تريده إلا خلال وقت هذه المهمة — يبقى مخفيًا حتى ذلك الحين ثم يُخفى مجددًا. هذا عائق وليس خزنة: يُحفظ كنص عادي على هذا الجهاز ويظهر في النسخ الاحتياطية.')}
            </p>
            {!vaultReady && (
              <p className="hint-text vault-warn" style={{ marginTop: 0 }}><AlertCircle size={12} /> {tx('Set both a start and an end time above, or it can never unlock.', 'حدّد وقت بداية ونهاية أعلاه، وإلا فلن تُفتح أبدًا.')}</p>
            )}
            {vaultLocksTime && (
              <p className="hint-text vault-warn" style={{ marginTop: 0 }}><Lock size={12} /> {tx('The times are locked while this is shut — you can only change them during the window itself. The date is always free to move.', 'الأوقات مقفلة أثناء إغلاق الخزنة — لا يمكنك تغييرها إلا خلال وقتها. أما التاريخ فيمكن تغييره دائمًا.')}</p>
            )}
            {!hasVault(task) || vaultEditing ? (
              <div className="inline-add vault-add">
                <input type="password" autoComplete="off" value={vaultDraft} onChange={(e) => setVaultDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && vaultDraft) saveVault(); if (e.key === 'Escape') { setVaultDraft(''); setVaultEditing(false); } }}
                  placeholder={tx('Something to unlock later…', 'شيء يُفتح لاحقًا…')} />
                <button className="ghost sm" disabled={!vaultDraft} onClick={saveVault}>{tx('Save', 'حفظ')}</button>
                {vaultEditing && <button className="ghost sm" onClick={() => { setVaultDraft(''); setVaultEditing(false); }}>{tx('Cancel', 'إلغاء')}</button>}
              </div>
            ) : vaultOpen ? (
              <div className="vault-row open">
                <code className="vault-value">{task.secret}</code>
                <button className="ghost sm" onClick={copyVault}><Copy size={13} /> {vaultCopied ? tx('Copied', 'تم النسخ') : tx('Copy', 'نسخ')}</button>
                <button className="ghost sm" onClick={() => setVaultEditing(true)}>{tx('Replace', 'استبدال')}</button>
                <button className="mini-del" onClick={clearVault} aria-label={tx('Remove', 'إزالة')}><X size={13} /></button>
              </div>
            ) : (
              <div className="vault-row">
                <span className="vault-masked"><Lock size={13} /> ••••••••</span>
                <span className="vault-when">{vaultReady ? `${tx('Unlocks', 'تُفتح')} ${timeLabel(task)}` : tx('No window set', 'لا يوجد وقت محدد')}</span>
                <button className="ghost sm" onClick={() => setVaultEditing(true)}>{tx('Replace', 'استبدال')}</button>
                <button className="mini-del" onClick={clearVault} aria-label={tx('Remove', 'إزالة')}><X size={13} /></button>
              </div>
            )}
          </details>
          <SubtaskEditor subtasks={task.subtasks} onAdd={(title) => onChange((t) => ({ ...t, subtasks: [...t.subtasks, { id: uid(), title, done: false }] }))} onToggle={(id) => onChange((t) => ({ ...t, subtasks: t.subtasks.map((s) => s.id === id ? { ...s, done: !s.done } : s) }))} onDel={(id) => onChange((t) => ({ ...t, subtasks: t.subtasks.filter((s) => s.id !== id) }))} onMove={(id, targetId, after) => onChange((t) => ({ ...t, subtasks: moveById(t.subtasks || [], id, targetId, after) }))} />
          <NotesEditor notes={task.notes || []} onAdd={(n) => onChange((t) => ({ ...t, notes: [...(t.notes || []), n] }))} onUpdate={(id, c) => onChange((t) => ({ ...t, notes: (t.notes || []).map((x) => x.id === id ? { ...x, content: c } : x) }))} onDel={(id) => onChange((t) => ({ ...t, notes: (t.notes || []).filter((x) => x.id !== id) }))} />
          <NotebookList notebooks={notebooks} onOpen={onOpenNotebook} onNew={onNewNotebook} />
        </div>
        <div className="modal-foot"><button className="danger" onClick={onDelete}><Trash2 size={14} /> {tx('Delete', 'حذف')}</button><button className="primary" onClick={onClose}>{tx('Done', 'تم')}</button></div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pool item editor                                                   */
/* ------------------------------------------------------------------ */
/* The Duration box for anything that becomes a task — a backlog item or a
   recurring task hands its duration to every task made from it, so Slot the
   day sizes that task by it instead of guessing. The placeholder is what the
   slotter would use today, so an empty box still says something true. */
function DurationInput({ item, onChange, compact = false }) {
  const own = taskDuration(item);
  const guess = (() => { const m = durationFor(item.title); return estimateMinutes(m ? { ...item, duration: null, est: m } : { ...item, duration: null }); })();
  return (
    <label className={`dur-input${compact ? ' compact' : ''}`}>
      <span><Timer size={12} /> {tx('Duration', 'المدة')}</span>
      <span className="edit-dur-in">
        <input className="time-input" type="number" min="5" max="480" step="5" inputMode="numeric"
          value={own == null ? '' : item.duration}
          placeholder={String(guess)}
          onChange={(e) => onChange(e.target.value === '' ? null : Math.max(0, Math.min(480, Math.round(Number(e.target.value) || 0))) || null)}
          onBlur={() => { if (own) rememberDuration(item.title, own, 'manual'); }}
          aria-label={tx('Duration in minutes', 'المدة بالدقائق')} />
        <span className="edit-dur-unit">{tx('min', 'دقيقة')}</span>
        {own != null && <button className="mini-del" onClick={() => onChange(null)} aria-label={tx('Clear duration', 'مسح المدة')}><X size={13} /></button>}
      </span>
      {!compact && <span className="hint-text">{own != null
        ? tx('Every task made from this is slotted for exactly this long.', 'كل مهمة تُنشأ من هنا تُجدول بهذه المدة بالضبط.')
        : tx('Empty: Slot the day estimates it (the number shown).', 'فارغ: «جدولة اليوم» تقدّرها (الرقم الظاهر).')}</span>}
    </label>
  );
}

function PoolEditor({ item, projects, allProjects = [], onClose, onChange, onDelete, onToDay, onSaveTemplate, notebooks = [], onOpenNotebook, onNewNotebook }) {
  const setField = (k, v) => onChange((t) => ({ ...t, [k]: v }));
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <Inbox size={20} style={{ color: 'var(--muted)' }} />
          <input className="title-edit" value={item.title} onChange={(e) => setField('title', e.target.value)} />
          <button className="icon" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="row2">
            <label><span>{tx('Label', 'الوسم')}</span><select value={item.projectId || ''} onChange={(e) => setField('projectId', e.target.value || null)}><option value="">{tx('— none —', '— بدون —')}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label><span>{tx('Project', 'المشروع')}</span><select value={item.projectRef || ''} onChange={(e) => setField('projectRef', e.target.value || null)}><option value="">{tx('— none —', '— بدون —')}</option>{allProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          </div>
          <DurationInput item={item} onChange={(v) => setField('duration', v)} />
          <div className="editor-actions">
            <button className="primary sm" onClick={onToDay}><CornerUpRight size={14} /> {tx('Schedule on a day', 'جدولة في يوم')}</button>
            <button className="ghost sm" onClick={onSaveTemplate}><Repeat size={14} /> {tx('Save as recurring', 'حفظ كمتكررة')}</button>
          </div>
          <SubtaskEditor subtasks={item.subtasks || []} onAdd={(title) => onChange((t) => ({ ...t, subtasks: [...(t.subtasks || []), { id: uid(), title, done: false }] }))} onToggle={(id) => onChange((t) => ({ ...t, subtasks: (t.subtasks || []).map((s) => s.id === id ? { ...s, done: !s.done } : s) }))} onDel={(id) => onChange((t) => ({ ...t, subtasks: (t.subtasks || []).filter((s) => s.id !== id) }))} onMove={(id, targetId, after) => onChange((t) => ({ ...t, subtasks: moveById(t.subtasks || [], id, targetId, after) }))} />
          <NotesEditor notes={item.notes || []} onAdd={(n) => onChange((t) => ({ ...t, notes: [...(t.notes || []), n] }))} onUpdate={(id, c) => onChange((t) => ({ ...t, notes: (t.notes || []).map((x) => x.id === id ? { ...x, content: c } : x) }))} onDel={(id) => onChange((t) => ({ ...t, notes: (t.notes || []).filter((x) => x.id !== id) }))} />
          <NotebookList notebooks={notebooks} onOpen={onOpenNotebook} onNew={onNewNotebook} />
        </div>
        <div className="modal-foot"><button className="danger" onClick={onDelete}><Trash2 size={14} /> {tx('Delete', 'حذف')}</button><button className="primary" onClick={onClose}>{tx('Done', 'تم')}</button></div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Points — the balance, what it buys, and where it came from.        */
/* ------------------------------------------------------------------ */
/* The ledger is on screen and not just the balance, on purpose. The
   problem this feature exists to solve is forgetting to reward yourself,
   and a bare number can't show you that you actually did. */
function PointsPanel({ balance, ledger, rewards, penalties = [], onClose, onAddReward, onUpdReward, onDelReward, onCashIn, onForget, onReset, onAddPenalty, onUpdPenalty, onDelPenalty, onCharge }) {
  const [editing, setEditing] = useState(null);
  const [editingPen, setEditingPen] = useState(null);
  const [confirmPen, setConfirmPen] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const recent = ledger.slice().reverse().slice(0, 40);
  const kindLabel = { task: tx('task', 'مهمة'), subtask: tx('step', 'خطوة'), habit: tx('habit', 'عادة'), goal: tx('goal', 'هدف'), spend: tx('spent', 'صرف'), penalty: tx('slipped', 'انزلاق'), wipe: tx('wiped', 'مُسحت') };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal points-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>{tx('Points', 'النقاط')}</strong>
          <button className="icon" onClick={onClose} aria-label={tx('Close', 'إغلاق')}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="pts-balance"><Coins size={22} /><span className="pts-num">{balance}</span><span className="pts-cap">{tx('points to spend', 'نقطة للصرف')}</span></div>

          <div className="pts-sec-h">
            <span>{tx('Rewards', 'المكافآت')}</span>
            <button className="ghost sm" onClick={onAddReward}><Plus size={13} /> {tx('Add', 'إضافة')}</button>
          </div>
          {!rewards.length ? (
            <p className="hint-text">{tx('Nothing to buy yet. Add something you actually want — an hour of games, a takeaway, whatever. The price is yours to set; that is what makes the points mean anything.', 'لا شيء للشراء بعد. أضف شيئًا تريده فعلًا — ساعة ألعاب، وجبة، أيًّا كان. أنت من يحدد السعر، وهذا ما يجعل للنقاط معنى.')}</p>
          ) : (
            <ul className="pts-rewards">{rewards.map((r) => {
              const cost = Number(r.cost) || 0;
              const afford = cost > 0 && cost <= balance;
              return (
                <li key={r.id} className="pts-reward">
                  {editing === r.id ? (
                    <div className="pts-reward-edit">
                      <input value={r.name} onChange={(e) => onUpdReward(r.id, { name: e.target.value })} placeholder={tx('Reward', 'مكافأة')} />
                      <input type="number" min="1" value={r.cost} onChange={(e) => onUpdReward(r.id, { cost: e.target.value })} placeholder={tx('Cost', 'السعر')} />
                      <button className="ghost sm" onClick={() => setEditing(null)}><Check size={13} /></button>
                      <button className="danger sm" onClick={() => { onDelReward(r.id); setEditing(null); }}><Trash2 size={13} /></button>
                    </div>
                  ) : (<>
                    <button className="pts-reward-main" onClick={() => setEditing(r.id)}>
                      <span className="pts-reward-name">{r.name || tx('Untitled reward', 'مكافأة بلا اسم')}</span>
                      <span className="pts-reward-cost">{cost}</span>
                    </button>
                    <button className="primary sm" disabled={!afford} onClick={() => onCashIn(r)}>
                      <Gift size={13} /> {tx('Cash in', 'اصرفها')}
                    </button>
                  </>)}
                </li>
              );
            })}</ul>
          )}

          {/* The other direction.

              A number that can only ever grow is a number nobody protects, and
              the habits worth stopping had nowhere to land: they cost you
              nothing here, which is exactly backwards. These are priced the
              same way rewards are, by the person they apply to.

              Charging one is a two-tap confirm, because a mis-tap that takes
              points is worse than a mis-tap that gives them — and a wipe is
              confirmed with the number it is about to take, so nobody presses
              it without seeing what it costs. */}
          <div className="pts-sec-h">
            <span>{tx('Penalties', 'الغرامات')}</span>
            <button className="ghost sm" onClick={onAddPenalty}><Plus size={13} /> {tx('Add', 'إضافة')}</button>
          </div>
          {!penalties.length ? (
            <p className="hint-text">{tx('Nothing here yet. These are the habits you are trying to stop — put a price on one, or make it a wipe if it is the kind of slip that should cost you the whole balance.', 'لا شيء هنا بعد. هذه هي العادات التي تحاول التوقف عنها — ضع سعرًا لإحداها، أو اجعلها ماسحة إن كانت زلّة تستحق أن تكلّفك رصيدك كله.')}</p>
          ) : (
            <ul className="pts-rewards">{penalties.map((r) => {
              const cost = Number(r.cost) || 0;
              return (
                <li key={r.id} className="pts-reward pts-penalty">
                  {editingPen === r.id ? (
                    <div className="pts-reward-edit">
                      <input value={r.name} onChange={(e) => onUpdPenalty(r.id, { name: e.target.value })} placeholder={tx('What you are trying to stop', 'ما تحاول التوقف عنه')} />
                      <input type="number" min="1" value={r.wipe ? '' : r.cost} disabled={!!r.wipe}
                        onChange={(e) => onUpdPenalty(r.id, { cost: e.target.value })} placeholder={tx('Cost', 'الكلفة')} />
                      <label className="check pen-wipe">
                        <input type="checkbox" checked={!!r.wipe} onChange={(e) => onUpdPenalty(r.id, { wipe: e.target.checked })} />
                        <span>{tx('wipe it all', 'امسح الكل')}</span>
                      </label>
                      <button className="ghost sm" onClick={() => setEditingPen(null)}><Check size={13} /></button>
                      <button className="danger sm" onClick={() => { onDelPenalty(r.id); setEditingPen(null); }}><Trash2 size={13} /></button>
                    </div>
                  ) : confirmPen === r.id ? (
                    <div className="pts-pen-confirm">
                      <span>{r.wipe
                        ? `${tx('Wipe all', 'امسح كل')} ${balance} ${tx('points?', 'نقطة؟')}`
                        : `${tx('Charge', 'اخصم')} ${cost}?`}</span>
                      <span className="pts-reset-btns">
                        <button className="danger sm" onClick={() => { onCharge(r); setConfirmPen(null); }}>{tx('Yes, I did it', 'نعم، فعلتها')}</button>
                        <button className="ghost sm" onClick={() => setConfirmPen(null)}>{tx('Cancel', 'إلغاء')}</button>
                      </span>
                    </div>
                  ) : (<>
                    <button className="pts-reward-main" onClick={() => setEditingPen(r.id)}>
                      <span className="pts-reward-name">{r.name || tx('Untitled penalty', 'غرامة بلا اسم')}</span>
                      <span className="pts-reward-cost pen">{r.wipe ? tx('all of it', 'كل الرصيد') : `−${cost}`}</span>
                    </button>
                    <button className="danger sm" disabled={!r.wipe && cost <= 0} onClick={() => setConfirmPen(r.id)}>
                      <Ban size={13} /> {tx('I slipped', 'انزلقت')}
                    </button>
                  </>)}
                </li>
              );
            })}</ul>
          )}

          <div className="pts-sec-h"><span>{tx('Ledger', 'السجل')}</span></div>
          {!recent.length ? (
            <p className="hint-text">{tx('Nothing earned yet. Finish something.', 'لم تكسب شيئًا بعد. أنجز شيئًا.')}</p>
          ) : (
            <ul className="pts-ledger">{recent.map((e) => (
              <li key={e.ref} className={`pts-entry ${e.amount < 0 ? 'spend' : ''}`}>
                <span className="pts-entry-amt">{e.amount > 0 ? `+${e.amount}` : e.amount}</span>
                <span className="pts-entry-title">{e.title}</span>
                <span className="pts-entry-meta">
                  {kindLabel[e.kind] || e.kind}{e.meta && e.meta.late ? ` · ${tx('late', 'متأخر')}` : ''}{e.kind === 'wipe' && e.meta ? ` · ${e.meta.wiped} ${tx('gone', 'ذهبت')}` : ''} · {e.day}
                </span>
                {['spend', 'penalty', 'wipe'].includes(e.kind) && <button className="icon sm" onClick={() => onForget(e.ref)} aria-label={tx('Remove', 'إزالة')} title={tx('Logged by mistake?', 'سُجّل بالخطأ؟')}><X size={13} /></button>}
              </li>
            ))}</ul>
          )}

          {/* Starting over. Deliberately at the very bottom, past the ledger it
              erases — the whole history goes with the balance, which is the
              honest version of "from scratch". */}
          <div className="pts-sec-h danger-h"><span>{tx('Start over', 'البدء من جديد')}</span></div>
          {confirmReset ? (
            <div className="pts-reset-confirm">
              <span>{tx('Erase every point and the whole ledger? This cannot be undone.', 'مسح كل النقاط والسجل كاملًا؟ لا يمكن التراجع.')}</span>
              <span className="pts-reset-btns">
                <button className="danger sm" onClick={() => { onReset(); setConfirmReset(false); }}>{tx('Erase it all', 'امسح الكل')}</button>
                <button className="ghost sm" onClick={() => setConfirmReset(false)}>{tx('Keep it', 'أبقِه')}</button>
              </span>
            </div>
          ) : (
            <button className="ghost sm pts-reset" onClick={() => setConfirmReset(true)}><Trash2 size={13} /> {tx('Reset points to zero', 'تصفير النقاط')}</button>
          )}
        </div>
        <div className="modal-foot"><button className="primary" onClick={onClose}>{tx('Done', 'تم')}</button></div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Habits — daily commitments; streaks glow brighter up to seven days */
/* ------------------------------------------------------------------ */
export { AppIcon,BlockRow,DurationInput,PaceChip,PaceStrip,ProjectTag,QuickAdd,QuotaLine,TokenSuggest,FlameGlyph,HabitLine,Landscape,NoteBlock,NotesEditor,PlanSide,PointsPanel,PoolEditor,SkyScene,SubtaskEditor,TaskEditor,pyramidPath };
