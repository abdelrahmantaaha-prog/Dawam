import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Plus, X, Check, ChevronLeft, ChevronRight, Settings, Sparkles, Trash2, Link as LinkIcon, Image as ImageIcon, StickyNote, Loader2, CheckCircle2, Circle, AlertCircle, Tag, Clock, GripVertical, Inbox, LayoutTemplate, CornerUpRight, Copy, Calendar, Target, TrendingUp, Flag, Languages, Repeat, ChevronDown, Flame, Lock, Shield, KeyRound, Delete, Rows3 } from 'lucide-react';
import { boardSummary, columnsOf } from './board.js';
import { isOath,OATH_AR,hashPin,APP_VERSION,BLOCKS,CAIRO,D2R,DEFAULT_LABELS,DEFAULT_SETTINGS,DEFAULT_TIMINGS,LABEL_ICON,LABEL_SWATCHES,LANG,LANGS,MONTHS,MONTHS_AR,PRAYER_BLOCKS,SKY_KEYFRAMES,TIME_24,WEEKDAYS,WEEKDAYS_AR,WEEKDAYS_FULL,WEEKDAYS_FULL_AR,activeBlockAt,addDays,bHint,bName,bSub,blockById,cleanTime,computePrayerTimes,darcsin,darctan2,dsin,firstJsonObject,fixAngle,fixHour,fmtISO,fmtTime,glowLevel,habitDoneOn,habitStreak,inWindow,isRTL,julianDay,lerpArr,lerpN,mdInline,migrateSettings,minutesOf,mkSubs,mm2,mon,newHabit,newProject,pad,parseISO,parseRange,projectPace,projectProgress,renderMarkdown,rgbStr,rgbaStr,sameDay,setLang,setTime24,skyAt,startOfWeek,sunPosition,tx,tEndMin,tStartMin,timeLabel,timeOrder,toHM,uid,vBlock,wd,wdFull,weekdayFullList,windowBounds } from './core.jsx';
import { rawGet, rawSet, rawDelete, rawList, loadKey, saveKey, storageAvailable } from './storage.js';

import { AppIcon,BlockRow,FlameGlyph,HabitLine,Landscape,NoteBlock,NotesEditor,PlanSide,PoolEditor,SkyScene,SubtaskEditor,TaskEditor,pyramidPath } from './components.jsx';
import { saveJson } from './files.js';
import { CalendarSettings } from './calview.jsx';
import { TrelloSettings } from './trelloview.jsx';
function HabitsView({ habits, sky, stars, heroLight, todayISO: todayISOProp, onAdd, onUpd, onDel, onToggleDay, onFocus }) {
  const [openId, setOpenId] = useState(null);
  // The day runs Fajr → next Fajr, so "today" comes from the caller, which
  // knows the boundary. Falling back to the calendar date would mean that
  // before dawn every habit looked unkept and every streak looked broken.
  const todayISO = todayISOProp || fmtISO(new Date());
  const doneToday = habits.filter((h) => habitDoneOn(h, todayISO)).length;
  return (
    <div className="hero-card wide">
      <SkyScene sky={sky} stars={stars} light={heroLight}
        label={tx('Habits', 'العادات')} time={String(doneToday)}
        blockName={habits.length ? tx('kept today', 'أُنجزت اليوم') : tx('no habits yet', 'لا عادات بعد')} blockAr=""
        range={habits.length ? `${doneToday}/${habits.length} ${tx('done today', 'اليوم')}` : tx('build a daily rhythm', 'ابنِ إيقاعًا يوميًا')} />
      <div className="hero-sheet">
        {habits.length === 0 && (
          <div className="proj-empty">
            <Flame size={26} />
            <p>{tx('Commit to something daily — reading, exercise, writing morning pages. Check it off each day; the longer your streak, the brighter it glows, up to a full week.', 'التزم بشيء يومي — القراءة، الرياضة، الكتابة. علّمه كل يوم؛ وكلما طالت سلسلتك زاد توهّجها، حتى أسبوع كامل.')}</p>
          </div>
        )}
        {BLOCKS.map((b) => {
          const group = habits.filter((h) => (h.block || 'morning') === b.id);
          if (!group.length) return null;
          return (
            <div key={b.id} className="habit-group">
              <div className="habit-group-h blk-ink" style={{ '--bi-light': b.accentDeep, '--bi-dark': b.accent }}>{bName(b)}{bSub(b) ? ` · ${bSub(b)}` : ''}</div>
              {group.map((h) => (
                <HabitCard key={h.id} h={h} todayISO={todayISO} open={openId === h.id}
                  onOpen={() => setOpenId(openId === h.id ? null : h.id)}
                  onUpd={(patch) => onUpd(h.id, patch)} onDel={() => { onDel(h.id); setOpenId(null); }}
                  onToggle={(iso) => onToggleDay(h.id, iso)} onFocus={(mins) => onFocus(h, mins)} />
              ))}
            </div>
          );
        })}
        <button className="plan-day-btn proj-add" onClick={() => { const nh = onAdd(); setOpenId(nh.id); }}><Plus size={15} /> {tx('New habit', 'عادة جديدة')}</button>
      </div>
    </div>
  );
}

