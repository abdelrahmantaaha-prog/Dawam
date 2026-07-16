import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Plus, X, Check, ChevronLeft, ChevronRight, Settings, Sparkles, Trash2, Link as LinkIcon, Image as ImageIcon, StickyNote, Loader2, CheckCircle2, Circle, AlertCircle, Tag, Clock, GripVertical, Inbox, LayoutTemplate, CornerUpRight, Copy, Calendar, Target, TrendingUp, Flag, Languages, Repeat, ChevronDown, Flame, Lock, Shield, KeyRound, Delete } from 'lucide-react';
import { isOath,OATH_AR,hashPin,APP_VERSION,BLOCKS,CAIRO,D2R,DEFAULT_LABELS,DEFAULT_SETTINGS,DEFAULT_TIMINGS,LABEL_ICON,LABEL_SWATCHES,LANG,LANGS,MONTHS,MONTHS_AR,PRAYER_BLOCKS,SKY_KEYFRAMES,TIME_24,WEEKDAYS,WEEKDAYS_AR,WEEKDAYS_FULL,WEEKDAYS_FULL_AR,activeBlockAt,addDays,bHint,bName,bSub,blockById,cleanTime,computePrayerTimes,darcsin,darctan2,dsin,firstJsonObject,fixAngle,fixHour,fmtISO,fmtTime,glowLevel,habitDoneOn,habitStreak,inWindow,isRTL,julianDay,lerpArr,lerpN,mdInline,migrateSettings,minutesOf,mkSubs,mm2,mon,newHabit,newProject,pad,parseISO,parseRange,projectPace,projectProgress,renderMarkdown,rgbStr,rgbaStr,sameDay,setLang,setTime24,skyAt,startOfWeek,sunPosition,tx,tEndMin,tStartMin,timeLabel,timeOrder,toHM,uid,vBlock,wd,wdFull,weekdayFullList,windowBounds } from './core.jsx';
import { rawGet, rawSet, rawDelete, rawList, loadKey, saveKey, storageAvailable } from './storage.js';

import { AppIcon,BlockRow,FlameGlyph,HabitLine,Landscape,NoteBlock,NotesEditor,PlanSide,PoolEditor,SkyScene,SubtaskEditor,TaskEditor,pyramidPath } from './components.jsx';
function HabitsView({ habits, sky, stars, heroLight, onAdd, onUpd, onDel, onToggleDay, onFocus }) {
  const [openId, setOpenId] = useState(null);
  const todayISO = fmtISO(new Date());
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
              <div className="habit-group-h" style={{ color: b.accentDeep }}>{bName(b)}{bSub(b) ? ` · ${bSub(b)}` : ''}</div>
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
function ProjectsView({ projects, sky, stars, heroLight, onAdd, onUpd, onDel, onLog, taskList, onToggleTask, onOpenTask }) {
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
            onToggleTask={onToggleTask} onOpenTask={onOpenTask} />
        ))}
        <button className="plan-day-btn proj-add" onClick={() => { const np = onAdd(); setOpenId(np.id); }}><Plus size={15} /> {tx('New project', 'مشروع جديد')}</button>
      </div>
    </div>
  );
}

