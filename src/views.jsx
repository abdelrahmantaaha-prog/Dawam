import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Timer, Plus, X, Check, ChevronLeft, ChevronRight, Settings, Sparkles, Trash2, Link as LinkIcon, Image as ImageIcon, StickyNote, Loader2, CheckCircle2, Circle, AlertCircle, Tag, Clock, GripVertical, Inbox, LayoutTemplate, CornerUpRight, Copy, Calendar, Target, TrendingUp, Flag, Languages, Repeat, ChevronDown, Flame, Lock, Shield, KeyRound, Delete, Rows3, Coins } from 'lucide-react';
import { boardSummary, columnsOf } from './board.js';
import { DAILY, WEEKLY, MONTHLY, normalizeRepeat } from './recur.js';
import { normalizePlan, paceStatus, todayQuota } from './quota.js';
import { fmtFocus, projectFocusBetween, projectFocusTotal } from './projectfocus.js';
import { TINY, habitStats, isPrayerAnchor, stackShape, wouldCycle } from './habits.js';
import { hashPin,APP_VERSION,BLOCKS,CAIRO,D2R,DEFAULT_LABELS,DEFAULT_SETTINGS,DEFAULT_TIMINGS,LABEL_ICON,LABEL_SWATCHES,LANG,LANGS,MONTHS,MONTHS_AR,PRAYER_BLOCKS,SKY_KEYFRAMES,TIME_24,WEEKDAYS,WEEKDAYS_AR,WEEKDAYS_FULL,WEEKDAYS_FULL_AR,activeBlockAt,addDays,bHint,bName,bSub,blockById,cleanTime,computePrayerTimes,darcsin,darctan2,dsin,firstJsonObject,fixAngle,fixHour,fmtISO,fmtTime,glowLevel,habitDoneOn,habitStreak,inWindow,isRTL,julianDay,lerpArr,lerpN,mdInline,migrateSettings,minutesOf,mkSubs,mm2,mon,newHabit,newProject,pad,parseISO,parseRange,projectPace,projectProgress,renderMarkdown,rgbStr,rgbaStr,sameDay,setLang,setTime24,skyAt,startOfWeek,sunPosition,tx,tEndMin,tStartMin,timeLabel,timeOrder,toHM,uid,vBlock,wd,wdFull,weekdayFullList,windowBounds } from './core.jsx';
import { rawGet, rawSet, rawDelete, rawList, loadKey, saveKey, storageAvailable } from './storage.js';

import { AppIcon,BlockRow,DurationInput,FlameGlyph,HabitLine,Landscape,NoteBlock,NotesEditor,PlanSide,PoolEditor,SkyScene,SubtaskEditor,TaskEditor,pyramidPath } from './components.jsx';
import { saveJson } from './files.js';
import { CalendarSettings } from './calview.jsx';
import { TrelloSettings } from './trelloview.jsx';
function HabitsView({ habits, sky, stars, heroLight, todayISO: todayISOProp, rewards = [], balance = 0, onClaim, onAdd, onUpd, onDel, onToggleDay, onFocus, onMarkTiny }) {
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
          // Stacked habits follow their anchor, and carry how deep in the
          // chain they sit so the card can be drawn hanging off the one above.
          const group = stackShape(habits.filter((h) => (h.block || 'morning') === b.id));
          if (!group.length) return null;
          return (
            <div key={b.id} className="habit-group">
              <div className="habit-group-h blk-ink" style={{ '--bi-light': b.accentDeep, '--bi-dark': b.accent }}>{bName(b)}{bSub(b) ? ` · ${bSub(b)}` : ''}</div>
              {group.map(({ habit: h, depth, hasAnchor, anchorsOthers }) => (
                <div key={h.id} className={`habit-stack d${depth}${hasAnchor ? ' hung' : ''}${anchorsOthers ? ' anchors' : ''}`}>
                  {hasAnchor && <span className="habit-link" aria-hidden="true" />}
                  <HabitCard id={`habit-${h.id}`} h={h} habits={habits} todayISO={todayISO} open={openId === h.id}
                    rewards={rewards} balance={balance} onClaim={onClaim}
                    onOpen={() => setOpenId(openId === h.id ? null : h.id)}
                    onUpd={(patch) => onUpd(h.id, patch)} onDel={() => { onDel(h.id); setOpenId(null); }}
                    onToggle={(iso) => onToggleDay(h.id, iso)} onFocus={(mins) => onFocus(h, mins)}
                    onMarkTiny={(iso) => onMarkTiny && onMarkTiny(h.id, iso)} />
                </div>
              ))}
            </div>
          );
        })}
        <button className="plan-day-btn proj-add" onClick={() => {
          const nh = onAdd();
          setOpenId(nh.id);
          // It lands in whichever period it defaults to, which is rarely the
          // one you were looking at — so go to it rather than leaving the
          // person to hunt for an editor that opened off-screen.
          requestAnimationFrame(() => {
            const el = document.getElementById(`habit-${nh.id}`);
            if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          });
        }}><Plus size={15} /> {tx('New habit', 'عادة جديدة')}</button>
      </div>
    </div>
  );
}