function HabitCard({ h, todayISO, open, onOpen, onUpd, onDel, onToggle, onFocus }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const isPrayer = !!h.prayer; // built-in, derived from the prayer log
  const streak = habitStreak(h, todayISO);
  const glow = glowLevel(streak);
  const doneToday = habitDoneOn(h, todayISO);
  // last 7 days, oldest → newest
  const today = parseISO(todayISO);
  const week = Array.from({ length: 7 }, (_, i) => { const d = addDays(today, i - 6); return { iso: fmtISO(d), d, done: habitDoneOn(h, fmtISO(d)) }; });
  return (
    <div className={`habit-card glow-${glow}`} style={{ '--hcolor': h.color }}>
      <div className="habit-top">
        <button className={`habit-check ${doneToday ? 'on' : ''}`} onClick={() => onToggle(todayISO)} aria-label={tx('Toggle today', 'تبديل اليوم')}>
          {doneToday ? <CheckCircle2 size={22} /> : <Circle size={22} />}
        </button>
        <button className="habit-main" onClick={onOpen}>
          <span className="habit-name">{h.name}</span>
          <span className="habit-streak"><FlameGlyph level={glow} size={13} /> {streak > 0 ? `${streak} ${tx('day', 'يوم')}${streak !== 1 && LANG !== 'ar' ? 's' : ''}` : tx('no streak', 'لا سلسلة')}{glow >= 7 ? ` · ${tx('max glow', 'أقصى توهّج')}` : ''}</span>
        </button>
        <ChevronDown size={16} className="proj-caret" style={{ transform: open ? 'rotate(180deg)' : 'none' }} onClick={onOpen} />
      </div>
      <div className="habit-week">
        {week.map((day) => (
          <button key={day.iso} className={`habit-day ${day.done ? 'on' : ''} ${day.iso === todayISO ? 'today' : ''}`} onClick={() => onToggle(day.iso)} title={day.iso}>
            <span className="habit-day-d">{wd(day.d.getDay())[0]}</span>
            <span className="habit-day-dot" />
          </button>
        ))}
      </div>
      <div className="habit-ember-track"><span className="habit-ember" style={{ width: `${(glow / 7) * 100}%` }} /></div>
      {open && (
        <div className="proj-edit">
          {isPrayer ? (
            <p className="hint-text" style={{ margin: 0 }}>{tx('Built-in — tracked from the prayer gate. Marking it here and praying at the gate are the same record.', 'مدمجة — تُتتبَّع من قفل الصلاة. تعليمها هنا والصلاة عند القفل سجلٌ واحد.')}</p>
          ) : (<>
          <div className="proj-field"><span>{tx('Habit name', 'اسم العادة')}</span><input className="projname" value={h.name} onChange={(e) => onUpd({ name: e.target.value })} /></div>
          <div className="proj-grid2">
            <label><span>{tx('Colour', 'اللون')}</span><input className="swatch proj-swatch" type="color" value={h.color} onChange={(e) => onUpd({ color: e.target.value })} /></label>
            <label><span>{tx('Day period', 'فترة اليوم')}</span><select className="time-input" value={h.block || 'morning'} onChange={(e) => onUpd({ block: e.target.value })}>{BLOCKS.map((b) => <option key={b.id} value={b.id}>{bName(b)}</option>)}</select></label>
          </div>
          </>)}
          <div className="proj-field">
            <span>{tx('Focus on this habit', 'ركّز على هذه العادة')}</span>
            <div className="focus-choices">
              {[5, 10, 15, 20, 30, 45].map((mn) => (<button key={mn} className="ghost sm" onClick={() => onFocus(mn)}>{mn}{tx('m', 'د')}</button>))}
            </div>
            <p className="hint-text" style={{ margin: '4px 0 0' }}>{tx('Locks Rhythm for the duration, like a task focus lock. You can end early.', 'يقفل التطبيق طوال المدة، مثل قفل تركيز المهام. يمكنك الإنهاء مبكرًا.')}</p>
          </div>
          {!isPrayer && <div className="proj-edit-foot">
            {confirmDel ? (
              <span className="od-confirm">{tx('Delete this habit?', 'حذف هذه العادة؟')}<button className="danger sm" onClick={onDel}>{tx('Yes', 'نعم')}</button><button className="ghost sm" onClick={() => setConfirmDel(false)}>{tx('Cancel', 'إلغاء')}</button></span>
            ) : (
              <button className="danger sm" onClick={() => setConfirmDel(true)}><Trash2 size={14} /> {tx('Delete habit', 'حذف العادة')}</button>
            )}
          </div>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Projects (long-term) — goals, linked tasks, progress & pace         */
/* ------------------------------------------------------------------ */
function ProjectsView({ projects, sky, stars, heroLight, onAdd, onUpd, onDel, onLog, taskList, onToggleTask, onOpenTask, onBoard }) {
  const [openId, setOpenId] = useState(null);
  const ordered = [...projects].sort((a, b) => (a.completedAt ? 1 : 0) - (b.completedAt ? 1 : 0));
  const active = projects.filter((p) => !p.completedAt);
  const onTrackN = active.filter((p) => projectPace(p).onPace === true).length;
  const doneN = projects.length - active.length;
  return (
    <div className="hero-card wide">
      <SkyScene sky={sky} stars={stars} light={heroLight}
        label={tx('Projects', 'المشاريع')} time={String(projects.length)}
        blockName={projects.length ? tx('long-term goals', 'أهداف طويلة المدى') : tx('nothing running yet', 'لا مشاريع بعد')} blockAr=""
        range={projects.length ? (active.length ? `${onTrackN}/${active.length} ${tx('on pace', 'على المسار')}${doneN ? ` · ${doneN} ${tx('done', 'منجز')}` : ''}` : `${doneN} ${tx('completed', 'مكتمل')}`) : tx('start something big', 'ابدأ شيئًا كبيرًا')} />
      <div className="hero-sheet">
        {projects.length === 0 && (
          <div className="proj-empty">
            <Target size={26} />
            <p>{tx('Track anything with a finish line — translating a book, a course, a series of investigations. Set a target and a deadline, log progress as you go, link tasks to it, and Rhythm tells you whether you are on pace.', 'تابِع أي شيء له خط نهاية — ترجمة كتاب، أو دورة، أو سلسلة تحقيقات. حدّد هدفًا وموعدًا نهائيًا، وسجّل تقدّمك، واربط المهام به، وسيخبرك التطبيق إن كنت على المسار الصحيح.')}</p>
          </div>
        )}
        {ordered.map((p) => (
          <ProjectCard key={p.id} p={p} open={openId === p.id}
            onOpen={() => setOpenId(openId === p.id ? null : p.id)}
            onUpd={(patch) => onUpd(p.id, patch)} onDel={() => { onDel(p.id); setOpenId(null); }}
            onLog={(amt, note) => onLog(p.id, amt, note)} taskInfo={taskList(p.id)}
            onToggleTask={onToggleTask} onOpenTask={onOpenTask} onBoard={() => onBoard && onBoard(p.id)} />
        ))}
        <button className="plan-day-btn proj-add" onClick={() => { const np = onAdd(); setOpenId(np.id); }}><Plus size={15} /> {tx('New project', 'مشروع جديد')}</button>
      </div>
    </div>
  );
}

function ProjectCard({ p, open, onOpen, onUpd, onDel, onLog, taskInfo, onToggleTask, onOpenTask, onBoard }) {
  const [amt, setAmt] = useState('');
  const [note, setNote] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const pace = projectPace(p);
  const pctLabel = Math.round(pace.pct * 100);
  const unit = p.unit || tx('units', 'وحدة');
  const completed = !!p.completedAt;
  const hasTarget = Number(p.target) > 0; // numeric targets are optional
  const submitLog = () => { const n = Number(amt); if (!n) return; onLog(n, note.trim()); setAmt(''); setNote(''); };
  const tasks = (taskInfo && taskInfo.tasks) || [];
  const lanes = boardSummary(tasks, columnsOf(p));
  // Pace status: green (ahead/on), amber (a little behind), red (well behind)
  let statusClass = 'neutral', statusText = hasTarget ? tx('no deadline set', 'لا موعد نهائي') : tx('in progress', 'قيد التنفيذ');
  if (completed) { statusClass = 'done'; statusText = tx('completed', 'مكتمل'); }
  else if (pace.notStarted) { statusClass = 'neutral'; statusText = tx('not started yet', 'لم يبدأ بعد'); }
  else if (pace.onPace === true) { statusClass = 'ok'; statusText = tx('on pace', 'على المسار'); }
  else if (pace.onPace === false) {
    const gap = pace.expected != null ? (pace.expected - pace.done) / (p.target || 1) : 0;
    statusClass = gap > 0.12 ? 'behind' : 'warn';
    statusText = tx('behind pace', 'متأخر عن المسار');
  }
  return (
    <div className={`proj-card ${completed ? 'proj-done' : ''}`} style={{ '--pcolor': p.color }}>
      <div className="proj-top">
        <button className={`proj-complete ${completed ? 'on' : ''}`} onClick={() => onUpd({ completedAt: completed ? null : fmtISO(new Date()) })} aria-label={tx('Mark complete', 'وضع كمكتمل')} title={completed ? tx('Reopen', 'إعادة فتح') : tx('Mark complete', 'وضع كمكتمل')}>
          {completed ? <CheckCircle2 size={19} /> : <Circle size={19} />}
        </button>
        <button className="proj-open" onClick={onOpen} aria-expanded={open}>
          <span className="proj-dot" style={{ background: p.color }} />
          <span className="proj-name">{p.name}</span>
          <ChevronDown size={16} className="proj-caret" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
        </button>
        <span className={`proj-status ${statusClass}`}>{statusClass === 'done' ? <Check size={12} /> : statusClass === 'ok' ? <TrendingUp size={12} /> : statusClass === 'neutral' ? <Flag size={12} /> : <TrendingUp size={12} style={{ transform: 'scaleY(-1)' }} />} {statusText}</span>
      </div>

      {p.goal ? <div className="proj-goal">{p.goal}</div> : null}

      {hasTarget && <div className="proj-bar-wrap">
        <div className="proj-bar"><span className="proj-fill" style={{ width: `${Math.min(100, pctLabel)}%` }} />
          {pace.expected != null && p.target > 0 && <span className="proj-target-mark" style={{ [isRTL() ? 'right' : 'left']: `${Math.min(100, (pace.expected / p.target) * 100)}%` }} title={tx('where you should be today', 'أين يجب أن تكون اليوم')} />}
        </div>
        <div className="proj-bar-meta">
          <span className="proj-count">{pace.done}<span className="proj-slash"> / {p.target || 0}</span> {unit}</span>
          <span className="proj-pct">{pctLabel}%</span>
        </div>
      </div>}

      {!completed && <div className="proj-stats">
        {pace.daysLeft != null && <span className={`proj-stat ${pace.daysLeft < 0 ? 'over' : ''}`}><Clock size={12} /> {pace.daysLeft < 0 ? tx('past deadline', 'تجاوز الموعد') : `${pace.daysLeft} ${tx('days left', 'يوم متبقٍّ')}`}</span>}
        {pace.perDay != null && pace.remaining > 0 && <span className="proj-stat"><Target size={12} /> {tx('need', 'المطلوب')} {pace.perDay < 1 ? pace.perDay.toFixed(1) : Math.ceil(pace.perDay)} {unit}/{tx('day', 'يوم')}</span>}
        {pace.projectedEnd && <span className="proj-stat"><Flag size={12} /> {tx('finishing', 'الانتهاء')} ~{pace.projectedEnd.getDate()} {mon(pace.projectedEnd.getMonth())}</span>}
      </div>}

      {tasks.length > 0 && (
        <div className="proj-tasks">
          <div className="proj-tasks-h">
            {tx('Tasks', 'المهام')} <span className="proj-rollup">{taskInfo.done}/{taskInfo.total} {tx('done', 'منجز')}</span>
            {onBoard && (
              <button className="ghost sm proj-board-btn" onClick={onBoard}>
                <Rows3 size={13} /> {tx('Board', 'اللوحة')}
                <span className="proj-lanes">{lanes.lanes.map((l) => l.n).join('/')}</span>
              </button>
            )}
          </div>
          <ul className="proj-task-list">
            {tasks.slice(0, 8).map((tk) => (
              <li key={tk.id} className={`proj-task ${tk.done ? 'done' : ''}`}>
                <button className="tcheck sm" onClick={() => onToggleTask(tk)} aria-label="Toggle done">{tk.done ? <CheckCircle2 size={15} /> : <Circle size={15} />}</button>
                <button className="proj-task-main" onClick={() => onOpenTask(tk)}>
                  <span className="proj-task-title">{tk.title}</span>
                  <span className="proj-task-date">{tk.kind === 'pool' ? tx('backlog', 'الانتظار') : `${wd(tk.date.getDay())} ${tk.date.getDate()} ${mon(tk.date.getMonth())}`}</span>
                </button>
              </li>
            ))}
          </ul>
          {tasks.length > 8 && <div className="hint-text" style={{ margin: '2px 0 0' }}>{tx('+ more', '+ المزيد')} {tasks.length - 8}</div>}
        </div>
      )}

      {hasTarget && !completed && <div className="proj-log">
        <input className="proj-log-amt" type="number" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder={`+ ${unit}`} onKeyDown={(e) => e.key === 'Enter' && submitLog()} />
        <input className="proj-log-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={tx('note (optional)', 'ملاحظة (اختياري)')} onKeyDown={(e) => e.key === 'Enter' && submitLog()} />
        <button className="primary sm" onClick={submitLog} disabled={!Number(amt)}><Plus size={14} /> {tx('Log', 'سجّل')}</button>
      </div>}

      {open && (
        <div className="proj-edit">
          <div className="proj-field"><span>{tx('Project name', 'اسم المشروع')}</span><input className="projname" value={p.name} onChange={(e) => onUpd({ name: e.target.value })} /></div>
          <div className="proj-field"><span>{tx('Goal', 'الهدف')}</span><input className="projname" value={p.goal || ''} onChange={(e) => onUpd({ goal: e.target.value })} placeholder={tx('e.g. Translate the book', 'مثال: ترجمة الكتاب')} /></div>
          <div className="proj-grid3">
            <label><span>{tx('Unit', 'الوحدة')}</span><input className="time-input" value={p.unit || ''} onChange={(e) => onUpd({ unit: e.target.value })} placeholder={tx('pages', 'صفحة')} /></label>
            <label><span>{tx('Target (optional)', 'الهدف الرقمي (اختياري)')}</span><input className="time-input" type="number" min="0" value={p.target || ''} onChange={(e) => onUpd({ target: e.target.value === '' ? 0 : Number(e.target.value) || 0 })} placeholder={tx('none', 'بدون')} /></label>
            <label><span>{tx('Color', 'اللون')}</span><input className="swatch proj-swatch" type="color" value={p.color} onChange={(e) => onUpd({ color: e.target.value })} /></label>
          </div>
          <div className="proj-grid2">
            <label><span>{tx('Start', 'البداية')}</span><input className="time-input" type="date" value={p.startDate || ''} onChange={(e) => onUpd({ startDate: e.target.value })} /></label>
            <label><span>{tx('Deadline', 'الموعد النهائي')}</span><input className="time-input" type="date" value={p.deadline || ''} onChange={(e) => onUpd({ deadline: e.target.value })} /></label>
          </div>
          <p className="hint-text" style={{ marginTop: 0 }}>{tx('To add tasks here, set this project on a task from its editor.', 'لإضافة مهام هنا، اختر هذا المشروع من محرّر المهمة.')}</p>
          {(p.entries || []).length > 0 && (
            <div className="proj-field">
              <span>{tx('Recent progress', 'التقدّم الأخير')}</span>
              <ul className="proj-entries">
                {[...(p.entries || [])].slice(-6).reverse().map((e) => (
                  <li key={e.id}><span className="proj-entry-amt">+{e.amount} {unit}</span><span className="proj-entry-date">{e.date}</span>{e.note ? <span className="proj-entry-note">{e.note}</span> : null}
                    <button className="mini-del" onClick={() => onUpd({ entries: (p.entries || []).filter((x) => x.id !== e.id) })}><X size={12} /></button></li>
                ))}
              </ul>
            </div>
          )}
          <div className="proj-edit-foot">
            {confirmDel ? (
              <span className="od-confirm">{tx('Delete this project?', 'حذف هذا المشروع؟')}<button className="danger sm" onClick={onDel}>{tx('Yes', 'نعم')}</button><button className="ghost sm" onClick={() => setConfirmDel(false)}>{tx('Cancel', 'إلغاء')}</button></span>
            ) : (
              <button className="danger sm" onClick={() => setConfirmDel(true)}><Trash2 size={14} /> {tx('Delete project', 'حذف المشروع')}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PIN — a soft lock. Deters casual access; not encryption.           */
/* ------------------------------------------------------------------ */
function PinPad({ onDigit, onBack }) {
  return (
    <div className="pin-pad">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (<button key={n} className="pin-key" onClick={() => onDigit(String(n))}>{n}</button>))}
      <span className="pin-key ghost-key" />
      <button className="pin-key" onClick={() => onDigit('0')}>0</button>
      <button className="pin-key" onClick={onBack} aria-label="Backspace"><Delete size={20} /></button>
    </div>
  );
}
function PinScreen({ onVerify, onSuccess }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const add = (d) => { if (pin.length >= 4) return; const next = pin + d; setPin(next); if (next.length === 4) check(next); };
  const back = () => { setErr(false); setPin((p) => p.slice(0, -1)); };
  const check = async (candidate) => {
    const ok = await onVerify(candidate);
    if (ok) onSuccess(); else { setErr(true); setPin(''); }
  };
  return (
    <div className="pin-screen">
      <div className="pin-inner">
        <Lock size={30} className="pin-lock" />
        <div className="pin-title">{tx('Enter your PIN', 'أدخل رمز PIN')}</div>
        <div className={`pin-dots ${err ? 'err' : ''}`}>
          {[0, 1, 2, 3].map((i) => (<span key={i} className={`pin-dot ${i < pin.length ? 'on' : ''}`} />))}
        </div>
        {err && <div className="pin-err">{tx('Wrong PIN — try again.', 'رمز غير صحيح — حاول مجددًا.')}</div>}
        <PinPad onDigit={add} onBack={back} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Settings                                                           */
/* ------------------------------------------------------------------ */
function SettingsPanel({ settings, onChange, templates, onAddTemplate, onUpdTemplate, onDelTemplate, onExport, onImport, onSetPin, sync, notify, onEnableNotify, onTestNotify, onRecheck, storageOk, onClose, onClearDay, dayLabel, onLang, calendar, trello }) {
  const [local, setLocal] = useState(settings);
  const [tab, setTab] = useState('general');
  // Keep the local editing copy in sync when the parent persists settings from
  // anywhere else, so an edit here can never overwrite newer data from a stale
  // snapshot. localRef always holds the freshest committed copy.
  const localRef = useRef(local);
  useEffect(() => { localRef.current = local; }, [local]);
  useEffect(() => { setLocal(settings); localRef.current = settings; }, [settings]);
  const save = (next) => { setLocal(next); localRef.current = next; onChange(next); };
  const patch = (p) => save({ ...localRef.current, ...p });
  const [exp, setExp] = useState(''); const [imp, setImp] = useState(''); const [busy, setBusy] = useState(false); const [status, setStatus] = useState('');
  const [linkCode, setLinkCode] = useState(''); const [linkMsg, setLinkMsg] = useState('');
  const [phoneCode, setPhoneCode] = useState(''); const [phoneMsg, setPhoneMsg] = useState('');
  const doExport = async () => { setBusy(true); setStatus(tx('Preparing…', 'جارٍ التحضير…')); try { setExp(await onExport()); setStatus(''); } catch { setStatus(tx('Export failed.', 'فشل التصدير.')); } setBusy(false); };
  const doCopy = async () => { try { await navigator.clipboard.writeText(exp); setStatus(tx('Copied.', 'تم النسخ.')); } catch { setStatus(tx('Copy blocked — select the text manually.', 'تعذّر النسخ — حدّد النص يدويًا.')); } };
  /* One step: build the export and save it. Two buttons (generate, then
     download) meant the common case took two taps and looked broken if you
     only pressed the first. Routed through saveJson so it also works in the
     APK, where a blob download silently does nothing. */
  const doDownload = async () => {
    setBusy(true); setStatus(tx('Preparing…', 'جارٍ التحضير…'));
    try {
      const text = exp || await onExport();
      if (!exp) setExp(text);
      const name = `rhythm-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const r = await saveJson(name, text);
      if (r === 'downloaded') setStatus(tx(`Saved ${name}`, `تم حفظ ${name}`));
      else if (r === 'shared') setStatus(tx('Backup ready — pick where to keep it.', 'النسخة جاهزة — اختر مكان حفظها.'));
      else if (String(r).startsWith('saved:')) setStatus(tx(`Saved to ${String(r).slice(6)}`, `تم الحفظ في ${String(r).slice(6)}`));
      else setStatus(tx(`Couldn't save the file (${r}). Use "Show text" and copy it instead.`, `تعذّر حفظ الملف (${r}). استخدم «إظهار النص» وانسخه بدلًا من ذلك.`));
    } catch (e) { setStatus(tx('Export failed.', 'فشل التصدير.')); }
    setBusy(false);
  };
  /* Picking a file imports immediately — the old flow only filled a textarea,
     so it looked like nothing happened until you found the Import button. */
  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setBusy(true); setStatus(tx('Reading the file…', 'جارٍ قراءة الملف…'));
    const r = new FileReader();
    r.onload = async () => {
      const text = String(r.result || '');
      setImp(text);
      const res = await onImport(text);
      setStatus(res.msg);
      if (res.ok) setImp('');
      setBusy(false);
    };
    r.onerror = () => { setStatus(tx("Couldn't read that file.", 'تعذّر قراءة الملف.')); setBusy(false); };
    r.readAsText(f);
    e.target.value = ''; // let the same file be picked again after a failure
  };
  const doImport = async () => { setBusy(true); setStatus(tx('Importing…', 'جارٍ الاستيراد…')); const res = await onImport(imp); setStatus(res.msg); if (res.ok) setImp(''); setBusy(false); };
  const updLabel = (id, p) => patch({ labels: localRef.current.labels.map((x) => x.id === id ? { ...x, ...p } : x) });
  const addLabel = () => patch({ labels: [...localRef.current.labels, { id: uid(), name: tx('New label', 'وسم جديد'), color: LABEL_SWATCHES[localRef.current.labels.length % LABEL_SWATCHES.length] }] });
  const delLabel = (id) => patch({ labels: localRef.current.labels.filter((x) => x.id !== id) });
  const setPrayer = (p) => patch({ prayer: { ...localRef.current.prayer, ...p } });
  const setCustom = (k, v) => setPrayer({ customTimes: { ...localRef.current.prayer.customTimes, [k]: v } });

  // PIN controls
  const hasPin = !!(settings.pin && settings.pin.hash);
  const [pinA, setPinA] = useState(''); const [pinB, setPinB] = useState(''); const [pinMsg, setPinMsg] = useState('');
  const savePin = async () => {
    if (!/^\d{4}$/.test(pinA)) { setPinMsg(tx('PIN must be 4 digits.', 'يجب أن يتكون الرمز من 4 أرقام.')); return; }
    if (pinA !== pinB) { setPinMsg(tx('The two PINs do not match.', 'الرمزان غير متطابقين.')); return; }
    await onSetPin(pinA); setPinA(''); setPinB(''); setPinMsg(tx('PIN set.', 'تم ضبط الرمز.'));
  };
  const removePin = async () => { await onSetPin(null); setPinA(''); setPinB(''); setPinMsg(tx('PIN removed.', 'تمت إزالة الرمز.')); };

  const TABS = [
    ['general', tx('General', 'عام'), Settings],
    ['labels', tx('Labels', 'الوسوم'), Tag],
    ['recurring', tx('Recurring', 'المتكررة'), Repeat],
    ['prayer', tx('Prayer', 'الصلاة'), Clock],
    ['calendar', tx('Calendar', 'التقويم'), Calendar],
    ['trello', tx('Trello', 'ترللو'), LayoutTemplate],
    ['security', tx('Security', 'الأمان'), Shield],
    ['sync', tx('Sync', 'المزامنة'), Repeat],
    ['backup', tx('Backup', 'النسخ'), Copy],
  ];

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal settings-modal">
        <div className="modal-head plain"><strong>{tx('Settings', 'الإعدادات')} <span className="ver-tag">v{APP_VERSION}</span></strong><button className="icon" onClick={onClose}><X size={18} /></button></div>
        <div className="settings-tabs">
          {TABS.map(([id, label, Icon]) => (
            <button key={id} className={`settings-tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}><Icon size={14} /><span>{label}</span></button>
          ))}
        </div>
        <div className="modal-body settings-body">

          {tab === 'general' && (<>
            <div className="sect">
              <div className="sect-h"><Languages size={13} /> {tx('Language', 'اللغة')}</div>
              <div className="seg time-seg">
                {LANGS.map((l) => (<button key={l.id} className={local.lang === l.id ? 'on' : ''} onClick={() => onLang(l.id)}>{l.native}</button>))}
              </div>
              <p className="hint-text">{tx('Arabic switches the whole app to right-to-left.', 'العربية تحوّل التطبيق بالكامل إلى الاتجاه من اليمين لليسار.')}</p>
            </div>
            <div className="sect">
              <div className="sect-h">{tx('Appearance', 'المظهر')}</div>
              <div className="seg time-seg theme-seg">
                <button className={(local.theme || 'auto') === 'auto' ? 'on' : ''} onClick={() => patch({ theme: 'auto', autoDark: true })}>{tx('Auto', 'تلقائي')}</button>
                <button className={local.theme === 'light' ? 'on' : ''} onClick={() => patch({ theme: 'light', autoDark: false })}>{tx('Light', 'فاتح')}</button>
                <button className={local.theme === 'dark' ? 'on' : ''} onClick={() => patch({ theme: 'dark', autoDark: true })}>{tx('Dark', 'داكن')}</button>
              </div>
              <p className="hint-text">{tx('Auto follows the sky: dark from Maghrib to Sunrise.', 'التلقائي يتبع السماء: داكن من المغرب إلى الشروق.')}</p>
            </div>
            <div className="sect">
              <div className="sect-h">{tx('Time format', 'صيغة الوقت')}</div>
              <div className="seg time-seg">
                <button className={local.time24 !== true ? 'on' : ''} onClick={() => patch({ time24: false })}>{tx('12-hour', '12 ساعة')}</button>
                <button className={local.time24 === true ? 'on' : ''} onClick={() => patch({ time24: true })}>{tx('24-hour', '24 ساعة')}</button>
              </div>
            </div>
            <div className="sect">
              <div className="sect-h">{tx('Week starts on', 'يبدأ الأسبوع في')}</div>
              <select value={local.weekStartDay} onChange={(e) => patch({ weekStartDay: Number(e.target.value) })}>{weekdayFullList().map((d, i) => <option key={i} value={i}>{d}</option>)}</select>
              <p className="hint-text">{tx('Default is Saturday for the Egypt/Gulf week.', 'الافتراضي هو السبت لأسبوع مصر والخليج.')}</p>
            </div>
            <div className="sect">
              <div className="sect-h">{tx('This day', 'هذا اليوم')}</div>
              <button className="danger" onClick={onClearDay}><Trash2 size={14} /> {tx('Clear all tasks on', 'امسح كل مهام')} {dayLabel}</button>
            </div>
          </>)}

          {tab === 'labels' && (
            <div className="sect">
              <div className="sect-h"><Tag size={13} /> {tx('Labels & colours', 'الوسوم والألوان')}</div>
              <p className="hint-text" style={{ marginTop: 0 }}>{tx('Colour-coded tags for tasks. To track a long-term goal instead, use Projects.', 'وسوم ملوّنة للمهام. أما لتتبّع هدف طويل المدى فاستخدم المشاريع.')}</p>
              {local.labels.map((p) => (<div key={p.id} className="projrow"><input className="swatch" type="color" value={p.color} onChange={(e) => updLabel(p.id, { color: e.target.value })} /><input className="projname" value={p.name} onChange={(e) => updLabel(p.id, { name: e.target.value })} /><button className="mini-del" onClick={() => delLabel(p.id)}><X size={13} /></button></div>))}
              <button className="ghost sm" onClick={addLabel}><Plus size={14} /> {tx('Add label', 'إضافة وسم')}</button>
            </div>
          )}

          {tab === 'recurring' && (
            <div className="sect">
              <div className="sect-h"><Repeat size={13} /> {tx('Recurring tasks', 'المهام المتكررة')}</div>
              <p className="hint-text" style={{ marginTop: 0 }}>{tx('Ready-made tasks you drop into a day. Editing one here only changes what you add later — tasks already on your calendar are untouched.', 'مهام جاهزة تضيفها إلى أي يوم. تعديلها هنا يؤثّر فقط على ما تضيفه لاحقًا — المهام الموجودة في تقويمك لا تتغيّر.')}</p>
              {templates.length === 0 && <p className="hint-text">{tx('None yet. Save any task or backlog item as a recurring task, or add one here.', 'لا يوجد بعد. احفظ أي مهمة أو عنصر من قائمة الانتظار كمهمة متكررة، أو أضف واحدة هنا.')}</p>}
              {templates.map((tp) => (<TemplateEditor key={tp.id} tpl={tp} projects={local.labels} onChange={(patch) => onUpdTemplate(tp.id, patch)} onDelete={() => onDelTemplate(tp.id)} />))}
              <button className="ghost sm" onClick={() => onAddTemplate({ title: tx('New recurring task', 'مهمة متكررة جديدة'), block: 'morning', subtasks: [] })}><Plus size={14} /> {tx('Add recurring task', 'إضافة مهمة متكررة')}</button>
            </div>
          )}

          {tab === 'prayer' && (<>
            <div className="sect">
              <div className="sect-h"><Lock size={13} /> {tx('Prayer lock', 'قفل الصلاة')}</div>
              <label className="toggle"><input type="checkbox" checked={local.prayerGate !== false} onChange={(e) => patch({ prayerGate: e.target.checked })} /><span>{tx('Pause the app at each prayer time until the prayer is marked done', 'أوقف التطبيق عند كل وقت صلاة حتى يتم تعليم الصلاة كمنجزة')}</span></label>
              <p className="hint-text">{tx('Fajr stays locked through the morning until Dhuhr, releasing as soon as you mark it done.', 'يبقى قفل الفجر طوال الصباح حتى الظهر، ويُرفع فور تعليمه كمنجز.')}</p>
            </div>
            <div className="sect">
              <div className="sect-h">{tx('Prayer times', 'مواقيت الصلاة')}</div>
              <label className="toggle"><input type="checkbox" checked={local.prayer.useLive} onChange={(e) => setPrayer({ useLive: e.target.checked })} /><span>{tx('Calculate automatically for Cairo (Egyptian Authority)', 'احسب تلقائيًا للقاهرة (الهيئة المصرية العامة للمساحة)')}</span></label>
              {!local.prayer.useLive && (<div className="times-grid">{Object.keys(DEFAULT_TIMINGS).map((k) => (<label key={k}><span>{k}</span><input value={local.prayer.customTimes[k] || ''} onChange={(e) => setCustom(k, e.target.value)} placeholder="HH:MM" /></label>))}</div>)}
              <p className="hint-text">{tx('Computed on-device from the date and your timezone. Turn off to set times manually.', 'يُحسب على جهازك من التاريخ ومنطقتك الزمنية. أوقفه لضبط المواقيت يدويًا.')}</p>
            </div>
          </>)}

          {tab === 'calendar' && calendar && (
            <CalendarSettings
              feeds={calendar.feeds}
              onFeedsChange={calendar.onFeedsChange}
              report={calendar.report}
              onRefresh={calendar.onRefresh}
              refreshing={calendar.refreshing}
              calSettings={local.calendar || {}}
              onCalSettings={(p) => patch({ calendar: { ...(localRef.current.calendar || {}), ...p } })}
            />
          )}

          {tab === 'trello' && trello && (
            <TrelloSettings
              trello={local.trello || {}}
              onChange={(next) => patch({ trello: next })}
              report={trello.report}
              onRefresh={(cfg, o) => trello.onRefresh(cfg, o)}
              refreshing={trello.refreshing}
            />
          )}

          {tab === 'security' && (
            <div className="sect">
              <div className="sect-h"><Shield size={13} /> {tx('App PIN', 'رمز التطبيق')}</div>
              <div className="security-note"><Shield size={15} /><p>{tx('A PIN asks for four digits when Rhythm opens. It deters someone casually picking up your device — it is a soft lock, not encryption, and does not protect your data from anyone with technical access to this device.', 'يطلب الرمز أربعة أرقام عند فتح التطبيق. يردع من يتناول جهازك عرضًا — لكنه قفل بسيط وليس تشفيرًا، ولا يحمي بياناتك ممّن يملك وصولًا تقنيًا إلى هذا الجهاز.')}</p></div>
              {hasPin && <p className="hint-text" style={{ color: 'var(--verdigris)', fontWeight: 700 }}><KeyRound size={12} /> {tx('A PIN is currently set.', 'يوجد رمز مضبوط حاليًا.')}</p>}
              <div className="pin-set-grid">
                <label><span>{hasPin ? tx('New 4-digit PIN', 'رمز جديد من 4 أرقام') : tx('4-digit PIN', 'رمز من 4 أرقام')}</span><input className="time-input" type="password" inputMode="numeric" maxLength={4} value={pinA} onChange={(e) => { setPinMsg(''); setPinA(e.target.value.replace(/\D/g, '').slice(0, 4)); }} placeholder="••••" /></label>
                <label><span>{tx('Confirm PIN', 'تأكيد الرمز')}</span><input className="time-input" type="password" inputMode="numeric" maxLength={4} value={pinB} onChange={(e) => { setPinMsg(''); setPinB(e.target.value.replace(/\D/g, '').slice(0, 4)); }} placeholder="••••" /></label>
              </div>
              <div className="io-actions">
                <button className="primary" onClick={savePin} disabled={!pinA || !pinB}><Lock size={14} /> {hasPin ? tx('Change PIN', 'تغيير الرمز') : tx('Set PIN', 'ضبط الرمز')}</button>
                {hasPin && <button className="ghost sm" onClick={removePin}>{tx('Remove PIN', 'إزالة الرمز')}</button>}
              </div>
              {pinMsg && <p className="hint-text" style={{ marginTop: 8 }}>{pinMsg}</p>}
            </div>
          )}

          {tab === 'sync' && (
            <div className="sect">
              <div className="sect-h"><Repeat size={13} /> {tx('Cross-device sync', 'المزامنة بين الأجهزة')}</div>
              {!sync || !sync.capability.sync ? (<>
                <div className="security-note"><Shield size={15} /><p>{tx('This copy of Rhythm has no sync backend, so it is fully local — your planner never leaves this device. Export a backup regularly to keep it safe.', 'هذه النسخة بلا خادم مزامنة، لذا تعمل محليًا بالكامل — لا يغادر مخططك هذا الجهاز. صدّر نسخة احتياطية بانتظام للحفاظ عليه.')}</p></div>
                <p className="hint-text" style={{ marginTop: 10 }}>{tx('Sync appears here automatically on a deployment that has one configured.', 'تظهر المزامنة هنا تلقائيًا في أي نسخة مُهيّأة لها.')}</p>
                {sync && sync.capability.probe && (
                  <p className="hint-text" style={{ marginTop: 6, overflowWrap: 'anywhere' }}>
                    {tx('Checked', 'تم الفحص')}: <code>{sync.capability.probe}</code>
                    {sync.capability.why ? <><br />{tx('Result', 'النتيجة')}: <code>{sync.capability.why}</code></> : null}
                  </p>
                )}
              </>) : !sync.user ? (<>
                <div className="security-note"><Shield size={15} /><p>{tx('Sign in to keep your planner on your other devices. Your data is stored under your account and merged per item by most-recent-edit — nothing is shared with anyone else.', 'سجّل الدخول للحفاظ على مخططك على أجهزتك الأخرى. تُحفظ بياناتك ضمن حسابك وتُدمج لكل عنصر بالأحدث تعديلًا — ولا تُشارك مع أي شخص آخر.')}</p></div>
                <div className="io-actions" style={{ marginTop: 10 }}>
                  <button className="primary" onClick={sync.signIn}><KeyRound size={14} /> {tx('Continue with Google', 'المتابعة بحساب Google')}</button>
                </div>
                <p className="hint-text" style={{ marginTop: 8 }}>{tx('Staying signed out keeps Rhythm exactly as it is: local-only.', 'البقاء دون تسجيل دخول يُبقي التطبيق كما هو: محلي بالكامل.')}</p>
                <div className="sect-h" style={{ marginTop: 16 }}><KeyRound size={13} /> {tx('Or link with a code', 'أو اربط برمز')}</div>
                <p className="hint-text" style={{ marginTop: 0 }}>{tx('On a device where you are already signed in, open Settings → Sync → "Code for another device" and paste it here. Made for the Android app, where Google sign-in cannot run.', 'من جهاز سجّلت الدخول عليه، افتح الإعدادات ← المزامنة ← «رمز لجهاز آخر» والصقه هنا. مصمم لتطبيق أندرويد حيث لا يعمل تسجيل دخول جوجل.')}</p>
                <div className="cal-add">
                  <input value={linkCode} onChange={(e) => { setLinkCode(e.target.value); setLinkMsg(''); }} placeholder="dt1.…" aria-label={tx('Link code', 'رمز الربط')} />
                  <button className="primary sm" disabled={!linkCode.trim()} onClick={async () => {
                    const r = await sync.linkWithToken(linkCode);
                    if (r && !r.ok) setLinkMsg(r.error === 'not-a-code' ? tx('That does not look like a link code.', 'لا يبدو هذا رمز ربط.') : r.error === 'code-rejected' ? tx('The server refused that code.', 'رفض الخادم هذا الرمز.') : r.error);
                  }}>{tx('Link', 'اربط')}</button>
                </div>
                {linkMsg && <p className="hint-text vault-warn"><AlertCircle size={12} /> {linkMsg}</p>}
              </>) : (<>
                <p className="hint-text" style={{ color: 'var(--verdigris)', fontWeight: 700 }}><KeyRound size={12} /> {sync.user.linked ? tx('Linked to your account with a device code.', 'مرتبط بحسابك برمز جهاز.') : `${tx('Signed in as', 'مسجّل باسم')} ${sync.user.email || sync.user.name}`}</p>
                <p className="hint-text" style={{ marginTop: 4 }}>
                  {tx('Status', 'الحالة')}: <code>{sync.status}</code>
                  {sync.lastSync ? <> · {tx('last sync', 'آخر مزامنة')} {new Date(sync.lastSync).toLocaleTimeString()}</> : null}
                </p>
                <p className="hint-text" style={{ marginTop: 4 }}>{tx('Syncs on its own when you open the app, come back to it, and a few seconds after an edit. It never syncs while an editor is open, so it cannot overwrite something you are in the middle of.', 'تتم المزامنة تلقائيًا عند فتح التطبيق والعودة إليه وبعد ثوانٍ من أي تعديل. ولا تتم أبدًا أثناء فتح نافذة تحرير، فلا يمكن أن تستبدل ما تعمل عليه.')}</p>
                <div className="io-actions" style={{ marginTop: 8 }}>
                  <button className="primary" onClick={sync.syncNow} disabled={sync.status === 'syncing'}>{sync.status === 'syncing' ? tx('Syncing…', 'جارٍ المزامنة…') : tx('Sync now', 'زامن الآن')}</button>
                  <button className="ghost sm" onClick={sync.signOut}>{tx('Sign out', 'تسجيل الخروج')}</button>
                  <button className="danger sm" onClick={sync.stopSync}>{tx('Stop syncing & remove cloud copy', 'إيقاف المزامنة وحذف النسخة السحابية')}</button>
                </div>
                <p className="hint-text" style={{ marginTop: 6 }}>{tx('Stopping deletes the cloud copy only — this device keeps everything.', 'الإيقاف يحذف النسخة السحابية فقط — يحتفظ هذا الجهاز بكل شيء.')}</p>
                {!sync.user.linked && (<>
                  <div className="sect-h" style={{ marginTop: 16 }}><KeyRound size={13} /> {tx('Code for another device', 'رمز لجهاز آخر')}</div>
                  <p className="hint-text" style={{ marginTop: 0 }}>{tx('For the Android app: generate a code here, paste it there under Settings → Sync. It works like a password for your planner data — share it with no one.', 'لتطبيق أندرويد: أنشئ رمزًا هنا والصقه هناك في الإعدادات ← المزامنة. يعمل كلمة سر لبيانات مخططك — لا تشاركه مع أحد.')}</p>
                  {phoneCode ? (
                    <div className="vault-row open">
                      <code className="vault-value" style={{ overflowWrap: 'anywhere' }}>{phoneCode}</code>
                      <button className="ghost sm" onClick={async () => { try { await navigator.clipboard.writeText(phoneCode); setPhoneMsg(tx('Copied.', 'تم النسخ.')); } catch { setPhoneMsg(tx('Copy blocked — select it manually.', 'تعذّر النسخ — حدده يدويًا.')); } }}><Copy size={13} /> {tx('Copy', 'نسخ')}</button>
                      <button className="mini-del" onClick={() => { setPhoneCode(''); setPhoneMsg(''); }} aria-label={tx('Hide', 'إخفاء')}><X size={13} /></button>
                    </div>
                  ) : (
                    <button className="ghost sm" onClick={async () => { setPhoneMsg(''); try { setPhoneCode(await sync.mintPhoneCode()); } catch (e) { setPhoneMsg(String(e.message || e)); } }}><KeyRound size={13} /> {tx('Generate code', 'أنشئ رمزًا')}</button>
                  )}
                  {phoneMsg && <p className="hint-text" style={{ marginTop: 6 }}>{phoneMsg}</p>}
                </>)}
              </>)}
              {sync && sync.error && <p className="hint-text vault-warn" style={{ marginTop: 8 }}><AlertCircle size={12} /> {sync.error}</p>}

              {/* Never gated on `supported`. Gating it meant that whenever the
                  platform probe came back false — for any reason — the whole
                  section vanished and there was nothing on screen to diagnose
                  from. It costs one dull line in the browser and is the only
                  way to see what the app actually believes on a device. */}
              {notify && (<>
                <div className="sect-h" style={{ marginTop: 20 }}><Clock size={13} /> {tx('Android reminders', 'تنبيهات أندرويد')}</div>
                <p className="hint-text" style={{ marginTop: 0 }}>{tx('Get a notification when a timed task’s window opens, plus an ongoing card in the shade showing whatever Now is pointing at. Only in the Android app — the browser version is unaffected.', 'احصل على تنبيه عند بدء وقت مهمة موقّتة، بالإضافة إلى بطاقة دائمة في شريط الإشعارات تعرض ما تشير إليه صفحة الآن. في تطبيق أندرويد فقط — نسخة المتصفح لا تتأثر.')}</p>
                {!notify.supported ? (
                  <p className="hint-text">{tx('Not running as the Android app — reminders are only available there.', 'لا يعمل كتطبيق أندرويد — التنبيهات متاحة هناك فقط.')}</p>
                ) : notify.state === 'granted' ? (
                  <p className="hint-text" style={{ color: 'var(--verdigris)', fontWeight: 700 }}><CheckCircle2 size={12} /> {tx('Reminders are on.', 'التنبيهات مفعّلة.')}</p>
                ) : notify.state === 'denied' ? (
                  <p className="hint-text vault-warn"><AlertCircle size={12} /> {tx('Blocked — turn notifications on for Rhythm in Android settings.', 'محظورة — فعّل الإشعارات للتطبيق من إعدادات أندرويد.')}</p>
                ) : (
                  <button className="primary" onClick={onEnableNotify}><Clock size={14} /> {tx('Enable reminders', 'تفعيل التنبيهات')}</button>
                )}
                <div className="io-actions" style={{ marginTop: 8 }}>
                  <button className="ghost sm" onClick={onTestNotify}>{tx('Send a test notification', 'أرسل تنبيهًا تجريبيًا')}</button>
                  <button className="ghost sm" onClick={onRecheck}>{tx('Re-check', 'إعادة الفحص')}</button>
                </div>
                <p className="hint-text" style={{ marginTop: 6, overflowWrap: 'anywhere' }}>
                  {tx('Platform', 'المنصة')}: <code>{notify.platform || '?'}</code>
                  {' · '}{tx('bridge', 'الجسر')}: <code>{String(!!notify.hasBridge)}</code>
                  {' · '}{tx('native', 'أصلي')}: <code>{String(!!notify.supported)}</code>
                  <br />
                  {tx('Permission', 'الإذن')}: <code>{notify.state}</code>
                  {notify.pending != null ? <> · {tx('scheduled', 'مجدولة')}: <code>{notify.pending}</code></> : null}
                  {' · '}{tx('checks', 'الفحوص')}: <code>{notify.probes || 0}</code>
                  {notify.test ? <><br />{tx('test', 'الاختبار')}: <code>{notify.test}</code></> : null}
                  {notify.lastErr ? <><br />{tx('last error', 'آخر خطأ')}: <code>{notify.lastErr}</code></> : null}
                </p>
              </>)}
            </div>
          )}

          {tab === 'backup' && (
            <div className="sect">
              <div className="sect-h"><Copy size={13} /> {tx('Backup & move devices', 'النسخ الاحتياطي ونقل الأجهزة')}</div>
              {!storageOk && <p className="hint-text" style={{ marginTop: 0, color: '#9C4221' }}>{tx("This device isn't persisting between sessions — export is the only way to keep your plan.", 'هذا الجهاز لا يحفظ بين الجلسات — التصدير هو الطريقة الوحيدة للاحتفاظ بخطتك.')}</p>}
              <div className="drive-box"><div className="drive-title">{tx('Local-only by design', 'محلي فقط حسب التصميم')}</div><p className="hint-text" style={{ marginTop: 0, marginBottom: 0 }}>{tx('Everything lives in this browser on this device — nothing is sent anywhere. That means backups are on you: export a file now and then, especially before clearing browser data.', 'كل شيء محفوظ في هذا المتصفح على هذا الجهاز — لا يُرسل شيء إلى أي مكان. لذا فالنسخ الاحتياطي مسؤوليتك: صدّر ملفًا بين الحين والآخر، خاصة قبل مسح بيانات المتصفح.')}</p></div>
              <div className="drive-box" style={{ marginTop: 12 }}><div className="drive-title"><Sparkles size={13} /> {tx('AI features (optional)', 'الميزات الذكية (اختياري)')}</div>
                <p className="hint-text" style={{ marginTop: 0, marginBottom: 8 }}>{tx('The brain-dump sorter, the planning assistant, dictation and task sizing all run on Google Gemini (free tier), called straight from your browser with your own key. Dictation uses the browser’s own speech recognition where it has one and costs nothing; where it does not — on the phone, and in the desktop app — the clip goes to Gemini to be written down, and is never stored. Keys are stored only on this device; your text goes to Google when you use these features — the one exception to "nothing is sent anywhere". Note: on the free tier Google may use prompts to improve its products.', 'يعمل فارز الأفكار ومساعد التخطيط والإملاء وتقدير المهام عبر Google Gemini (خطة مجانية) مباشرة من متصفحك بمفتاحك الخاص. يستخدم الإملاء التعرّف على الكلام المدمج في المتصفح حين يتوفّر بلا أي تكلفة، وحين لا يتوفّر — على الهاتف وفي تطبيق سطح المكتب — يُرسل المقطع إلى Gemini لتفريغه، ولا يُحفظ أبدًا. تُحفظ المفاتيح على هذا الجهاز فقط، ويُرسل نصك إلى Google عند استخدامها — وهو الاستثناء الوحيد لمبدأ «لا يُرسل شيء». ملاحظة: قد تستخدم Google المدخلات في الخطة المجانية لتحسين منتجاتها.')}</p>
                <div className="pin-set-grid" style={{ marginBottom: 8 }}>
                  <label><span>{tx('Gemini key', 'مفتاح Gemini')}</span><input className="time-input" type="password" value={local.apiKey || ''} onChange={(e) => patch({ apiKey: e.target.value.trim() })} placeholder="AIza…" autoComplete="off" style={{ letterSpacing: 0, textAlign: 'start' }} /></label>
                  <label><span>{tx('Groq key (backup)', 'مفتاح Groq (احتياطي)')}</span><input className="time-input" type="password" value={local.groqKey || ''} onChange={(e) => patch({ groqKey: e.target.value.trim() })} placeholder="gsk_…" autoComplete="off" style={{ letterSpacing: 0, textAlign: 'start' }} /></label>
                  <label><span>{tx('Key pool address', 'عنوان مخزن المفاتيح')}</span><input className="time-input" value={local.brokerUrl || ''} onChange={(e) => patch({ brokerUrl: e.target.value.trim() })} placeholder="https://…workers.dev" autoComplete="off" style={{ letterSpacing: 0, textAlign: 'start' }} /></label>
                  <label><span>{tx('Key pool token', 'توكن المخزن')}</span><input className="time-input" type="password" value={local.brokerToken || ''} onChange={(e) => patch({ brokerToken: e.target.value.trim() })} placeholder="kb_…" autoComplete="off" style={{ letterSpacing: 0, textAlign: 'start' }} /></label>
                </div>
                <p className="hint-text" style={{ margin: 0 }}>{tx('Gemini keys: aistudio.google.com/apikey. Groq keys: console.groq.com — optional, used automatically only when Gemini is unreachable or rate-limited (different infrastructure, so the two rarely fail together).', 'مفاتيح Gemini: aistudio.google.com/apikey. مفاتيح Groq: console.groq.com — اختياري ويُستخدم تلقائيًا فقط عندما يتعذر الوصول إلى Gemini أو يُقيَّد (بنية تحتية مختلفة فنادرًا ما يتعطلان معًا).')}</p>
              </div>
              <div className="sect-h" style={{ marginTop: 16 }}><Copy size={13} /> {tx('Save a backup', 'حفظ نسخة احتياطية')}</div>
              <p className="hint-text" style={{ marginTop: 0 }}>{tx('Downloads a .json file holding your whole planner. Keep it somewhere safe — it is the only copy.', 'ينزّل ملف .json يحتوي مخططك بالكامل. احفظه في مكان آمن — فهو النسخة الوحيدة.')}</p>
              <div className="io-actions">
                <button className="primary" onClick={doDownload} disabled={busy}><Copy size={14} /> {tx('Download backup (.json)', 'تنزيل النسخة (.json)')}</button>
              </div>

              <div className="sect-h" style={{ marginTop: 18 }}><CornerUpRight size={13} /> {tx('Restore from a backup', 'الاستعادة من نسخة')}</div>
              <p className="hint-text" style={{ marginTop: 0 }}>{tx('Pick a .json file you exported before. This REPLACES what is on this device.', 'اختر ملف .json صدّرته سابقًا. سيؤدي هذا إلى استبدال ما على هذا الجهاز.')}</p>
              <label className="file-drop">
                <input type="file" accept="application/json,.json" onChange={onFile} disabled={busy} />
                <span><CornerUpRight size={15} /> {tx('Choose a backup file…', 'اختر ملف نسخة احتياطية…')}</span>
              </label>

              <details className="sync-advanced" style={{ marginTop: 12 }}>
                <summary>{tx('Advanced: copy or paste the raw text', 'متقدم: انسخ أو الصق النص الخام')}</summary>
                <div className="io-actions" style={{ marginTop: 8 }}>
                  <button className="ghost sm" onClick={doExport} disabled={busy}>{tx('Show text', 'إظهار النص')}</button>
                  {exp && <button className="ghost sm" onClick={doCopy}>{tx('Copy', 'نسخ')}</button>}
                </div>
                {exp && <textarea className="io-text" readOnly value={exp} onFocus={(e) => e.target.select()} rows={4} />}
                <div className="io-import"><textarea className="io-text" placeholder={tx('…or paste a backup to import', '…أو الصق نسخة احتياطية للاستيراد')} value={imp} onChange={(e) => setImp(e.target.value)} rows={3} /><button className="primary" disabled={busy || !imp.trim()} onClick={doImport}>{tx('Import & replace', 'استيراد واستبدال')}</button></div>
              </details>
              {status && <p className="hint-text" style={{ marginTop: 8 }}>{status}</p>}
            </div>
          )}

        </div>
        <div className="modal-foot"><button className="primary" onClick={onClose}>{tx('Close', 'إغلاق')}</button></div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Template editor                                                    */
/* ------------------------------------------------------------------ */
function TemplateEditor({ tpl, projects, onChange, onDelete }) {
  const [sub, setSub] = useState('');
  const subs = tpl.subtasks || [];
  const addSub = () => { if (sub.trim()) { onChange({ subtasks: [...subs, sub.trim()] }); setSub(''); } };
  const delSub = (i) => onChange({ subtasks: subs.filter((_, j) => j !== i) });
  return (
    <div className="routine-card">
      <div className="routine-top"><input className="projname" value={tpl.title} onChange={(e) => onChange({ title: e.target.value })} /><button className="mini-del" onClick={onDelete} aria-label="Delete recurring task"><Trash2 size={14} /></button></div>
      <div className="routine-fields">
        <select value={tpl.block} onChange={(e) => onChange({ block: e.target.value })}>{BLOCKS.map((b) => <option key={b.id} value={b.id}>{bName(b)}</option>)}</select>
        <input className="time-input" type="time" value={tpl.start || ''} onChange={(e) => onChange({ start: e.target.value, time: '' })} title={tx('Start (optional)', 'البداية (اختياري)')} />
        <input className="time-input" type="time" value={tpl.end || ''} onChange={(e) => onChange({ end: e.target.value, time: '' })} title={tx('End (optional)', 'النهاية (اختياري)')} />
        <select value={tpl.projectId || ''} onChange={(e) => onChange({ projectId: e.target.value || null })}><option value="">{tx('no label', 'بلا وسم')}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </div>
      {subs.length > 0 && <div className="routine-subs">{subs.map((s, i) => (<span key={i} className="subchip">{s}<button onClick={() => delSub(i)}><X size={11} /></button></span>))}</div>}
      <div className="inline-add"><input value={sub} onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSub()} placeholder={tx('Add a step…', 'أضف خطوة…')} /><button className="ghost sm" onClick={addSub}><Plus size={14} /></button></div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Preview op → sentence  (t is the task var here; use LANG inline)   */
/* ------------------------------------------------------------------ */
function describeOp(o, tasks, weekStart, selectedDay) {
  const stepStr = (n) => LANG === 'ar' ? ` (+${n} خطوة)` : ` (+${n} step${n > 1 ? 's' : ''})`;
  if (o.type === 'create_task') {
    const b = blockById(o.block);
    const idx = o.day === 'today' ? selectedDay : Number(o.day);
    const safe = Number.isInteger(idx) && idx >= 0 && idx <= 6 ? idx : selectedDay;
    const d = addDays(weekStart, safe);
    const subs = o.subtasks?.length ? stepStr(o.subtasks.length) : '';
    return `${LANG === 'ar' ? 'مهمة' : 'Task'} “${o.title}” → ${wd(d.getDay())} ${d.getDate()}, ${bName(b)}${o.time ? ` · ${o.time}` : ''}${o.project ? ` · ${o.project}` : ''}${subs}`;
  }
  if (o.type === 'create_pool') {
    const subs = o.subtasks?.length ? stepStr(o.subtasks.length) : '';
    return `${LANG === 'ar' ? 'قائمة الانتظار' : 'Backlog'} “${o.title}”${o.project ? ` · ${o.project}` : ''}${subs}`;
  }
  const task = tasks.find((x) => x.id === o.taskId);
  const ref = task ? `“${task.title}”` : (LANG === 'ar' ? 'مهمة موجودة' : 'an existing task');
  if (o.type === 'add_subtask') return `${LANG === 'ar' ? 'مهمة فرعية' : 'Subtask'} “${o.title}” → ${ref}`;
  if (o.type === 'add_note') return `${LANG === 'ar' ? 'ملاحظة' : 'Note'} → ${ref}: “${o.note}”`;
  return JSON.stringify(o);
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */
export { HabitCard,HabitsView,PinPad,PinScreen,ProjectCard,ProjectsView,SettingsPanel,TemplateEditor,describeOp };