function ProjectCard({ p, open, onOpen, onUpd, onDel, onLog, taskInfo, onToggleTask, onOpenTask }) {
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
          <div className="proj-tasks-h">{tx('Tasks', 'المهام')} <span className="proj-rollup">{taskInfo.done}/{taskInfo.total} {tx('done', 'منجز')}</span></div>
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
function SettingsPanel({ settings, onChange, templates, onAddTemplate, onUpdTemplate, onDelTemplate, onExport, onImport, onSetPin, sync, onSyncSignIn, onSyncSignOut, onSyncGoogle, onSyncNow, gcal, onCalConnect, onCalDisconnect, onCalLoad, onCalToggle, storageOk, onClose, onClearDay, dayLabel, onLang }) {
  const [syncEmail, setSyncEmail] = useState('');
  const [syncPass, setSyncPass] = useState('');
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
  const doExport = async () => { setBusy(true); setStatus(tx('Preparing…', 'جارٍ التحضير…')); try { setExp(await onExport()); setStatus(''); } catch { setStatus(tx('Export failed.', 'فشل التصدير.')); } setBusy(false); };
  const doCopy = async () => { try { await navigator.clipboard.writeText(exp); setStatus(tx('Copied.', 'تم النسخ.')); } catch { setStatus(tx('Copy blocked — select the text manually.', 'تعذّر النسخ — حدّد النص يدويًا.')); } };
  const doDownload = () => { try { const blob = new Blob([exp], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `rhythm-backup-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); } catch { setStatus(tx('Download blocked — copy the text instead.', 'تعذّر التنزيل — انسخ النص بدلًا من ذلك.')); } };
  const onFile = (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => setImp(String(r.result || '')); r.readAsText(f); };
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
              <div className="sect-h">{tx('Dark mode', 'الوضع الداكن')}</div>
              <label className="toggle"><input type="checkbox" checked={local.autoDark !== false} onChange={(e) => patch({ autoDark: e.target.checked })} /><span>{tx('Switch to dark automatically at night (Maghrib to Sunrise)', 'التبديل إلى الداكن تلقائيًا ليلًا (من المغرب إلى الشروق)')}</span></label>
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
              <div className="sect-h"><Repeat size={13} /> {tx('Cross-device sync (optional)', 'المزامنة بين الأجهزة (اختياري)')}</div>
              <div className="security-note"><Shield size={15} /><p>{tx('Sync copies your planner to a Supabase project you own, so your other devices can pull it. Turning this on means your data leaves the device — protected by your account, resolved per item by most-recent-edit. Leave it off to stay fully local. Setup steps are in the README (one SQL snippet, two values to paste below).', 'تنسخ المزامنة مخططك إلى مشروع Supabase تملكه أنت لتسحبه أجهزتك الأخرى. تفعيلها يعني خروج بياناتك من الجهاز — محمية بحسابك، وتُحسم التعارضات لكل عنصر بالأحدث تعديلًا. اتركها معطّلة لتبقى محليًا بالكامل. خطوات الإعداد في README.')}</p></div>
              <details className="sync-advanced">
                <summary>{tx('Advanced: use your own Supabase backend', 'متقدم: استخدم خادم Supabase الخاص بك')}</summary>
                <p className="hint-text" style={{ marginTop: 6 }}>{tx('Leave empty to use the built-in Rhythm backend. Fill both to point this device at your own project instead (setup in the README).', 'اتركهما فارغين لاستخدام خادم التطبيق المدمج. املأ الحقلين لتوجيه هذا الجهاز إلى مشروعك الخاص (الإعداد في README).')}</p>
                <div className="pin-set-grid">
                  <label><span>{tx('Supabase URL', 'عنوان Supabase')}</span><input className="time-input" style={{ letterSpacing: 0, textAlign: 'start' }} value={local.syncUrl || ''} onChange={(e) => patch({ syncUrl: e.target.value.trim() })} placeholder="https://xyz.supabase.co" autoComplete="off" /></label>
                  <label><span>{tx('Anon key', 'المفتاح العام')}</span><input className="time-input" type="password" style={{ letterSpacing: 0, textAlign: 'start' }} value={local.syncAnonKey || ''} onChange={(e) => patch({ syncAnonKey: e.target.value.trim() })} placeholder="sb_publishable_…" autoComplete="off" /></label>
                </div>
              </details>
              {sync && sync.user ? (
                <>
                  <p className="hint-text" style={{ color: 'var(--verdigris)', fontWeight: 700 }}><KeyRound size={12} /> {tx('Signed in as', 'مسجّل باسم')} {sync.user.email}{sync.lastSync ? ` · ${tx('last sync', 'آخر مزامنة')} ${sync.lastSync.toLocaleTimeString()}` : ''}</p>
                  <div className="io-actions">
                    <button className="primary" onClick={onSyncNow} disabled={sync.busy}>{sync.busy ? tx('Syncing…', 'جارٍ المزامنة…') : tx('Sync now', 'زامن الآن')}</button>
                    <button className="ghost sm" onClick={onSyncSignOut} disabled={sync.busy}>{tx('Sign out', 'تسجيل الخروج')}</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="pin-set-grid" style={{ marginTop: 10 }}>
                    <label><span>{tx('Email', 'البريد')}</span><input className="time-input" type="email" style={{ letterSpacing: 0, textAlign: 'start' }} value={syncEmail} onChange={(e) => setSyncEmail(e.target.value)} autoComplete="off" /></label>
                    <label><span>{tx('Password', 'كلمة المرور')}</span><input className="time-input" type="password" style={{ letterSpacing: 0, textAlign: 'start' }} value={syncPass} onChange={(e) => setSyncPass(e.target.value)} autoComplete="off" /></label>
                  </div>
                  <div className="io-actions">
                    <button className="primary" disabled={!syncEmail || !syncPass || (sync && sync.busy)} onClick={() => onSyncSignIn(syncEmail, syncPass, false)}>{tx('Sign in', 'تسجيل الدخول')}</button>
                    <button className="ghost sm" disabled={!syncEmail || !syncPass || (sync && sync.busy)} onClick={() => onSyncSignIn(syncEmail, syncPass, true)}>{tx('Create account', 'إنشاء حساب')}</button>
                    <button className="ghost sm" disabled={sync && sync.busy} onClick={onSyncGoogle} title={tx('Requires enabling the Google provider in Supabase — see README', 'يتطلب تفعيل مزوّد Google في Supabase — انظر README')}>{tx('Continue with Google', 'المتابعة بحساب Google')}</button>
                  </div>
                  <p className="hint-text" style={{ marginTop: 6 }}>{tx('Google sign-in needs a one-time setup in Supabase (README → Google sign-in). Email + password works with no extra setup.', 'يتطلب دخول Google إعدادًا لمرة واحدة في Supabase (انظر README). البريد وكلمة المرور يعملان دون إعداد إضافي.')}</p>
                </>
              )}
              {sync && sync.msg && <p className="hint-text" style={{ marginTop: 8 }}>{sync.msg}</p>}

              <div className="sect-h" style={{ marginTop: 20 }}><Calendar size={13} /> {tx('Google Calendar (read-only)', 'تقويم Google (للعرض فقط)')}</div>
              <p className="hint-text" style={{ marginTop: 0 }}>{tx('Show your Google Calendar events inside the Plan day, in their prayer period. Read-only — Rhythm never changes your calendar. Uses your Google sign-in; the calendar permission is short-lived, so you may need to reconnect from time to time.', 'اعرض أحداث تقويم Google داخل يوم التخطيط ضمن فترة الصلاة. للعرض فقط — لا يغيّر التطبيق تقويمك. يستخدم دخول Google؛ صلاحية التقويم قصيرة العمر، لذا قد تحتاج إلى إعادة الاتصال أحيانًا.')}</p>
              {!gcal.connected ? (
                <button className="primary" onClick={onCalConnect}><Calendar size={14} /> {tx('Connect Google Calendar', 'ربط تقويم Google')}</button>
              ) : (
                <>
                  <div className="io-actions">
                    <button className="ghost sm" onClick={onCalLoad}>{tx('Load my calendars', 'تحميل تقاويمي')}</button>
                    <button className="ghost sm" onClick={onCalConnect}>{tx('Reconnect', 'إعادة الاتصال')}</button>
                    <button className="ghost sm" onClick={onCalDisconnect}>{tx('Disconnect', 'فصل')}</button>
                  </div>
                  {gcal.calendars.length > 0 && (
                    <div className="cal-picker">
                      {gcal.calendars.map((c) => (
                        <label key={c.id} className="cal-pick-row">
                          <input type="checkbox" checked={gcal.ids.includes(c.id)} onChange={() => onCalToggle(c.id)} />
                          <span className="cal-dot" style={{ background: c.color }} />
                          <span className="cal-pick-name">{c.name}{c.primary ? ` · ${tx('primary', 'الأساسي')}` : ''}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </>
              )}
              {gcal.msg && <p className="hint-text" style={{ marginTop: 8 }}>{gcal.msg}</p>}
            </div>
          )}

          {tab === 'backup' && (
            <div className="sect">
              <div className="sect-h"><Copy size={13} /> {tx('Backup & move devices', 'النسخ الاحتياطي ونقل الأجهزة')}</div>
              {!storageOk && <p className="hint-text" style={{ marginTop: 0, color: '#9C4221' }}>{tx("This device isn't persisting between sessions — export is the only way to keep your plan.", 'هذا الجهاز لا يحفظ بين الجلسات — التصدير هو الطريقة الوحيدة للاحتفاظ بخطتك.')}</p>}
              <div className="drive-box"><div className="drive-title">{tx('Local-only by design', 'محلي فقط حسب التصميم')}</div><p className="hint-text" style={{ marginTop: 0, marginBottom: 0 }}>{tx('Everything lives in this browser on this device — nothing is sent anywhere. That means backups are on you: export a file now and then, especially before clearing browser data.', 'كل شيء محفوظ في هذا المتصفح على هذا الجهاز — لا يُرسل شيء إلى أي مكان. لذا فالنسخ الاحتياطي مسؤوليتك: صدّر ملفًا بين الحين والآخر، خاصة قبل مسح بيانات المتصفح.')}</p></div>
              <div className="drive-box" style={{ marginTop: 12 }}><div className="drive-title"><Sparkles size={13} /> {tx('AI sorting (optional)', 'الفرز الذكي (اختياري)')}</div>
                <p className="hint-text" style={{ marginTop: 0, marginBottom: 8 }}>{tx('The brain-dump sorter on the Plan page calls the Anthropic API directly from your browser and needs your own API key. The key is stored only on this device and is the one exception to "nothing is sent anywhere" — your dump text goes to Anthropic when you use it.', 'يستدعي فارز تفريغ الأفكار في صفحة التخطيط واجهة Anthropic مباشرة من متصفحك ويحتاج إلى مفتاحك الخاص. يُحفظ المفتاح على هذا الجهاز فقط، وهو الاستثناء الوحيد لمبدأ «لا يُرسل شيء» — إذ يُرسل نص التفريغ إلى Anthropic عند استخدامه.')}</p>
                <div className="pin-set-grid" style={{ marginBottom: 8 }}>
                  <label><span>{tx('Provider', 'المزوّد')}</span><select className="time-input" value={local.aiProvider || 'anthropic'} onChange={(e) => patch({ aiProvider: e.target.value })}><option value="anthropic">Anthropic (Claude)</option><option value="gemini">{tx('Google Gemini — free tier', 'Google Gemini — خطة مجانية')}</option></select></label>
                  <label><span>{tx('API key', 'المفتاح')}</span><input className="time-input" type="password" value={local.apiKey || ''} onChange={(e) => patch({ apiKey: e.target.value.trim() })} placeholder={local.aiProvider === 'gemini' ? 'AIza…' : 'sk-ant-…'} autoComplete="off" style={{ letterSpacing: 0, textAlign: 'start' }} /></label>
                </div>
                <p className="hint-text" style={{ margin: 0 }}>{local.aiProvider === 'gemini' ? tx('Free keys: aistudio.google.com/apikey. Note: on the free tier Google may use prompts to improve its products.', 'مفاتيح مجانية: aistudio.google.com/apikey. ملاحظة: قد تستخدم Google المدخلات في الخطة المجانية لتحسين منتجاتها.') : tx('Keys: console.anthropic.com (paid).', 'المفاتيح: console.anthropic.com (مدفوع).')}</p>
              </div>
              <p className="hint-text" style={{ marginTop: 14 }}>{tx('Export a backup file, and import it here (or on a new device/browser) to restore.', 'صدّر ملف نسخة احتياطية، واستورده هنا (أو على جهاز/متصفح جديد) للاستعادة.')}</p>
              <div className="io-actions"><button className="ghost sm" onClick={doExport} disabled={busy}>{tx('Generate export', 'إنشاء نسخة للتصدير')}</button>{exp && <button className="ghost sm" onClick={doCopy}>{tx('Copy', 'نسخ')}</button>}{exp && <button className="ghost sm" onClick={doDownload}>{tx('Download .json', 'تنزيل .json')}</button>}</div>
              {exp && <textarea className="io-text" readOnly value={exp} onFocus={(e) => e.target.select()} rows={4} />}
              <div className="io-import"><input type="file" accept="application/json,.json" onChange={onFile} className="file-in" /><textarea className="io-text" placeholder={tx('…or paste a backup to import', '…أو الصق نسخة احتياطية للاستيراد')} value={imp} onChange={(e) => setImp(e.target.value)} rows={3} /><button className="primary" disabled={busy || !imp.trim()} onClick={doImport}>{tx('Import & replace', 'استيراد واستبدال')}</button></div>
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