function HabitCard({ id, h, habits = [], todayISO, open, rewards = [], balance = 0, onClaim, onOpen, onUpd, onDel, onToggle, onFocus, onMarkTiny = () => {} }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const isPrayer = !!h.prayer; // built-in, derived from the prayer log
  const streak = habitStreak(h, todayISO);
  const glow = glowLevel(streak);
  const doneToday = habitDoneOn(h, todayISO);
  const stats = habitStats(h, todayISO, 30);
  const tiny = String(h.tiny || '').trim();
  const linked = h.rewardId ? rewards.find((r) => r.id === h.rewardId) : null;
  const canClaim = linked && balance >= (Number(linked.cost) || 0);
  const anchor = h.after
    ? (isPrayerAnchor(h.after)
      ? `${bName(blockById(h.after.slice(7)))} ${tx('prayer', 'صلاة')}`
      : (habits.find((x) => x.id === h.after) || {}).name)
    : null;
  // last 7 days, oldest → newest
  const today = parseISO(todayISO);
  const week = Array.from({ length: 7 }, (_, i) => { const d = addDays(today, i - 6); return { iso: fmtISO(d), d, done: habitDoneOn(h, fmtISO(d)) }; });
  return (
    <div id={id} className={`habit-card glow-${glow}`} style={{ '--hcolor': h.color }}>
      <div className="habit-top">
        <button className={`habit-check ${doneToday ? 'on' : ''}`} onClick={() => onToggle(todayISO)} aria-label={tx('Toggle today', 'تبديل اليوم')}>
          {doneToday ? <CheckCircle2 size={22} /> : <Circle size={22} />}
        </button>
        <button className="habit-main" onClick={onOpen}>
          {h.identity ? <span className="habit-identity">{h.identity}</span> : null}
          <span className="habit-name">{h.name}</span>
          <span className="habit-streak">
            <FlameGlyph level={glow} size={13} /> {streak > 0 ? `${streak} ${tx('day', 'يوم')}${streak !== 1 && LANG !== 'ar' ? 's' : ''}` : tx('no streak', 'لا سلسلة')}
            {/* The number that survives a slip. A streak of 0 after 29 kept
                days is true and useless; this is what stops the card reading
                as failure on the one day it matters most. */}
            {stats.consistency.of >= 7 ? <span className="habit-cons">{stats.consistency.pct}% · {stats.consistency.kept}/{stats.consistency.of}</span> : null}
            {stats.best > streak ? <span className="habit-best">{tx('best', 'الأفضل')} {stats.best}</span> : null}
          </span>
          {anchor ? <span className="habit-after">{tx('After', 'بعد')} {anchor}</span> : null}
          {h.cue ? <span className="habit-cue">{h.cue}</span> : null}
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
      {/* The one rule worth interrupting for. Said only when it is actually
          true: once two days are gone the chain is already lost, and telling
          someone not to miss twice then would be a lie. */}
      {stats.risk === 'atRisk' && (
        <div className="habit-risk">
          <AlertCircle size={13} />
          <span>{tx('Missed yesterday. Never miss twice.', 'فاتتك أمس. لا تفوّتها مرتين.')}</span>
          {tiny ? <button className="ghost sm" onClick={() => onMarkTiny(todayISO)}>{tx('Do the 2-minute version', 'افعل نسخة الدقيقتين')}</button> : null}
        </div>
      )}
      {stats.risk === 'broken' && stats.best > 0 && (
        <div className="habit-risk soft">
          <span>{tx('The chain is broken — start a new one today.', 'انقطعت السلسلة — ابدأ واحدة جديدة اليوم.')}</span>
        </div>
      )}
      {tiny && !doneToday && stats.risk !== 'atRisk' && (
        <button className="habit-tiny-btn" onClick={() => onMarkTiny(todayISO)}>
          {tx('Too little time?', 'وقتك ضيّق؟')} <strong>{tiny}</strong>
        </button>
      )}
      {h.reward && stats.doneToday ? <div className="habit-reward">{tx('Now:', 'الآن:')} {h.reward}</div> : null}
      {/* A reward you can actually take, priced in the points this habit has
          been paying all along — the note-to-self version above never cost
          anything and so never really was a reward. */}
      {linked && (
        <div className={`habit-prize ${canClaim ? 'ready' : ''}`}>
          <Coins size={13} />
          <span className="habit-prize-n">{linked.name}</span>
          <span className="habit-prize-bar"><span style={{ width: `${Math.min(100, Math.round((balance / Math.max(1, Number(linked.cost) || 1)) * 100))}%` }} /></span>
          <span className="habit-prize-c">{balance}/{linked.cost}</span>
          {canClaim && onClaim ? <button className="primary sm" onClick={() => onClaim(linked)}>{tx('Claim', 'استلم')}</button> : null}
        </div>
      )}
      {stats.tinyToday && <div className="habit-tinytag">{tx('kept small today — still counts', 'أُنجزت مصغّرة اليوم — وتُحتسب')}</div>}
      {open && (
        <div className="proj-edit">
          {isPrayer ? (
            <p className="hint-text" style={{ margin: 0 }}>{tx('Built-in — the same record as ticking the prayer on Now.', 'مدمجة — السجل نفسه الذي تعلّمه من صفحة «الآن».')}</p>
          ) : (<>
          <div className="proj-field"><span>{tx('Habit name', 'اسم العادة')}</span><input className="projname" value={h.name} onChange={(e) => onUpd({ name: e.target.value })} /></div>
          <div className="proj-grid2">
            <label><span>{tx('Colour', 'اللون')}</span><input className="swatch proj-swatch" type="color" value={h.color} onChange={(e) => onUpd({ color: e.target.value })} /></label>
            <label><span>{tx('Day period', 'فترة اليوم')}</span><select className="time-input" value={h.block || 'morning'} onChange={(e) => onUpd({ block: e.target.value })}>{BLOCKS.map((b) => <option key={b.id} value={b.id}>{bName(b)}</option>)}</select></label>
          </div>
          <div className="proj-field">
            <span>{tx('Who this makes you', 'من تصير به')}</span>
            <input className="projname" value={h.identity || ''} onChange={(e) => onUpd({ identity: e.target.value })}
              placeholder={tx('I am someone who reads', 'أنا شخص يقرأ')} />
            <p className="hint-text" style={{ margin: '4px 0 0' }}>{tx('Every time you keep it, it is a vote for this. The goal is not to read a book — it is to become a reader.', 'كل مرة تلتزم بها هي صوت لصالح هذا. الهدف ليس قراءة كتاب — بل أن تصير قارئًا.')}</p>
          </div>
          <div className="proj-field">
            <span>{tx('Stack it after', 'اربطها بعد')}</span>
            <select className="time-input" value={h.after || ''} onChange={(e) => onUpd({ after: e.target.value || null })}>
              <option value="">{tx('— nothing —', '— لا شيء —')}</option>
              <optgroup label={tx('Prayers', 'الصلوات')}>
                {PRAYER_BLOCKS.map((pid) => <option key={pid} value={`prayer:${pid}`}>{tx('After', 'بعد')} {bName(blockById(pid))}</option>)}
              </optgroup>
              {habits.filter((x) => x.id !== h.id && !x.prayer && !wouldCycle(habits, h.id, x.id)).length > 0 && (
                <optgroup label={tx('Habits', 'العادات')}>
                  {habits.filter((x) => x.id !== h.id && !x.prayer && !wouldCycle(habits, h.id, x.id)).map((x) => (
                    <option key={x.id} value={x.id}>{tx('After', 'بعد')} {x.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <p className="hint-text" style={{ margin: '4px 0 0' }}>{tx('A new habit needs an old one to hang on. Pick something that already happens without fail — the prayers are the surest anchors here.', 'العادة الجديدة تحتاج قديمة تتعلق بها. اختر ما يحدث بالفعل دون تخلّف — والصلوات أضمن المراسي هنا.')}</p>
          </div>
          <div className="proj-field">
            <span>{tx('What triggers it', 'ما الذي يبدؤها')}</span>
            <input className="projname" value={h.cue || ''} onChange={(e) => onUpd({ cue: e.target.value })}
              placeholder={tx('After Fajr, at the desk', 'بعد الفجر، على المكتب')} />
            <p className="hint-text" style={{ margin: '4px 0 0' }}>{tx('A habit needs a moment to hang on. Name the one that already happens every day — the period above is half of it; this is the rest.', 'العادة تحتاج لحظة تتعلق بها. سمِّ ما يحدث يوميًا بالفعل — الفترة أعلاه نصف الأمر، وهذا باقيه.')}</p>
          </div>
          <div className="proj-field">
            <span>{tx('What you get right after', 'ما تناله مباشرة بعدها')}</span>
            <input className="projname" value={h.reward || ''} onChange={(e) => onUpd({ reward: e.target.value })}
              placeholder={tx('Coffee on the balcony', 'قهوة في الشرفة')} />
            <p className="hint-text" style={{ margin: '4px 0 0' }}>{tx('What is rewarded immediately gets repeated. The reward has to arrive now, not at the end of the month.', 'ما يُكافأ فورًا يتكرر. لا بد أن تصل المكافأة الآن، لا في آخر الشهر.')}</p>
          </div>
          {rewards.length > 0 && (
            <div className="proj-field">
              <span>{tx('Pay it off against a reward', 'اجعلها تُموّل مكافأة')}</span>
              <select className="time-input" value={h.rewardId || ''} onChange={(e) => onUpd({ rewardId: e.target.value || null })}>
                <option value="">{tx('— none —', '— بدون —')}</option>
                {rewards.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.cost}</option>)}
              </select>
              <p className="hint-text" style={{ margin: '4px 0 0' }}>{tx('Keeping the habit already earns points. Naming what they are for turns a number into something you actually wanted.', 'الالتزام بالعادة يكسب نقاطًا أصلًا. تسمية ما تُنفق عليه يحوّل الرقم إلى شيء أردته فعلًا.')}</p>
            </div>
          )}
          <div className="proj-field">
            <span>{tx('The two-minute version', 'نسخة الدقيقتين')}</span>
            <input className="projname" value={h.tiny || ''} onChange={(e) => onUpd({ tiny: e.target.value })}
              placeholder={tx('Read one page', 'اقرأ صفحة واحدة')} />
            <p className="hint-text" style={{ margin: '4px 0 0' }}>{tx('What you do on the worst day. Keeping this still keeps the chain — a habit has to be established before it can be improved.', 'ما تفعله في أسوأ يوم. إنجازها يبقي السلسلة — العادة تُرسَّخ أولًا ثم تُحسَّن.')}</p>
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
        {/* A card is a summary now, so it does not need a full row to itself —
            auto-fill rather than a fixed count, so the number per row follows
            the window instead of a breakpoint someone has to maintain. An
            expanded card is much taller than its neighbours, which is why the
            row aligns to the top rather than stretching them all to match. */}
        <div className="proj-grid">
          {ordered.map((p) => (
            <ProjectCard key={p.id} p={p} open={openId === p.id}
              onOpen={() => setOpenId(openId === p.id ? null : p.id)}
              onUpd={(patch) => onUpd(p.id, patch)} onDel={() => { onDel(p.id); setOpenId(null); }}
              onLog={(amt, note) => onLog(p.id, amt, note)} taskInfo={taskList(p.id)}
              onToggleTask={onToggleTask} onOpenTask={onOpenTask} onBoard={() => onBoard && onBoard(p.id)} />
          ))}
        </div>
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
  // The work plan and what it asks for today — see src/quota.js.
  const plan = normalizePlan(p);
  const quota = todayQuota(p, new Date());
  const submitLog = () => { const n = Number(amt); if (!n) return; onLog(n, note.trim()); setAmt(''); setNote(''); };
  const tasks = (taskInfo && taskInfo.tasks) || [];
  const lanes = boardSummary(tasks, columnsOf(p));
  // Pace status: green (ahead/on), amber (a little behind), red (well behind).
  // One verdict (paceStatus in quota.js), so the card, Plan and Now agree.
  const verdict = paceStatus(p, pace);
  let statusClass = 'neutral', statusText = hasTarget ? tx('no deadline set', 'لا موعد نهائي') : tx('in progress', 'قيد التنفيذ');
  if (completed) { statusClass = 'done'; statusText = tx('completed', 'مكتمل'); }
  else if (verdict.key === 'waiting') { statusClass = 'neutral'; statusText = tx('not started yet', 'لم يبدأ بعد'); }
  else if (verdict.key === 'ahead' || verdict.key === 'on' || verdict.key === 'done') { statusClass = 'ok'; statusText = tx('on pace', 'على المسار'); }
  else if (verdict.key === 'behind' || verdict.key === 'far') {
    statusClass = verdict.key === 'far' ? 'behind' : 'warn';
    statusText = tx('behind pace', 'متأخر عن المسار');
  }
  // Focus minutes measured against this project (src/projectfocus.js).
  const focusAll = projectFocusTotal(p);
  const weekAgo = fmtISO(addDays(new Date(), -6));
  const focusWeek = projectFocusBetween(p, weekAgo, null);
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

      {focusAll > 0 && (
        <div className="proj-stats proj-focus">
          <span className="proj-stat" title={tx('Measured focus rounds counted towards this project', 'جولات تركيز مقيسة محسوبة لهذا المشروع')}>
            <Timer size={12} /> {fmtFocus(focusAll)} {tx('focused', 'تركيز')}
          </span>
          <span className="proj-stat">{fmtFocus(focusWeek)} {tx('in the last 7 days', 'في آخر ٧ أيام')}</span>
        </div>
      )}

      {/* A summary, not a second task list.
            It used to list eight tasks here — a worse copy of the board that
            was one tap away, and one that pushed every other project off the
            screen. What a project card is for is the shape of the thing: how
            much is left, how much is moving, and whether the number is on
            track. The board is where individual tasks are worked. */}
      {(tasks.length > 0 || hasTarget) && (
        <div className="proj-tasks">
          <div className="proj-tasks-h">
            {tx('Inside', 'بالداخل')}
            {tasks.length > 0 && <span className="proj-rollup">{taskInfo.done}/{taskInfo.total} {tx('done', 'منجز')}</span>}
            {onBoard && (
              <button className="ghost sm proj-board-btn" onClick={onBoard}>
                <Rows3 size={13} /> {tx('Open board', 'افتح اللوحة')}
              </button>
            )}
          </div>

          {tasks.length > 0 && (
            <>
              <div className="proj-lanebar" role="img"
                aria-label={lanes.lanes.map((l) => `${l.n} ${l.name}`).join(', ')}>
                {lanes.lanes.map((l) => (l.n > 0 ? (
                  <span key={l.id} className={`proj-laneseg ${l.id === 'done' ? 'done' : ''}`}
                    style={{ flexGrow: l.n }} title={`${l.name}: ${l.n}`} />
                ) : null))}
              </div>
              <div className="proj-lanekeys">
                {lanes.lanes.filter((l) => l.n > 0).map((l) => (
                  <span key={l.id} className="proj-lanekey">
                    <span className={`proj-lanedot ${l.id === 'done' ? 'done' : ''}`} />{l.n} {l.name}
                  </span>
                ))}
              </div>
            </>
          )}

          {/* The number, said plainly. A target with no arithmetic next to it
              is a wish; this is the remainder and the rate it needs. */}
          {hasTarget && !completed && (
            <div className="proj-numbers">
              <span className="proj-num"><strong>{pace.done}</strong>/{p.target} {unit}</span>
              <span className="proj-num">{Math.max(0, (Number(p.target) || 0) - pace.done)} {tx('to go', 'متبقٍ')}</span>
              {pace.expected != null && <span className="proj-num">{tx('expected by now', 'المتوقع الآن')} {Math.round(pace.expected)}</span>}
              {pace.perDay ? <span className="proj-num strong">{Math.ceil(pace.perDay)} {unit}/{tx('day', 'يوم')}</span> : null}
              {pace.daysLeft != null && <span className="proj-num">{pace.daysLeft} {tx('days left', 'يوم متبقٍ')}</span>}
            </div>
          )}
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
          {/* When this project should ask for its share of the day.

              A deadline is not something a person can act on. "Eleven pages,
              this morning" is, and that is what turns a project into a habit
              with an end date — appearing in Plan and Now on its own days, in
              its own block, going quiet the moment the share is logged.

              The pace divides by the SITTINGS that are left, not the calendar
              days: someone who writes on Tuesdays and Thursdays has three
              sittings before a deadline ten days out, not ten, and dividing by
              ten quietly sets them up to miss by a factor of three. Picking no
              days means every day. See src/quota.js. */}
          <div className="proj-plan">
            <div className="proj-plan-h"><Target size={12} /> {tx('Remind me to work on this', 'ذكّرني بالعمل على هذا')}</div>
            <label className="toggle">
              <input type="checkbox" checked={!!plan.on} disabled={!hasTarget}
                onChange={(e) => onUpd({ plan: { ...plan, on: e.target.checked } })} />
              <span>{hasTarget
                ? tx('Show today\u2019s share in Plan and Now', 'أظهر نصيب اليوم في التخطيط و«الآن»')
                : tx('Needs a target number above', 'يحتاج هدفًا رقميًا أعلاه')}</span>
            </label>
            {plan.on && hasTarget && (<>
              <div className="routine-days">
                {weekdayFullList().map((name, i) => (
                  <button key={i} className={`rday ${plan.days.includes(i) ? 'on' : ''}`} title={name} aria-pressed={plan.days.includes(i)}
                    onClick={() => onUpd({ plan: { ...plan, days: plan.days.includes(i) ? plan.days.filter((x) => x !== i) : [...plan.days, i].sort((a, b) => a - b) } })}>
                    {wd(i)}
                  </button>
                ))}
              </div>
              {/* A period is the app's own unit of time and the right default:
                  "in the morning" is how a person plans. The clock time is for
                  when that is too broad — a project you sit down to at nine
                  should not be asking at half past six. Optional, and it
                  narrows the period rather than replacing it. */}
              <label className="proj-plan-when">
                <span>{tx('From', 'اعتبارًا من')}</span>
                <select value={plan.block} onChange={(e) => onUpd({ plan: { ...plan, block: e.target.value } })}>
                  {BLOCKS.map((b) => <option key={b.id} value={b.id}>{bName(b)}</option>)}
                </select>
                <input className="time-input" type="time" value={plan.start || ''} style={{ maxWidth: 120 }}
                  title={tx('Not before this time (optional)', 'ليس قبل هذا الوقت (اختياري)')}
                  onChange={(e) => onUpd({ plan: { ...plan, start: e.target.value } })} />
                {plan.start && <button className="mini-del" onClick={() => onUpd({ plan: { ...plan, start: '' } })} aria-label={tx('Clear', 'مسح')}><X size={12} /></button>}
              </label>
              <p className="hint-text" style={{ margin: '4px 0 0' }}>
                {!plan.days.length
                  ? tx('No days picked — it will ask every day.', 'لم تختر أيامًا — سيطلب كل يوم.')
                  : quota.need == null
                    ? tx('Set a deadline above and it can work out today\u2019s share.', 'حدّد موعدًا نهائيًا أعلاه ليحسب نصيب اليوم.')
                    : `${tx('Today that is', 'نصيب اليوم')} ${quota.need} ${unit}.`}
              </p>
            </>)}
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
function SettingsPanel({ settings, onChange, templates, onAddTemplate, onUpdTemplate, onDelTemplate, onExport, onImport, onSetPin, sync, notify, onEnableNotify, onTestNotify, onRecheck, storageOk, onReadStorage, onFreeSpace, onClose, onClearDay, dayLabel, onLang, calendar, trello, autoBackups }) {
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
  /* The storage readout is measured, not guessed — and measuring it means
     writing until the browser refuses, so it runs when the Backup tab is
     opened rather than on every render. */
  const [store, setStore] = useState(null);
  const readStore = async () => { if (onReadStorage) { try { setStore(await onReadStorage()); } catch { setStore(null); } } };
  useEffect(() => { if (tab === 'backup') { readStore(); readAuto(); } }, [tab]);
  /* The automatic snapshots, newest first, and where they live. */
  const [auto, setAuto] = useState({ list: null, where: '' });
  const readAuto = async () => {
    if (!autoBackups) return;
    try { setAuto({ list: await autoBackups.list(), where: await autoBackups.where() }); } catch { setAuto({ list: [], where: '' }); }
  };
  const whenOf = (b) => {
    const m = String(b.name).match(/(\d{4}-\d{2}-\d{2})/);
    const d = b.at ? new Date(b.at) : null;
    const day = m ? m[1] : (d ? d.toISOString().slice(0, 10) : b.name);
    const clock = d ? ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
    return `${day}${clock}`;
  };
  const mb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
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
              {/* A tag can be fixed to a project: tagging a task then files it
                  under that project too, so the two are not picked separately
                  every time. A project chosen by hand is never overridden. */}
              {local.labels.map((p) => (<div key={p.id} className="projrow label-row"><input className="swatch" type="color" value={p.color} onChange={(e) => updLabel(p.id, { color: e.target.value })} /><input className="projname" value={p.name} onChange={(e) => updLabel(p.id, { name: e.target.value })} />
                <select className="label-proj" value={p.project || ''} onChange={(e) => updLabel(p.id, { project: e.target.value || null })}
                  aria-label={tx('Always files under project', 'يُنسب دائمًا إلى المشروع')} title={tx('Tasks with this tag go to this project', 'المهام بهذا الوسم تذهب إلى هذا المشروع')}>
                  <option value="">{tx('no fixed project', 'بلا مشروع ثابت')}</option>
                  {(local.projects || []).filter((x) => !x.completedAt || x.id === p.project).map((x) => <option key={x.id} value={x.id}>→ {x.name}</option>)}
                </select>
                <button className="mini-del" onClick={() => delLabel(p.id)}><X size={13} /></button></div>))}
              {(local.projects || []).length > 0 && <p className="hint-text">{tx('Fix a tag to a project and every task you tag with it is filed under that project — and its focus time counts there. A project you pick by hand on a task always wins.', 'اربط وسمًا بمشروع وستُنسب كل مهمة تحمل هذا الوسم إلى ذلك المشروع — ويُحسب وقت تركيزها له. المشروع الذي تختاره يدويًا للمهمة يبقى هو الأقوى.')}</p>}
              <button className="ghost sm" onClick={addLabel}><Plus size={14} /> {tx('Add label', 'إضافة وسم')}</button>
            </div>
          )}

          {tab === 'recurring' && (<>
            {/* Two knobs that change what Now does, so they sit together and
                say plainly what they will do rather than hiding behind a
                label. The lock in particular is a commitment device: nobody
                should meet it without having switched it on themselves. */}
            <div className="sect">
              <div className="sect-h"><Clock size={13} /> {tx('The Now page', 'صفحة الآن')}</div>
              <label className="field">
                <span>{tx('Show a timed task this many minutes early', 'اعرض المهمة الموقوتة قبل موعدها بـ')}</span>
                <input className="time-input" type="number" min="0" max="180" step="5" style={{ maxWidth: 120 }}
                  value={local.leadMin == null ? 30 : local.leadMin}
                  onChange={(e) => patch({ leadMin: Math.max(0, Math.min(180, Number(e.target.value) || 0)) })} />
                <span className="hint-text">{tx('Time to close what you were doing and be there, rather than to find out it has started. Zero turns it off.', 'وقت لتُنهي ما بين يديك وتكون هناك، بدل أن تكتشف أنها بدأت. الصفر يوقف هذا.')}</span>
              </label>
              <div className="sect-h" style={{ marginTop: 16 }}><Lock size={13} /> {tx('The time lock', 'قفل الوقت')}</div>
              <label className="toggle">
                <input type="checkbox" checked={local.timeLock !== false} onChange={(e) => patch({ timeLock: e.target.checked })} />
                <span>{tx('When a timed task\'s time comes, lock Rhythm until I am focusing on it', 'عندما يحين وقت مهمة موقوتة، اقفل التطبيق حتى أركّز عليها')}</span>
              </label>
              <p className="hint-text">{tx('A task with a start and an end can only be focused on inside that window, and while it is open it is the only thing you can focus on. Ending the round early locks Rhythm again until the window closes.', 'المهمة ذات البداية والنهاية لا يمكن التركيز عليها إلا داخل وقتها، وأثناءه تكون الشيء الوحيد الذي يمكنك التركيز عليه. إنهاء الجولة مبكرًا يقفل التطبيق مجددًا حتى ينتهي وقتها.')}</p>
              <div className="sect-h" style={{ marginTop: 16 }}><Lock size={13} /> {tx('The Now lock', 'قفل «الآن»')}</div>
              <label className="toggle">
                <input type="checkbox" checked={!!(local.nowLock && local.nowLock.on)}
                  onChange={(e) => patch({ nowLock: { ...(local.nowLock || {}), on: e.target.checked, everyMin: (local.nowLock && local.nowLock.everyMin) || 15 } })} />
                <span>{tx('Cover the whole app until I finish something', 'اقفل التطبيق بالكامل حتى أنجز شيئًا')}</span>
              </label>
              <label className="field">
                <span>{tx('After this many minutes with nothing finished', 'بعد هذا العدد من الدقائق دون إنجاز شيء')}</span>
                <input className="time-input" type="number" min="1" max="240" style={{ maxWidth: 120 }}
                  disabled={!(local.nowLock && local.nowLock.on)}
                  value={(local.nowLock && local.nowLock.everyMin) || 15}
                  onChange={(e) => patch({ nowLock: { ...(local.nowLock || {}), on: !!(local.nowLock && local.nowLock.on), everyMin: Math.max(1, Math.min(240, Number(e.target.value) || 15)) } })} />
              </label>
              <div className="security-note"><AlertCircle size={15} /><p>{tx(
                'This one is not a nudge. Nothing in the app is reachable while it is up — not Plan, not Settings, not this switch — and the only way out is to tick a task or a single step of one. It counts from the last thing you finished, and it never appears on a day with nothing left to do.',
                'هذا ليس تنبيهًا لطيفًا. لا شيء في التطبيق متاح أثناءه — لا التخطيط ولا الإعدادات ولا هذا المفتاح — والمخرج الوحيد هو إنجاز مهمة أو خطوة واحدة منها. يُحسب من آخر شيء أنجزته، ولا يظهر أبدًا في يوم لم يبقَ فيه شيء.')}</p></div>
            </div>
            <div className="sect">
              <div className="sect-h"><Repeat size={13} /> {tx('Recurring tasks', 'المهام المتكررة')}</div>
              <p className="hint-text" style={{ marginTop: 0 }}>{tx('Ready-made tasks you drop into a day. Editing one here only changes what you add later — tasks already on your calendar are untouched.', 'مهام جاهزة تضيفها إلى أي يوم. تعديلها هنا يؤثّر فقط على ما تضيفه لاحقًا — المهام الموجودة في تقويمك لا تتغيّر.')}</p>
              {templates.length === 0 && <p className="hint-text">{tx('None yet. Save any task or backlog item as a recurring task, or add one here.', 'لا يوجد بعد. احفظ أي مهمة أو عنصر من قائمة الانتظار كمهمة متكررة، أو أضف واحدة هنا.')}</p>}
              {templates.map((tp) => (<TemplateEditor key={tp.id} tpl={tp} projects={local.labels} allProjects={local.projects || []} onChange={(patch) => onUpdTemplate(tp.id, patch)} onDelete={() => onDelTemplate(tp.id)} />))}
              <button className="ghost sm" onClick={() => onAddTemplate({ title: tx('New recurring task', 'مهمة متكررة جديدة'), block: 'morning', subtasks: [] })}><Plus size={14} /> {tx('Add recurring task', 'إضافة مهمة متكررة')}</button>
            </div>
          </>)}

          {tab === 'prayer' && (<>
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
                {/* Google refuses OAuth in an embedded WebView, so on the phone
                    this button could only ever navigate the app away from
                    itself and land on disallowed_useragent. The code is the
                    way in there, so lead with it rather than offering a door
                    that is painted on. */}
                {sync.inAppShell ? (
                  <p className="hint-text" style={{ marginTop: 10 }}>{tx('Google sign-in cannot run inside the Android app — Google refuses embedded browsers. Link this phone with a code instead, from a device where you are already signed in.', 'لا يمكن تشغيل تسجيل دخول جوجل داخل تطبيق أندرويد — ترفض جوجل المتصفحات المدمجة. اربط هذا الهاتف برمز من جهاز سجّلت الدخول عليه.')}</p>
                ) : (<>
                  <div className="io-actions" style={{ marginTop: 10 }}>
                    <button className="primary" onClick={sync.signIn}><KeyRound size={14} /> {tx('Continue with Google', 'المتابعة بحساب Google')}</button>
                  </div>
                  <p className="hint-text" style={{ marginTop: 8 }}>{tx('Staying signed out keeps Rhythm exactly as it is: local-only.', 'البقاء دون تسجيل دخول يُبقي التطبيق كما هو: محلي بالكامل.')}</p>
                </>)}
                <div className="sect-h" style={{ marginTop: 16 }}><KeyRound size={13} /> {sync.inAppShell ? tx('Link with a code', 'اربط برمز') : tx('Or link with a code', 'أو اربط برمز')}</div>
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
              {/* Only when the store is unavailable outright. A FULL store is a
                  different problem with a different answer, and the readout
                  below says so — printing both read as self-contradiction. */}
              {!storageOk && !(store && store.failing) && <p className="hint-text" style={{ marginTop: 0, color: '#9C4221' }}>{tx("This device isn't persisting between sessions — export is the only way to keep your plan.", 'هذا الجهاز لا يحفظ بين الجلسات — التصدير هو الطريقة الوحيدة للاحتفاظ بخطتك.')}</p>}

              {/* What is actually in the store. This exists because "your
                  changes aren't saving" used to be something the app knew and
                  never said: a full device dropped every write in silence,
                  showed the task on screen anyway, and then sent its stale
                  copy to the other devices. */}
              <div className="sect-h" style={{ marginTop: 0 }}><Shield size={13} /> {tx('Storage on this device', 'التخزين على هذا الجهاز')}</div>
              {store && store.failing && (
                <p className="hint-text vault-warn" style={{ marginTop: 0 }}><AlertCircle size={12} /> {tx('This device is out of room, so nothing you add is being saved and syncing is paused. Free up space below, then add it again.', 'لا توجد مساحة على هذا الجهاز، لذا لا يُحفظ ما تضيفه وتم إيقاف المزامنة مؤقتًا. أفرغ مساحة أدناه ثم أضفه من جديد.')}</p>
              )}
              {store ? (<>
                <p className="hint-text" style={{ marginTop: 0, overflowWrap: 'anywhere' }}>
                  {tx('Used', 'المستخدم')}: <code>{mb(store.bytes)}</code> {tx('across', 'موزعة على')} <code>{store.keys}</code> {tx('items', 'عنصرًا')}
                  {' · '}{tx('room left', 'المتبقي')}: <code>{mb(store.headroom)}</code>
                  {store.derivedBytes > 0 ? <><br />{tx('of that, rebuildable cache', 'منها ذاكرة مؤقتة يمكن إعادة بنائها')}: <code>{mb(store.derivedBytes)}</code></> : null}
                  {store.top && store.top.length ? <><br />{tx('largest', 'الأكبر')}: {store.top.slice(0, 3).map((r) => `${r.key.replace('planner:', '')} (${mb(r.bytes)})`).join(' · ')}</> : null}
                </p>
                <div className="io-actions" style={{ marginTop: 6 }}>
                  <button className="ghost sm" onClick={async () => {
                    setStatus(tx('Freeing…', 'جارٍ التفريغ…'));
                    const r = await onFreeSpace();
                    await readStore();
                    setStatus(r.removed ? tx(`Cleared ${mb(r.bytes)} of cache. Prayer times, calendars and Trello rebuild themselves.`, `تم تفريغ ${mb(r.bytes)} من الذاكرة المؤقتة. ستُعاد أوقات الصلاة والتقويمات وترللو تلقائيًا.`) : tx('No cache to clear.', 'لا توجد ذاكرة مؤقتة.'));
                  }}>{tx('Free up space (clears rebuildable cache)', 'إفراغ مساحة (حذف الذاكرة المؤقتة)')}</button>
                  <button className="ghost sm" onClick={readStore}>{tx('Re-measure', 'إعادة القياس')}</button>
                </div>
              </>) : (
                <p className="hint-text" style={{ marginTop: 0 }}>{tx('Measuring…', 'جارٍ القياس…')}</p>
              )}
              <div className="drive-box"><div className="drive-title">{tx('Local-only by design', 'محلي فقط حسب التصميم')}</div><p className="hint-text" style={{ marginTop: 0, marginBottom: 0 }}>{tx('Everything lives on this device — nothing is sent anywhere unless you turn on sync. Automatic backups (below) keep a daily copy here; a downloaded file is still the copy that survives losing the device.', 'كل شيء محفوظ على هذا الجهاز — لا يُرسل شيء إلى أي مكان ما لم تفعّل المزامنة. يحتفظ النسخ التلقائي (أدناه) بنسخة يومية هنا؛ ويبقى الملف المنزَّل هو النسخة التي تنجو إن فُقد الجهاز.')}</p></div>
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
              {autoBackups && (<>
                <div className="sect-h" style={{ marginTop: 16 }}><Shield size={13} /> {tx('Automatic backups', 'النسخ التلقائي')}</div>
                <label className="toggle">
                  <input type="checkbox" checked={autoBackups.on} onChange={(e) => patch({ autoBackup: e.target.checked })} />
                  <span>{tx('Back up this device on its own, every day', 'انسخ هذا الجهاز تلقائيًا كل يوم')}</span>
                </label>
                <p className="hint-text" style={{ margin: '6px 0 0', overflowWrap: 'anywhere' }}>
                  {autoBackups.kind === 'desktop'
                    ? <>{tx('Saved as files in', 'تُحفظ كملفات في')} <code>{auto.where || 'Documents\\Rhythm backups'}</code>. {tx('They survive a reinstall, and any of them can be restored here or on another computer.', 'تبقى بعد إعادة التثبيت، ويمكن استعادة أي منها هنا أو على جهاز آخر.')}</>
                    : autoBackups.kind === 'phone'
                      ? tx("Saved in the app's own storage on this phone. They survive updates and cleared browser data, but not uninstalling the app — download a copy now and then to keep one off the phone.", 'تُحفظ في مساحة التطبيق على هذا الهاتف. تبقى بعد التحديثات ومسح بيانات المتصفح، لكن ليس بعد حذف التطبيق — نزّل نسخة من حين لآخر لتحفظها خارج الهاتف.')
                      : tx("Saved in this browser's database, separate from the planner itself. They do not survive clearing all site data — download a copy now and then.", 'تُحفظ في قاعدة بيانات هذا المتصفح بمعزل عن المخطط نفسه. لا تبقى بعد مسح كل بيانات الموقع — نزّل نسخة من حين لآخر.')}
                  {' '}{tx('The last 14 are kept: one a day, refreshed hourly while the app is open, plus one taken automatically before any restore.', 'تُحفظ آخر 14 نسخة: واحدة يوميًا تُحدَّث كل ساعة أثناء فتح التطبيق، وأخرى تلقائيًا قبل أي استعادة.')}
                </p>
                {autoBackups.info.error && <p className="hint-text vault-warn" style={{ marginTop: 6 }}><AlertCircle size={12} /> {tx('The last automatic backup failed', 'فشل آخر نسخ تلقائي')}: {autoBackups.info.error}</p>}
                <div className="io-actions" style={{ marginTop: 8 }}>
                  <button className="ghost sm" disabled={busy} onClick={async () => {
                    setBusy(true);
                    const r = await autoBackups.now();
                    setStatus(r.ok ? tx('Backed up.', 'تم النسخ.') : `${tx('Backup failed', 'فشل النسخ')}: ${r.error}`);
                    await readAuto(); setBusy(false);
                  }}>{tx('Back up now', 'انسخ الآن')}</button>
                  {autoBackups.kind === 'desktop' && <button className="ghost sm" onClick={() => autoBackups.open()}>{tx('Open the folder', 'افتح المجلد')}</button>}
                </div>
                {auto.list && auto.list.length > 0 && (
                  <ul className="auto-backups">
                    {auto.list.map((b) => (
                      <li key={b.name}>
                        <span className="ab-when">{whenOf(b)}{/before-restore/.test(b.name) ? <em> · {tx('before a restore', 'قبل استعادة')}</em> : null}</span>
                        <span className="ab-size">{b.bytes ? mb(b.bytes) : ''}</span>
                        <button className="ghost sm" disabled={busy} onClick={async () => {
                          if (!window.confirm(tx(`Restore the backup from ${whenOf(b)}? It REPLACES what is on this device (the current state is backed up first).`, `استعادة نسخة ${whenOf(b)}؟ سيستبدل هذا ما على الجهاز (مع نسخ الحالة الحالية أولًا).`))) return;
                          setBusy(true); setStatus(tx('Restoring…', 'جارٍ الاستعادة…'));
                          const r = await autoBackups.restore(b.name);
                          setStatus(r.msg); await readAuto(); setBusy(false);
                        }}>{tx('Restore', 'استعادة')}</button>
                      </li>
                    ))}
                  </ul>
                )}
                {auto.list && auto.list.length === 0 && <p className="hint-text" style={{ marginTop: 6 }}>{tx('No automatic backups yet — the first is taken a few seconds after the app opens.', 'لا نسخ تلقائية بعد — تُؤخذ الأولى بعد ثوانٍ من فتح التطبيق.')}</p>}
              </>)}
              <div className="sect-h" style={{ marginTop: 16 }}><Copy size={13} /> {tx('Save a backup', 'حفظ نسخة احتياطية')}</div>
              <p className="hint-text" style={{ marginTop: 0 }}>{tx('Downloads a .json file holding your whole planner. Keep it somewhere off this device — it is the copy that survives losing it.', 'ينزّل ملف .json يحتوي مخططك بالكامل. احفظه خارج هذا الجهاز — فهو النسخة التي تنجو إن فقدته.')}</p>
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
function TemplateEditor({ tpl, projects, allProjects = [], onChange, onDelete }) {
  const [sub, setSub] = useState('');
  const subs = tpl.subtasks || [];
  const addSub = () => { if (sub.trim()) { onChange({ subtasks: [...subs, sub.trim()] }); setSub(''); } };
  const delSub = (i) => onChange({ subtasks: subs.filter((_, j) => j !== i) });
  const rep = normalizeRepeat(tpl.repeat);
  const setRep = (patch) => onChange({ repeat: { ...rep, ...patch } });
  const toggleIn = (list, n) => (list.includes(n) ? list.filter((x) => x !== n) : [...list, n].sort((a, b) => a - b));
  return (
    <div className="routine-card">
      <div className="routine-top"><input className="projname" value={tpl.title} onChange={(e) => onChange({ title: e.target.value })} /><button className="mini-del" onClick={onDelete} aria-label="Delete recurring task"><Trash2 size={14} /></button></div>
      <div className="routine-fields">
        {/* A start time decides the period (the app sets it when the time is
            saved), so the picker only speaks for untimed recurring tasks. */}
        <select value={tpl.block} disabled={!!tpl.start} title={tpl.start ? tx('Set by the start time', 'تحددها ساعة البداية') : undefined}
          onChange={(e) => onChange({ block: e.target.value })}>{BLOCKS.map((b) => <option key={b.id} value={b.id}>{bName(b)}</option>)}</select>
        <input className="time-input" type="time" value={tpl.start || ''} onChange={(e) => onChange({ start: e.target.value, time: '' })} title={tx('Start (optional)', 'البداية (اختياري)')} />
        <input className="time-input" type="time" value={tpl.end || ''} onChange={(e) => onChange({ end: e.target.value, time: '' })} title={tx('End (optional)', 'النهاية (اختياري)')} />
        <select value={tpl.projectId || ''} onChange={(e) => onChange({ projectId: e.target.value || null })}><option value="">{tx('no label', 'بلا وسم')}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        {/* Recurring work belongs to a project as much as anything else does —
            and more so, since it is the work that repeats. Carried onto every
            task added from here, so a weekly chore lands under its project
            without being filed by hand each time. */}
        <select value={tpl.projectRef || ''} onChange={(e) => onChange({ projectRef: e.target.value || null })}>
          <option value="">{tx('no project', 'بلا مشروع')}</option>
          {allProjects.filter((p) => !p.completedAt).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {/* Handed to every task this adds, like the label and project. A start
          and an end already fix the length, so the box only matters without. */}
      <DurationInput item={tpl} compact onChange={(v) => onChange({ duration: v })} />
      {/* When it is actually due. "Plan the day" offers a recurring task only
          on the days its schedule names — a weekly chore offered seven times a
          week is how a person learns to press Skip without reading. */}
      <div className="routine-repeat">
        <span className="routine-rep-h"><Repeat size={12} /> {tx('Due', 'تتكرر')}</span>
        <div className="seg">
          {[[DAILY, tx('Every day', 'كل يوم')], [WEEKLY, tx('Weekly', 'أسبوعيًا')], [MONTHLY, tx('Monthly', 'شهريًا')]].map(([id, label]) => (
            <button key={id} className={rep.every === id ? 'on' : ''} onClick={() => setRep({ every: id })}>{label}</button>
          ))}
        </div>
        {rep.every === WEEKLY && (
          <div className="routine-days">
            {weekdayFullList().map((name, i) => (
              <button key={i} className={`rday ${rep.days.includes(i) ? 'on' : ''}`} onClick={() => setRep({ days: toggleIn(rep.days, i) })}
                title={name} aria-pressed={rep.days.includes(i)}>{wd(i)}</button>
            ))}
          </div>
        )}
        {rep.every === MONTHLY && (
          <div className="routine-dates">
            {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
              <button key={n} className={`rdate ${rep.dates.includes(n) ? 'on' : ''}`} onClick={() => setRep({ dates: toggleIn(rep.dates, n) })}
                aria-pressed={rep.dates.includes(n)}>{n}</button>
            ))}
          </div>
        )}
        {rep.every !== DAILY && (
          <p className="hint-text" style={{ margin: '4px 0 0' }}>
            {(rep.every === WEEKLY ? rep.days.length : rep.dates.length) === 0
              ? tx('Nothing picked yet — it stays due every day until you choose.', 'لم تختر شيئًا بعد — تبقى مستحقة كل يوم حتى تختار.')
              : rep.every === MONTHLY && rep.dates.some((n) => n > 28)
                ? tx('A date past the end of a short month lands on its last day.', 'التاريخ الذي يتجاوز نهاية شهر قصير يقع في آخر يوم منه.')
                : tx('Offered when you plan one of these days.', 'تُعرض عند تخطيط أحد هذه الأيام.')}
          </p>
        )}
        {/* Off by default: most recurring tasks are a menu to plan from, and a
            planner that fills your day on its own is one you stop trusting.
            On, it is added once, on the morning its day comes up. */}
        <label className="toggle routine-auto">
          <input type="checkbox" checked={!!tpl.autoAdd} onChange={(e) => onChange({ autoAdd: e.target.checked })} />
          <span>{tx('Add it to my day automatically when it is due', 'أضفها إلى يومي تلقائيًا في يوم استحقاقها')}</span>
        </label>
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
