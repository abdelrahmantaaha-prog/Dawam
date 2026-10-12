/* ------------------------------------------------------------------ */
/*  Focus — the desktop half of Rhythm, the app formerly called Anchor. */
/*                                                                      */
/*  Everything here talks to the Electron shell through the one bridge   */
/*  the preload installs. On the web and inside the Android shell that   */
/*  bridge is absent, `desktopFocus()` returns null, and the whole view  */
/*  and its nav button are never rendered — no dead buttons in a build   */
/*  that cannot honour them.                                            */
/*                                                                      */
/*  The seam with the planner is the point of the merge: a round is      */
/*  started FROM a planned task and carries its id, so when the round    */
/*  ends the planner can offer to tick that task off and learn what it   */
/*  really took. Time measured beating time guessed is the whole reason  */
/*  these two apps are now one.                                         */
/* ------------------------------------------------------------------ */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Play, Pause, Square, SkipForward, Timer, ShieldCheck, AlertTriangle, Check, X, Trash2, Save, Settings as SettingsIcon, Flame, Eye, Plus, RefreshCw, Globe, AppWindow, FolderOpen } from 'lucide-react';
import { tx, fmtTime } from './core.jsx';
import { fmtFocus } from './projectfocus.js';
import { modeKey } from './focusmode.js';

export const desktopFocus = () => (typeof window !== 'undefined' && window.rhythmFocus) || null;
export const isDesktop = () => !!desktopFocus();

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const asMin = (sec) => Math.round((Number(sec) || 0) / 60);
const listToText = (a) => (Array.isArray(a) ? a.join('\n') : '');
const textToList = (s) => String(s || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

/* ------------------------------------------------------------------ */
/*  Bubble items, as the planner holds them.                           */
/*                                                                     */
/*  The shell (desktop/src/bubble.js) is the authority on what an item  */
/*  lets through; the planner only needs to show items, add to a list   */
/*  without doubles, and read the words a bubble saved before bubbles   */
/*  existed. An item is { kind: 'app', exe, name, icon } or             */
/*  { kind: 'site', domain, name } or { kind: 'word', text }.           */
/* ------------------------------------------------------------------ */
const BROWSER_EXES = ['chrome', 'msedge', 'brave', 'firefox', 'opera', 'vivaldi', 'arc', 'zen', 'iron', 'librewolf'];
const exeBase = (p) => String(p || '').toLowerCase().split(/[\\/]/).pop().replace(/\.exe$/, '');
export const itemKey = (it) => (it.kind === 'app' ? `app:${exeBase(it.exe)}` : it.kind === 'site' ? `site:${it.domain}` : `word:${it.text}`);
export const isBrowserItem = (it) => it.kind === 'app' && BROWSER_EXES.includes(exeBase(it.exe));
export function mergeItems(list, more) {
  const out = [...(list || [])];
  const seen = new Set(out.map(itemKey));
  for (const it of more || []) {
    if (!it || seen.has(itemKey(it))) continue;
    seen.add(itemKey(it));
    out.push(it);
  }
  return out;
}
// A bubble saved before bubbles holds only words.
export const itemsOf = (tpl) => (tpl && Array.isArray(tpl.items) ? tpl.items
  : ((tpl && tpl.allowed) || []).map((w) => ({ kind: 'word', text: String(w).toLowerCase() })));
const wordsOf = (items) => (items || []).map((it) => (it.kind === 'app' ? exeBase(it.exe) : it.kind === 'site' ? it.domain : it.text));
const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

/* Live session state + the store's data, kept in step with the main process.
   Every listener the bridge hands out returns its own unsubscribe, so a
   re-render never stacks a second copy of the same handler. */
export function useFocus() {
  const api = desktopFocus();
  const [state, setState] = useState(null);
  const [data, setData] = useState(null);

  const reload = useCallback(async () => {
    if (!api) return;
    try { setData(await api.getData()); } catch { /* shell went away */ }
  }, [api]);

  useEffect(() => {
    if (!api) return undefined;
    let alive = true;
    (async () => {
      try {
        const [s, d] = await Promise.all([api.getState(), api.getData()]);
        if (!alive) return;
        setState(s); setData(d);
      } catch { /* shell went away */ }
    })();
    const offState = api.onState((s) => setState(s));
    const offData = api.onDataChanged(reload);
    const offHist = api.onHistoryChanged(reload);
    return () => { alive = false; offState?.(); offData?.(); offHist?.(); };
  }, [api, reload]);

  return { api, state, data, reload };
}

/* Is a round running right now?
 *
 * Deliberately thinner than useFocus: the planner does not want the store, the
 * history or the templates, only the one bit that says work is under way. The
 * Now lock reads this — locking someone out mid-round would be the app
 * interrupting the exact behaviour it exists to produce.
 *
 * A break counts as running. It is part of the round, and standing up for five
 * minutes is not the same as having stopped. */
export function useFocusLive() {
  const api = desktopFocus();
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!api) return undefined;
    let alive = true;
    api.getState().then((s) => { if (alive) setLive(!!s && s.phase !== 'idle'); }).catch(() => {});
    const off = api.onState((s) => setLive(!!s && s.phase !== 'idle'));
    return () => { alive = false; off && off(); };
  }, [api]);
  return live;
}

/* Which planned task the running round is for, or null. The time lock lifts
   only for a round on the task whose time it is, so "a round is running" is
   not enough — it has to know which one. A break keeps the task. */
export function useFocusTaskId() {
  const api = desktopFocus();
  const [taskId, setTaskId] = useState(null);
  useEffect(() => {
    if (!api) return undefined;
    let alive = true;
    const read = (s) => (s && s.phase !== 'idle' ? s.taskId || null : null);
    api.getState().then((s) => { if (alive) setTaskId(read(s)); }).catch(() => {});
    const off = api.onState((s) => setTaskId(read(s)));
    return () => { alive = false; off && off(); };
  }, [api]);
  return taskId;
}

/* The planner listens for finished rounds wherever it is — that is what lets
   App switch to this view and ask the question at the moment it matters. */
export function useRoundEnded(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const api = desktopFocus();
    if (!api) return undefined;
    return api.onRoundEnded((entry) => ref.current && ref.current(entry));
  }, []);
}

/* ------------------------------------------------------------------ */
/*  The view                                                           */
/* ------------------------------------------------------------------ */
export function FocusView({ tasks = [], projects = [], rewards = [], balance = 0, durationFor, pendingRound, onDismissRound, onMarkTaskDone, onLearnDuration, onRememberMode, dayISO, tallyProjects }) {
  const { api, state, data, reload } = useFocus();
  const [tab, setTab] = useState('focus'); // focus | history | settings
  const [taskId, setTaskId] = useState('');
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState(50);
  // What is inside this round's bubble: apps, sites, and words.
  const [items, setItems] = useState([]);
  /* Where the minutes go. Picking a task fills it from the task's project (or
     its tag's); a round on a typed title can name one by hand; a rest round
     has none. */
  const [projectId, setProjectId] = useState('');
  const [saveTpl, setSaveTpl] = useState(false);
  /* The applied policy, separate from the task. A template used to BE a task —
     picking one renamed whatever you were doing — which meant a set of
     restrictions could only ever belong to one piece of work. */
  const [tplId, setTplId] = useState('');
  const [tplName, setTplName] = useState('');
  /* Whether the applied mode was loaded from the picked task (remembered for
     it, its tag or its project) rather than chosen here. A loaded mode goes
     away again when a task with none is picked; a chosen one stays put. */
  const [tplAuto, setTplAuto] = useState(false);
  // Remember the applied mode for this task / its tag / its project on start.
  const [remember, setRemember] = useState('');

  const settings = data?.settings || null;
  const templates = data?.templates || [];
  const history = data?.history || [];
  const live = state && state.phase !== 'idle';
  // The logical day a round belongs to — Fajr to Fajr, like the rest of the
  // planner — falling back to the calendar day when the planner did not say.
  const dayOf = dayISO || ((ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  const todayISO = dayOf(Date.now());
  const todayMin = history.filter((h) => dayOf(h.endedAt) === todayISO).reduce((n, h) => n + asMin(h.focusedSec), 0);
  const picked = tasks.find((t) => t.id === taskId) || null;
  // Only a planned task can remember a mode — not a meeting, not a rest.
  const canRemember = !!picked && !String(picked.id).startsWith('cal:');
  const pickedMode = (picked && picked.mode && picked.mode.id) || '';

  // Picking a planned task fills in everything the planner already knows about
  // it: the title, and a duration from its own slot or from what past rounds
  // taught us. Nothing here is a guess the person cannot overrule.
  const pickTask = (t) => {
    setTaskId(t.id);
    setTitle(t.title);
    setProjectId(t.project || '');
    setRemember('');
    const known = (t.minutes || null) || (durationFor ? durationFor(t.title) : null);
    /* A mode remembered for this task (or its tag, or its project) loads with
       it. Otherwise the allow list is the policy's, not the task's, so a mode
       chosen by hand stays exactly where it is — only one this page loaded
       for the previous task is lifted. */
    const tpl = t.mode ? templates.find((x) => modeKey(x.id) === t.mode.id) : null;
    if (tpl) {
      setTplId(tpl.id); setTplName(tpl.name); setItems(itemsOf(tpl)); setTplAuto(true);
    } else if (tplAuto) {
      setTplId(''); setItems([]); setTplAuto(false);
    }
    // The task's own length beats the mode's: a 20-minute task under a
    // 90-minute mode is still a 20-minute task.
    setMinutes(clamp(Number(known) || (tpl && Number(tpl.workMin)) || settings?.workMin || 50, 1, 240));
  };

  const useTemplate = (tpl) => {
    setTplAuto(false);
    if (tplId === tpl.id) { setTplId(''); setItems([]); return; }  // tap again to lift it
    setTplId(tpl.id);
    setTplName(tpl.name);
    setMinutes(clamp(Number(tpl.workMin) || 50, 1, 240));
    setItems(itemsOf(tpl));
  };

  useEffect(() => {
    if (settings && !live && !title) setMinutes(clamp(Number(settings.workMin) || 50, 1, 240));
  }, [settings, live, title]);

  const start = async () => {
    const task = title.trim();
    if (!task) return;
    const allowed = wordsOf(items);
    let useId = tplId || null;
    if (saveTpl) {
      const name = (tplName.trim() || task).trim();
      const list = await api.saveTemplate({ id: tplId || null, name, workMin: minutes, items, allowed });
      const saved = (list || []).find((t) => String(t.name).toLowerCase() === name.toLowerCase());
      if (saved) useId = saved.id;
    }
    // A reward's id is not a task id. Passing it on would have the planner
    // hunting for a task that does not exist when the round ends, and offering
    // to tick off nothing.
    const realTask = taskId && !String(taskId).startsWith('reward:') ? taskId : null;
    const resting = String(taskId || '').startsWith('reward:');
    const pid = !resting && projects.some((p) => p.id === projectId) ? projectId : null;
    await api.startWork({ task, workMin: minutes, items, allowed, taskId: realTask, templateId: useId, projectId: pid });
    if (remember && canRemember && onRememberMode) {
      onRememberMode({ kind: remember, task: picked, modeId: useId == null ? null : modeKey(useId) });
      setRemember('');
    }
    reload();
  };

  if (!api) return null;

  return (
    <div className="view focus-view">
      <div className="focus-tabs">
        <button className={tab === 'focus' ? 'on' : ''} onClick={() => setTab('focus')}><Timer size={15} /> {tx('Bubbles', 'الفقاعات')}</button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}><Flame size={15} /> {tx('Tally', 'الحصيلة')}</button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}><SettingsIcon size={15} /> {tx('Bubble settings', 'إعدادات الفقاعات')}</button>
      </div>

      {pendingRound && (
        <RoundEndedCard
          entry={pendingRound}
          onDismiss={onDismissRound}
          onMarkDone={onMarkTaskDone}
          onLearn={onLearnDuration}
        />
      )}

      {/* Today's number, always in view: the tally tab has the rest. */}
      {tab === 'focus' && (
        <button className="focus-todaybar" onClick={() => setTab('history')}>
          <Flame size={13} /> {tx('Today', 'اليوم')} <strong>{fmtFocus(todayMin)}</strong> {tx('focused', 'تركيز')}
          <span className="focus-todaybar-more">{tx('Every day →', 'كل يوم ←')}</span>
        </button>
      )}

      {tab === 'focus' && (live
        ? <LiveSession api={api} state={state} projects={projects} templates={templates} reload={reload} />
        : (
          <div className="focus-card">
            <h3 className="focus-h">{tx('Start a round', 'ابدأ جولة')}</h3>

            {tasks.length > 0 && (
              <>
                <p className="hint-text">{tx("Today's tasks — a round started here counts towards the task itself.", 'مهام اليوم — الجولة التي تبدأ من هنا تُحسب للمهمة نفسها.')}</p>
                <div className="focus-tasklist">
                  {tasks.map((t) => (
                    <button key={t.id} className={`focus-taskbtn ${taskId === t.id ? 'on' : ''}`} onClick={() => pickTask(t)}>
                      <span className="focus-taskname">{t.title}</span>
                      {t.minutes ? <span className="ttime">{t.minutes}m</span> : null}
                      {t.when ? <span className="ttime">{t.when}</span> : null}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Resting is a thing you can be doing.

                The lock screen has no step-out any more, and that is only fair
                if "I am going to rest for twenty minutes" is an answer it
                accepts. It is: a reward starts a real round, with its own
                clock and its own end, so the rest is bounded the same way the
                work is. That is the difference between resting and drifting,
                and it is the entire reason this list is here rather than a
                button that simply unlocks the machine.

                Nothing is charged. Cashing a reward in is a deliberate act on
                the points page; taking a break is not a purchase, and making
                every rest cost something would only teach you not to rest. */}
            {rewards.length > 0 && (
              <>
                <p className="hint-text focus-rest-h">{tx('Or rest, on the clock — a round with an end, not a drift.', 'أو استرِح بتوقيت — جولة لها نهاية، لا انجراف.')}</p>
                <div className="focus-tasklist focus-rewardlist">
                  {rewards.map((r) => (
                    <button key={r.id} className={`focus-taskbtn reward ${taskId === `reward:${r.id}` ? 'on' : ''}`}
                      onClick={() => { setTaskId(`reward:${r.id}`); setTitle(r.name); setProjectId(''); setMinutes(clamp(Number(r.minutes) || 20, 1, 240)); }}>
                      <span className="focus-taskname">{r.name}</span>
                      {Number(r.cost) > 0 && Number(r.cost) <= balance ? <span className="ttime focus-afford">{tx('earned', 'مستحقة')}</span> : null}
                    </button>
                  ))}
                </div>
              </>
            )}

            <label className="field">
              <span>{tx('Task', 'المهمة')}</span>
              <input value={title} onChange={(e) => { setTitle(e.target.value); setTaskId(''); }}
                placeholder={tx('What are you working on?', 'على ماذا تعمل؟')} />
            </label>

            {projects.length > 0 && !String(taskId || '').startsWith('reward:') && (
              <label className="field">
                <span>{tx('Counts towards', 'تُحسب لصالح')}</span>
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">{tx('— no project —', '— بلا مشروع —')}</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}

            <div className="focus-row">
              <label className="field">
                <span>{tx('Minutes', 'دقائق')}</span>
                <input type="number" min="1" max="240" value={minutes}
                  onChange={(e) => setMinutes(clamp(Number(e.target.value) || 1, 1, 240))} />
              </label>
              <div className="focus-presets">
                {[25, 50, 90].map((m) => (
                  <button key={m} className={`ghost sm ${minutes === m ? 'on' : ''}`} onClick={() => setMinutes(m)}>{m}m</button>
                ))}
              </div>
            </div>

            {/* Your bubbles, first: picking one fills the board below. */}
            {templates.length > 0 && (
              <div className="bubble-picks">
                <span className="bubble-picks-label">{tx('Your bubbles', 'فقاعاتك')}</span>
                {templates.map((tpl) => {
                  const its = itemsOf(tpl);
                  return (
                    <span key={tpl.id} className={`bubble-pick${tplId === tpl.id ? ' on' : ''}`}>
                      <button className="bubble-pick-name" onClick={() => useTemplate(tpl)} title={tx('Tap again to lift it', 'انقر مرة أخرى لرفعها')}>
                        <span className="bubble-pick-dots">{its.filter((i) => i.kind !== 'word').slice(0, 4).map((i) => (
                          i.icon ? <img key={itemKey(i)} src={i.icon} alt="" /> : <span key={itemKey(i)} style={{ background: `hsl(${hue(i.domain || i.name || i.text)} 45% 42%)` }} />
                        ))}</span>
                        {tpl.name}
                        <span className="ttime">{tpl.workMin}m</span>
                      </button>
                      <button className="bubble-pick-del" onClick={async () => { if (tplId === tpl.id) { setTplId(''); setItems([]); } await api.deleteTemplate(tpl.id); reload(); }}
                        aria-label={tx('Delete bubble', 'حذف الفقاعة')}><Trash2 size={12} /></button>
                    </span>
                  );
                })}
              </div>
            )}

            <BubbleBoard api={api} items={items} onChange={setItems}
              title={tplId ? `${tx('Inside', 'داخل')} “${tplName}”` : tx('Inside this bubble', 'داخل هذه الفقاعة')} />
            {tplAuto && tplId && picked && picked.mode && (
              <p className="hint-text focus-modeauto">
                {tx(`“${tplName}” loaded — remembered for this ${picked.mode.from === 'task' ? 'task' : picked.mode.from === 'tag' ? 'tag' : 'project'}. Pick another bubble or tap it to lift it for this round.`,
                  `حُمّلت «${tplName}» — محفوظة لهذه ${picked.mode.from === 'task' ? 'المهمة' : picked.mode.from === 'tag' ? 'الوسم' : 'المشروع'}. اختر فقاعة أخرى أو انقر عليها لرفعها في هذه الجولة.`)}
              </p>
            )}

            {/* Remember the mode, so this task loads it by itself next time.
                Shown only when there is something to remember — a mode is
                applied or about to be saved — or to forget. */}
            {canRemember && !tplAuto && (tplId || saveTpl || pickedMode) && (
              <label className="field focus-remember">
                <span>{tplId || saveTpl ? tx('Load this bubble automatically for', 'حمّل هذه الفقاعة تلقائيًا لـ') : tx('Stop loading a bubble for', 'أوقف تحميل فقاعة لـ')}</span>
                <select value={remember} onChange={(e) => setRemember(e.target.value)}>
                  <option value="">{tx('— just this round —', '— هذه الجولة فقط —')}</option>
                  <option value="task">{tx('this task', 'هذه المهمة')} · {picked.title}</option>
                  {picked.labelId && <option value="tag">{tx('every task tagged', 'كل مهمة بوسم')} #{picked.labelName}</option>}
                  {picked.project && <option value="project">{tx('every task in', 'كل مهمة في')} {picked.projectName}</option>}
                </select>
              </label>
            )}

            <label className="check">
              <input type="checkbox" checked={saveTpl} onChange={(e) => { setSaveTpl(e.target.checked); if (e.target.checked && !tplName) setTplName(title.trim()); }} />
              <span>{tplId ? tx('Update this bubble', 'حدّث هذه الفقاعة') : tx('Save this as a bubble', 'احفظها فقاعة')}</span>
            </label>
            {saveTpl && (
              <label className="field">
                <span>{tx('Name it', 'سمِّها')}</span>
                <input value={tplName} onChange={(e) => setTplName(e.target.value)}
                  placeholder={tx('Deep work, Admin, Reading…', 'عمل عميق، إداري، قراءة…')} />
                <span className="hint-text">{tx('A bubble is a place, not a task — you can use it with any task.', 'الفقاعة مكان لا مهمة — يمكنك استخدامها مع أي مهمة.')}</span>
              </label>
            )}

            <button className="primary focus-block" onClick={start} disabled={!title.trim()}>
              <Play size={16} /> {items.length ? tx('Enter the bubble', 'ادخل الفقاعة') : tx('Start focusing', 'ابدأ التركيز')}
            </button>
          </div>
        ))}

      {tab === 'history' && <FocusTally history={history} projects={tallyProjects || projects} dayOf={dayOf} />}
      {tab === 'settings' && settings && <FocusSettings api={api} settings={settings} templates={templates} onSaved={reload} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Live session — the same numbers the overlay shows, with room to     */
/*  show the window that is currently being judged.                     */
/* ------------------------------------------------------------------ */
function LiveSession({ api, state, projects = [], templates = [], reload }) {
  const s = state;
  const breakPhase = s.phase === 'break';
  const cls = breakPhase ? 'break' : s.paused ? 'paused' : 'working';
  const pct = s.totalSec ? clamp(1 - s.remainingSec / s.totalSec, 0, 1) : 0;

  return (
    <div className={`focus-card focus-live ${cls}`}>
      <span className="focus-phase">
        {breakPhase ? tx('Break', 'استراحة') : s.paused ? tx('Paused', 'موقوف') : tx('Focusing', 'تركيز')}
        {!breakPhase && s.strict ? <span className="focus-strict"><ShieldCheck size={12} /> {s.bubbleName ? `${tx('bubble', 'فقاعة')} · ${s.bubbleName}` : tx('bubble', 'فقاعة')}</span> : null}
      </span>
      <h3 className="focus-task">{breakPhase ? tx('Stand up. Walk. Hydrate.', 'قف. امشِ. اشرب ماء.') : s.task}</h3>
      {!breakPhase && s.projectId && (() => {
        const p = projects.find((x) => x.id === s.projectId);
        return p ? <span className="focus-proj" style={{ '--pcolor': p.color }}><span className="focus-byproj-dot" />{p.name}</span> : null;
      })()}
      <div className="focus-clock">{mmss(s.remainingSec)}</div>
      <div className="focus-bar"><span style={{ width: `${pct * 100}%` }} /></div>

      {!breakPhase && (
        <div className="focus-stats">
          <span>{tx('Round', 'جولة')} {s.rounds + 1}</span>
          {s.strict ? <span>{tx('Blocked', 'حُظر')} {s.blockedCount || 0}×</span> : <span>{tx('Nothing blocked', 'لا حظر')}</span>}
        </div>
      )}

      {!breakPhase && s.current?.title && (
        <p className="hint-text focus-current">{tx('In front of you:', 'أمامك:')} {s.current.title}</p>
      )}

      {/* The bubble's own dock, the same one the wall shows: one tap opens
          the app (or brings it forward) or the site. */}
      {!breakPhase && s.strict && <LiveDock api={api} state={s} />}
      {!breakPhase && s.strict && <LiveAdd api={api} state={s} templates={templates} reload={reload} />}

      <div className="focus-actions">
        {breakPhase ? (
          <button className="ghost" onClick={() => api.skipBreak()}><SkipForward size={15} /> {tx('End break', 'إنهاء الاستراحة')}</button>
        ) : (
          <button className="ghost" onClick={() => (s.paused ? api.resume() : api.pause())}>
            {s.paused ? <><Play size={15} /> {tx('Resume', 'استئناف')}</> : <><Pause size={15} /> {tx('Pause', 'إيقاف')}</>}
          </button>
        )}
        <button className="ghost danger" onClick={() => api.stop()}><Square size={14} /> {tx('Stop', 'إنهاء')}</button>
      </div>
    </div>
  );
}

function LiveDock({ api, state }) {
  const [items, setItems] = useState([]);
  const key = JSON.stringify((state.items || []).map(itemKey));
  useEffect(() => {
    let alive = true;
    api.bubble.items().then((full) => { if (alive) setItems(full && full.length ? full : state.items || []); }).catch(() => {});
    return () => { alive = false; };
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Apps get tiles; the sites share one Browser tile and are listed under it.
  const apps = items.filter((i) => i.kind === 'app');
  const sites = items.filter((i) => i.kind === 'site');
  if (!apps.length && !sites.length) return null;
  return (
    <>
      <div className="bubble-tiles live">
        {apps.map((it) => <BubbleTile key={itemKey(it)} item={it} onOpen={() => api.bubble.open(it)} />)}
        <button className="bubble-tile" onClick={() => api.bubble.openBrowserHome()}>
          <span className="bubble-ico letter" style={{ '--h': 155 }}><Globe size={18} /></span>
          <span className="bubble-name">{tx('Browser', 'المتصفح')}</span>
          <span className="bubble-sub">{sites.length ? tx(`${sites.length} sites`, `${sites.length} مواقع`) : tx('open to work', 'افتحه للعمل')}</span>
        </button>
      </div>
      {sites.length > 0 && (
        <div className="bubble-site-row">
          {sites.map((it) => (
            <button key={itemKey(it)} className="bubble-chip" onClick={() => api.bubble.open(it)} title={it.domain}>
              {it.name && it.name !== it.domain ? it.name : it.domain}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Branching out: letting a site into the running bubble.             */
/*                                                                     */
/*  Research does not stay inside the list it started with. A site can  */
/*  be let in here (or from the "not in this bubble" page in either     */
/*  browser) for the rest of the round; the saved bubble only changes   */
/*  if you say so. What was let in is shown, and kept on the round's    */
/*  history, so a round that kept widening is honest about it.          */
/* ------------------------------------------------------------------ */
function LiveAdd({ api, state, templates, reload }) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [kept, setKept] = useState(false);
  const added = (state.added || []).filter((it) => it.kind === 'site');
  const tpl = state.templateId != null ? templates.find((t) => t.id === state.templateId) : null;
  const unsaved = tpl ? added.filter((it) => !itemsOf(tpl).some((x) => itemKey(x) === itemKey(it))) : [];

  const add = async (e) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    const site = await api.bubble.addSite(v);
    if (site) { setText(''); setNote(''); setKept(false); }
    else setNote(tx('That is not a site — type an address like arxiv.org.', 'هذا ليس موقعًا — اكتب عنوانًا مثل arxiv.org.'));
  };

  const keep = async () => {
    await api.saveTemplate({ id: tpl.id, name: tpl.name, workMin: tpl.workMin, items: mergeItems(itemsOf(tpl), unsaved) });
    setKept(true);
    if (reload) reload();
  };

  return (
    <div className="bubble-live-add">
      <form className="bubble-type" onSubmit={add}>
        <input value={text} onChange={(e) => setText(e.target.value)}
          placeholder={tx('Branching out? Let a site in for this round', 'تتفرّع؟ أدخل موقعًا لهذه الجولة')} />
        <button className="ghost sm" type="submit" disabled={!text.trim()}><Plus size={14} /> {tx('Let in', 'أدخِل')}</button>
      </form>
      {note && <p className="hint-text bubble-note">{note}</p>}
      {added.length > 0 && (
        <p className="hint-text bubble-added">
          {tx('Let in this round:', 'أُدخل في هذه الجولة:')} {added.map((it) => it.domain).join(', ')}
          {tpl && unsaved.length > 0 && !kept && (
            <button className="ghost sm" onClick={keep}>{tx(`Keep in “${tpl.name}”`, `احفظها في «${tpl.name}»`)}</button>
          )}
          {kept && <span className="focus-applied"> {tx('kept', 'حُفظت')}</span>}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  One item, as a tile                                                */
/* ------------------------------------------------------------------ */
function BubbleTile({ item, onOpen, onRemove }) {
  const label = item.kind === 'site' ? item.domain : item.kind === 'word' ? tx('keyword', 'كلمة') : isBrowserItem(item) ? tx('any site', 'أي موقع') : tx('app', 'تطبيق');
  const name = item.kind === 'word' ? `“${item.text}”` : (item.name || item.domain);
  const Tag = onOpen ? 'button' : 'div';
  return (
    <Tag className={`bubble-tile ${item.kind}${isBrowserItem(item) ? ' wide-open' : ''}`} onClick={onOpen}
      title={item.kind === 'app' ? item.exe : item.kind === 'site' ? item.domain : item.text}>
      {item.icon
        ? <img className="bubble-ico" src={item.icon} alt="" />
        : <span className="bubble-ico letter" style={{ '--h': hue(item.domain || item.name || item.text) }}>
          {item.kind === 'word' ? '“' : String(name).replace(/^“/, '').charAt(0).toUpperCase()}
        </span>}
      <span className="bubble-name">{name}</span>
      <span className="bubble-sub">{label}</span>
      {onRemove && (
        <button className="bubble-x" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label={tx('Take it out', 'أخرجه')}><X size={12} /></button>
      )}
    </Tag>
  );
}

/* ------------------------------------------------------------------ */
/*  The board: what is inside the bubble, and how things get in.        */
/*                                                                     */
/*  Four ways in, all ending in the same tiles:                        */
/*   - drop a program or its shortcut (from the desktop, Explorer, the */
/*     Start menu's folder) — it is followed to the program it runs;    */
/*   - drop a link (from a browser's address bar or any page) — the    */
/*     site is what goes in, not the one page;                          */
/*   - drag (or tap) one of the windows open right now;                */
/*   - type a site, or a keyword the way focus modes used to work.      */
/* ------------------------------------------------------------------ */
const DRAG_TYPE = 'application/x-rhythm-item';

function BubbleBoard({ api, items, onChange, title }) {
  const [over, setOver] = useState(false);
  const [note, setNote] = useState('');
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState(null);       // the windows open now, once asked for
  const [loadingOpen, setLoadingOpen] = useState(false);

  const add = (more) => { if (more && more.length) onChange(mergeItems(items, more)); };
  const remove = (it) => onChange(items.filter((x) => itemKey(x) !== itemKey(it)));

  const loadOpen = async () => {
    setLoadingOpen(true);
    try { setOpen(await api.bubble.running()); } catch { setOpen([]); }
    setLoadingOpen(false);
  };

  const onDrop = async (e) => {
    e.preventDefault();
    setOver(false);
    setNote('');
    const dt = e.dataTransfer;
    const inner = dt.getData(DRAG_TYPE);
    if (inner) { try { add([JSON.parse(inner)]); } catch { /* not ours after all */ } return; }
    const files = [...(dt.files || [])];
    if (files.length) {
      const paths = files.map((f) => api.bubble.pathFor(f)).filter(Boolean);
      const { items: got = [], skipped = [] } = (await api.bubble.resolvePaths(paths)) || {};
      add(got);
      if (skipped.length) setNote(tx(`Not a program or a link: ${skipped.join(', ')}`, `ليس برنامجًا ولا رابطًا: ${skipped.join('، ')}`));
      return;
    }
    const text = dt.getData('text/uri-list') || dt.getData('text/plain');
    const site = text ? await api.bubble.resolveUrl(text) : null;
    if (site) add([site]);
    else setNote(tx('That did not carry a program or a site.', 'لم يحمل ذلك برنامجًا ولا موقعًا.'));
  };

  const addTyped = async (e) => {
    e.preventDefault();
    const v = typed.trim();
    if (!v) return;
    const site = /[./:]/.test(v) ? await api.bubble.resolveUrl(v) : null;
    add([site || { kind: 'word', text: v.toLowerCase() }]);
    setTyped('');
  };

  const shownOpen = (open || []).filter((w) => !items.some((it) => itemKey(it) === itemKey(w)));
  const wideOpen = items.filter(isBrowserItem);

  return (
    <div className="bubble-board">
      <div className="bubble-board-head">
        <span>{title}</span>
        <span className="hint-text">{items.length ? tx(`${items.length} inside`, `${items.length} في الداخل`) : ''}</span>
      </div>

      <div className={`bubble-drop${over ? ' over' : ''}${items.length ? '' : ' empty'}`}
        onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
        onDrop={onDrop}>
        {items.length
          ? <div className="bubble-tiles">{items.map((it) => <BubbleTile key={itemKey(it)} item={it} onRemove={() => remove(it)} />)}</div>
          : <p className="bubble-drop-hint">
            {tx('Drop apps and links here — a program or its shortcut from the desktop or Explorer, a link from your browser’s address bar — or drag in one of the windows open now.',
              'أفلت التطبيقات والروابط هنا — برنامجًا أو اختصاره من سطح المكتب أو المستكشف، أو رابطًا من شريط عنوان المتصفح — أو اسحب إحدى النوافذ المفتوحة الآن.')}
          </p>}
      </div>

      <form className="bubble-type" onSubmit={addTyped}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)}
          placeholder={tx('Or type a site (docs.google.com) or a keyword', 'أو اكتب موقعًا (docs.google.com) أو كلمة')} />
        <button className="ghost sm" type="submit" disabled={!typed.trim()}><Plus size={14} /> {tx('Add', 'أضف')}</button>
      </form>

      <div className="bubble-open">
        <button className="ghost sm" onClick={loadOpen} disabled={loadingOpen}>
          {open ? <RefreshCw size={13} className={loadingOpen ? 'spin' : ''} /> : <AppWindow size={13} />}
          {' '}{open ? tx('Open now', 'المفتوح الآن') : tx('Show the windows open now', 'اعرض النوافذ المفتوحة الآن')}
        </button>
        {open && (
          <div className="bubble-palette">
            {shownOpen.length === 0 && <span className="hint-text">{tx('Nothing else open.', 'لا شيء آخر مفتوح.')}</span>}
            {shownOpen.map((w) => (
              <button key={itemKey(w)} className={`bubble-chip${w.browser ? ' browser' : ''}`} draggable
                onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(w)); e.dataTransfer.effectAllowed = 'copy'; }}
                onClick={() => add([w])}
                title={w.browser ? tx('A browser as an app lets in every site. Drop sites instead to allow only those.', 'المتصفح كتطبيق يسمح بكل المواقع. أفلت مواقع بدلًا منه لتسمح بها وحدها.') : w.exe}>
                {w.icon ? <img src={w.icon} alt="" /> : <AppWindow size={14} />}
                <span>{w.name}</span>
                <Plus size={12} />
              </button>
            ))}
          </div>
        )}
      </div>

      {note && <p className="hint-text bubble-note">{note}</p>}
      {wideOpen.length > 0 && (
        <p className="hint-text bubble-warn"><AlertTriangle size={12} /> {tx(
          `${wideOpen.map((i) => i.name).join(', ')} is in as an app, so every site in it is open. To allow only some sites, take it out and drop the sites instead.`,
          `${wideOpen.map((i) => i.name).join('، ')} في الداخل كتطبيق، فكل المواقع فيه مفتوحة. لتسمح ببعض المواقع فقط، أخرجه وأفلت المواقع بدلًا منه.`)}</p>
      )}
      <p className="hint-text">
        {items.length
          ? tx('Only these can be in front of you. Anything else is put away the moment it comes forward, and the bubble’s wall covers the rest of the screen.',
            'هذه وحدها يمكن أن تكون أمامك. أي شيء آخر يُبعَد فور ظهوره، ويغطي جدار الفقاعة بقية الشاشة.')
          : tx('An empty bubble blocks nothing — the round is just a timer.', 'الفقاعة الفارغة لا تحظر شيئًا — الجولة مجرد مؤقّت.')}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  The question a finished round asks the planner                      */
/* ------------------------------------------------------------------ */
function RoundEndedCard({ entry, onDismiss, onMarkDone, onLearn }) {
  const focusedMin = Math.max(1, Math.round((entry.focusedSec || 0) / 60));
  const spentMin = Math.max(1, Math.round(((entry.focusedSec || 0) + (entry.distractedSec || 0)) / 60));
  return (
    <div className="focus-card focus-ended">
      <h3 className="focus-h">
        {entry.completed ? tx('Round complete', 'انتهت الجولة') : tx('Round stopped', 'أُوقفت الجولة')}
        {' — '}{entry.task}
      </h3>
      <p className="hint-text">
        {tx(`${focusedMin} min focused of ${spentMin} spent`, `${focusedMin} دقيقة تركيز من ${spentMin} دقيقة`)}
        {entry.blockedCount ? tx(` · ${entry.blockedCount} blocked`, ` · حُظر ${entry.blockedCount}`) : ''}
      </p>
      {entry.added && entry.added.length > 0 && (
        <p className="hint-text">{tx('Branched out to', 'تفرّعت إلى')} {entry.added.join(', ')}</p>
      )}
      <div className="focus-actions">
        {entry.taskId && (
          <button className="primary" onClick={() => { onMarkDone(entry.taskId, spentMin); onDismiss(); }}>
            <Check size={15} /> {tx('That finishes the task', 'انتهت المهمة')}
          </button>
        )}
        <button className="ghost" onClick={() => {
          // Not finished, but the time was still really spent on it — worth
          // knowing when the next slot for this task gets sized.
          if (onLearn) onLearn(entry.task, spentMin);
          onDismiss();
        }}>{tx('Not done yet', 'لم تنتهِ بعد')}</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  The tally — focus by project, day by day                           */
/*                                                                     */
/*  Projects down the side, the days of a week across, minutes in each  */
/*  cell. The numbers come from the projects themselves (project.focus,  */
/*  written by the planner when a round ends), so they reach back past   */
/*  the last 500 rounds the shell keeps and agree with the project       */
/*  cards. Days are the planner's Fajr-to-Fajr days: a round at 1am      */
/*  belongs to the evening before it, as everything else does.          */
/*                                                                     */
/*  Below the grid, the rounds of whichever day is picked — the old      */
/*  "Today" view, for any day.                                           */
/* ------------------------------------------------------------------ */
const isoAdd = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
const isoLabel = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  return { wd: t.toLocaleDateString(undefined, { weekday: 'short' }), n: d, full: t.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }) };
};

function FocusTally({ history, projects = [], dayOf }) {
  const todayISO = dayOf(Date.now());
  const [back, setBack] = useState(0);         // weeks back from this one
  const [sel, setSel] = useState(todayISO);    // the day whose rounds are listed
  const days = Array.from({ length: 7 }, (_, i) => isoAdd(todayISO, i - 6 - back * 7));
  const from = days[0], to = days[6];

  const cell = (p, iso) => Math.round(Number(((p && p.focus) || {})[iso]) || 0);
  const sum = (p, a, b) => Object.entries((p && p.focus) || {}).reduce((n, [iso, m]) => (iso >= a && iso <= b ? n + (Number(m) || 0) : n), 0);
  const all = (p) => Object.values((p && p.focus) || {}).reduce((n, m) => n + (Number(m) || 0), 0);
  // Every project that has ever had a minute, busiest this week first.
  const rows = projects.filter((p) => all(p) > 0).map((p) => ({ p, week: sum(p, from, to), total: all(p) }))
    .sort((a, b) => b.week - a.week || b.total - a.total);
  // Rounds that named no project still happened; they get their own row.
  const loose = (iso) => history.filter((h) => !h.projectId && dayOf(h.endedAt) === iso).reduce((n, h) => n + asMin(h.focusedSec), 0);
  const looseWeek = days.reduce((n, iso) => n + loose(iso), 0);
  const dayTotal = (iso) => rows.reduce((n, r) => n + cell(r.p, iso), 0) + loose(iso);
  const max = Math.max(1, ...rows.flatMap((r) => days.map((iso) => cell(r.p, iso))), ...days.map(loose));
  const heat = (m) => (m > 0 ? 0.12 + 0.55 * Math.min(1, m / max) : 0);

  const rounds = history.filter((h) => dayOf(h.endedAt) === sel);
  const focused = rounds.reduce((n, h) => n + (h.focusedSec || 0), 0);
  const blocked = rounds.reduce((n, h) => n + (h.blockedCount || 0), 0);
  const nameOf = (pid) => (projects.find((p) => p.id === pid) || {}).name || '';

  return (
    <div className="focus-card focus-tally">
      <div className="tally-head">
        <h3 className="focus-h">{tx('Focus by project', 'التركيز حسب المشروع')}</h3>
        <span className="tally-nav">
          <button className="ghost sm" onClick={() => setBack(back + 1)} aria-label={tx('Earlier week', 'أسبوع أسبق')}><ChevronLeft size={14} /></button>
          <span className="tally-range">{back === 0 ? tx('Last 7 days', 'آخر ٧ أيام') : `${isoLabel(from).n}–${isoLabel(to).n}`}</span>
          <button className="ghost sm" disabled={back === 0} onClick={() => setBack(Math.max(0, back - 1))} aria-label={tx('Later week', 'أسبوع لاحق')}><ChevronRight size={14} /></button>
        </span>
      </div>

      <div className="tally-scroll">
        <table className="tally-grid">
          <thead>
            <tr>
              <th className="tally-proj" />
              {days.map((iso) => {
                const l = isoLabel(iso);
                return (
                  <th key={iso} className={`${iso === todayISO ? 'today' : ''} ${iso === sel ? 'sel' : ''}`}>
                    <button onClick={() => setSel(iso)} title={l.full}><span>{l.wd}</span><strong>{l.n}</strong></button>
                  </th>
                );
              })}
              <th className="tally-sum">{tx('Week', 'الأسبوع')}</th>
              <th className="tally-sum">{tx('All', 'الكل')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, week, total }) => (
              <tr key={p.id} style={{ '--pcolor': p.color || 'var(--verdigris)' }}>
                <th className="tally-proj"><span className="focus-byproj-dot" />{p.name}</th>
                {days.map((iso) => {
                  const m = cell(p, iso);
                  return <td key={iso} className={iso === sel ? 'sel' : ''} style={{ '--heat': heat(m) }}>{m ? fmtFocus(m) : ''}</td>;
                })}
                <td className="tally-sum">{week ? fmtFocus(week) : '—'}</td>
                <td className="tally-sum">{fmtFocus(total)}</td>
              </tr>
            ))}
            {looseWeek > 0 && (
              <tr className="loose">
                <th className="tally-proj"><span className="focus-byproj-dot" />{tx('No project', 'بلا مشروع')}</th>
                {days.map((iso) => { const m = loose(iso); return <td key={iso} className={iso === sel ? 'sel' : ''} style={{ '--heat': heat(m) }}>{m ? fmtFocus(m) : ''}</td>; })}
                <td className="tally-sum">{fmtFocus(looseWeek)}</td>
                <td className="tally-sum" />
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th className="tally-proj">{tx('Day total', 'مجموع اليوم')}</th>
              {days.map((iso) => { const m = dayTotal(iso); return <td key={iso} className={iso === sel ? 'sel' : ''}>{m ? fmtFocus(m) : '·'}</td>; })}
              <td className="tally-sum">{fmtFocus(days.reduce((n, iso) => n + dayTotal(iso), 0))}</td>
              <td className="tally-sum" />
            </tr>
          </tfoot>
        </table>
      </div>
      {rows.length === 0 && looseWeek === 0 && (
        <p className="hint-text">{tx('No focus time yet. Rounds on a task count towards its project — or pick one under “Counts towards”.', 'لا وقت تركيز بعد. الجولات على مهمة تُحسب لمشروعها — أو اختر مشروعًا في «تُحسب لصالح».')}</p>
      )}

      <h4 className="focus-h4 tally-dayh">{sel === todayISO ? tx('Today', 'اليوم') : isoLabel(sel).full}</h4>
      <div className="focus-totals">
        <div><strong>{rounds.length}</strong><span>{tx('rounds', 'جولات')}</span></div>
        <div><strong>{fmtFocus(asMin(focused))}</strong><span>{tx('focused', 'تركيز')}</span></div>
        <div><strong>{blocked}</strong><span>{tx('blocked', 'محظور')}</span></div>
      </div>
      {rounds.length === 0 && <p className="hint-text">{tx('No rounds on this day.', 'لا جولات في هذا اليوم.')}</p>}
      {rounds.map((h, i) => (
        <div key={`${h.endedAt}-${i}`} className="focus-histrow">
          <span className={`focus-dot ${h.completed ? 'ok' : 'part'}`} />
          <span className="focus-histtask">{h.task}{h.projectId && nameOf(h.projectId) ? <span className="focus-histproj"> · {nameOf(h.projectId)}</span> : null}</span>
          <span className="ttime">{fmtTime(new Date(h.startedAt).toTimeString().slice(0, 5))}</span>
          <span className="ttime">{asMin(h.focusedSec)}m</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Focus settings — the machinery's dials, saved straight to the shell */
/* ------------------------------------------------------------------ */
function FocusSettings({ api, settings, templates, onSaved }) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => { setDraft(settings); }, [settings]);

  const save = async (patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    await api.saveSettings(patch);
    onSaved();
  };
  const num = (key, label, lo, hi, hint) => (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={lo} max={hi} value={draft[key]}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        onBlur={(e) => save({ [key]: clamp(Number(e.target.value) || lo, lo, hi) })} />
      {hint ? <small className="hint-text">{hint}</small> : null}
    </label>
  );
  const toggle = (key, label, hint) => (
    <label className="check">
      <input type="checkbox" checked={!!draft[key]} onChange={(e) => save({ [key]: e.target.checked })} />
      <span>{label}{hint ? <small className="hint-text">{hint}</small> : null}</span>
    </label>
  );
  const list = (key, label, hint) => (
    <label className="field">
      <span>{label}</span>
      <textarea rows={4} value={listToText(draft[key])}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value.split('\n') }))}
        onBlur={(e) => save({ [key]: textToList(e.target.value) })} />
      {hint ? <small className="hint-text">{hint}</small> : null}
    </label>
  );

  return (
    <div className="focus-card">
      <h4 className="focus-h4">{tx('Rounds', 'الجولات')}</h4>
      <div className="focus-row">
        {num('workMin', tx('Work minutes', 'دقائق العمل'), 1, 240)}
        {num('breakMin', tx('Break minutes', 'دقائق الاستراحة'), 1, 60)}
      </div>

      <h4 className="focus-h4">{tx('Bubbles', 'الفقاعات')}</h4>
      {toggle('bubbleWall', tx('Cover the screens while a bubble runs', 'غطِّ الشاشات أثناء الفقاعة'),
        tx('A calm wall behind the things in your bubble, with each of them on it to open. Off, the bubble still puts away everything else — you just see your desktop behind it.',
          'جدار هادئ خلف ما في فقاعتك، وعليه كل منها لتفتحه. عند إيقافه تظل الفقاعة تُبعد كل ما سواها — لكنك ترى سطح المكتب خلفها.'))}
      {toggle('bubbleTaskbar', tx('Replace the taskbar while a bubble runs', 'استبدل شريط المهام أثناء الفقاعة'),
        tx('The Windows taskbar steps aside for the bubble bar: your bubble’s apps and sites, File Explorer, a box to let a site in, the time left and the clock. Start, the Windows key and Alt+Tab still work; the taskbar comes back when the round ends.',
          'يتنحّى شريط مهام ويندوز لشريط الفقاعة: تطبيقات فقاعتك ومواقعها، ومستكشف الملفات، وخانة لإدخال موقع، والوقت المتبقي والساعة. تظل قائمة ابدأ وزر ويندوز وAlt+Tab تعمل؛ ويعود شريط المهام حين تنتهي الجولة.'))}
      <label className="field">
        <span>{tx('Sites in a bubble open in', 'تُفتح مواقع الفقاعة في')}</span>
        <select value={draft.bubbleSites || 'rhythm'} onChange={(e) => save({ bubbleSites: e.target.value })}>
          <option value="rhythm">{tx('Rhythm’s bubble browser', 'متصفح الفقاعة في ريذم')}</option>
          <option value="brave">{tx('Brave', 'Brave')}</option>
        </select>
        <small className="hint-text">{tx(
          'The bubble browser never loads a page outside the bubble. During a round, links you click in other apps open there too — the Rhythm extension (below) moves them out of Brave; the rest of the time they open in Brave as always. Brave stays one click away: “Open in Brave” in the bubble browser’s toolbar and right-click menu.',
          'متصفح الفقاعة لا يحمّل أبدًا صفحة خارج الفقاعة. أثناء الجولة تُفتح فيه أيضًا الروابط التي تنقرها في التطبيقات الأخرى — تنقلها إضافة ريذم (أدناه) من Brave؛ وفي بقية الوقت تُفتح في Brave كالمعتاد. ويبقى Brave على بُعد نقرة: «افتح في Brave» في شريط أدوات متصفح الفقاعة وقائمة النقر بالزر الأيمن.')}</small>
      </label>
      {num('settleSec', tx('Settling seconds', 'ثواني الاستقرار'), 0, 30, tx('Browser pages only: a page that is still loading is not judged by its loading title. Apps are judged the moment they are in front.', 'صفحات المتصفح فقط: الصفحة أثناء التحميل لا تُحاكم بعنوانها المؤقت. التطبيقات تُحاكم لحظة ظهورها.'))}
      <BraveCompanion api={api} />
      <BraveExtensions api={api} />

      <h4 className="focus-h4">{tx('Breaks and the chair', 'الاستراحات والكرسي')}</h4>
      {toggle('breakScreen', tx('Black out the screen on breaks', 'إظلام الشاشة أثناء الاستراحة'))}
      {toggle('chairDetect', tx('Chair detection (webcam, all local)', 'كشف الكرسي (كاميرا، محليًا بالكامل)'))}
      {num('awaySec', tx('Seconds away before blackout', 'ثواني الغياب قبل الإظلام'), 5, 300)}

      <h4 className="focus-h4">{tx('Commitment', 'الالتزام')}</h4>
      {toggle('commitmentMode', tx('Lock the whole laptop between rounds', 'قفل الجهاز كله بين الجولات'),
        tx('Every screen is covered until you start a round with something named and a duration. There is no step-out any more: resting is an answer — pick a reward below and focus on that — but opening the machine without naming anything is not.',
          'تُغطى كل الشاشات حتى تبدأ جولة بشيء محدّد ومدة. لم يعد هناك خروج مؤقت: الراحة إجابة مقبولة — اختر مكافأة من الأسفل وركّز عليها — أما فتح الجهاز دون تحديد أي شيء فلا.'))}

      <h4 className="focus-h4">{tx('Lists', 'القوائم')}</h4>
      {list('alwaysAllowed', tx('Always allowed', 'مسموح دائمًا'), tx('Inside every bubble — the docs, dictionary or tools you always work from. Matched as keywords against the window title, the app name and the site. A round without a bubble still blocks nothing.', 'داخل كل فقاعة — المراجع والقاموس والأدوات التي تعمل بها دائمًا. تُطابق ككلمات مع عنوان النافذة واسم التطبيق والموقع. الجولة بلا فقاعة لا تحظر شيئًا.'))}
      {list('blocklist', tx('Always blocked', 'محظور دائمًا'), tx('Minimized on sight, round or not, bubble or not. Matched against the window title, the app name and the address-bar domain.', 'تُصغَّر فور ظهورها، بجولة أو بدونها، وبفقاعة أو بدونها. تُطابق عنوان النافذة واسم التطبيق ونطاق شريط العنوان.'))}
      {list('freeTimes', tx('Free times', 'أوقات حرة'), tx('20:00-23:00 — or fri,sat 14:00-02:00. The hard block is off inside these.', '20:00-23:00 — أو fri,sat 14:00-02:00. الحظر التام معطّل خلالها.'))}

      <h4 className="focus-h4">{tx('This app', 'هذا التطبيق')}</h4>
      {/* Not a toggle. Rhythm has no Quit on the desktop, so signing out would
          be the loophole that closed it — it comes back at every sign-in. */}
      <label className="check is-fixed">
        <input type="checkbox" checked disabled readOnly />
        <span>{tx('Start with Windows', 'البدء مع تشغيل ويندوز')}
          <small className="hint-text">{tx(
            'Always on. Rhythm has no Quit on the desktop — closing a window sends it to the tray, and it launches again at every sign-in. To actually end it, use Task Manager or uninstall it.',
            'مفعّل دائمًا. لا يوجد زر إنهاء لريذم على سطح المكتب — إغلاق النافذة يرسله إلى شريط المهام، ويبدأ من جديد مع كل تسجيل دخول. لإنهائه فعلًا، استخدم مدير المهام أو أزل تثبيته.'
          )}</small>
        </span>
      </label>
      {toggle('openPlannerAtStart', tx('Open the planner window at launch', 'افتح نافذة المخطط عند التشغيل'), tx('Off means Rhythm starts in the tray.', 'إيقافها يعني أن ريذم يبدأ في شريط المهام.'))}

      <p className="hint-text"><Save size={12} /> {tx('Changes save as you leave each field.', 'تُحفظ التغييرات عند مغادرة كل حقل.')}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Brave: the extension that holds it to the bubble, and the          */
/*  extensions of yours the bubble browser carries.                    */
/* ------------------------------------------------------------------ */
function BraveCompanion({ api }) {
  const [c, setC] = useState(null);
  const load = useCallback(() => api.bubble.companion().then(setC).catch(() => {}), [api]);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  if (!c) return null;
  return (
    <div className="bubble-brave">
      <div className="bubble-brave-head">
        <strong>{tx('The Rhythm extension for Brave', 'إضافة ريذم لـ Brave')}</strong>
        <span className={`bubble-status ${c.connected ? 'ok' : ''}`}>{c.connected ? tx('connected', 'متصلة') : tx('not connected', 'غير متصلة')}</span>
      </div>
      {c.connected
        ? <p className="hint-text">{tx('Brave is listening. While a bubble runs, a site outside it is swapped for a “not in this bubble” page instead of the whole window being minimized, and tabs go back to their page when the round ends.',
          'Brave يستمع. أثناء الفقاعة يُستبدل أي موقع خارجها بصفحة «ليس في هذه الفقاعة» بدل تصغير النافذة كلها، وتعود الألسنة إلى صفحاتها حين تنتهي الجولة.')}</p>
        : (
          <ol className="bubble-steps">
            <li>{tx('In Brave, open', 'في Brave، افتح')} <code>brave://extensions</code></li>
            <li>{tx('Turn on Developer mode (top right).', 'شغّل وضع المطوّر (أعلى اليمين).')}</li>
            <li>{tx('Click “Load unpacked” and choose the folder below.', 'انقر «تحميل غير مضغوط» واختر المجلد أدناه.')}</li>
          </ol>
        )}
      <button className="ghost sm" onClick={() => api.bubble.openCompanionFolder()}><FolderOpen size={13} /> {tx('Show the extension folder', 'اعرض مجلد الإضافة')}</button>
      {!c.connected && c.folder && <small className="hint-text bubble-path">{c.folder}</small>}
    </div>
  );
}

function BraveExtensions({ api }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pickNote, setPickNote] = useState('');
  useEffect(() => { api.bubble.braveExtensions().then(setList).catch(() => setList([])); }, [api]);
  if (!list) return null;
  const pick = async () => {
    setBusy(true); setPickNote('');
    try {
      const r = await api.bubble.pickExtension();
      if (r && r.list) setList(r.list);
      if (r && r.error === 'no-manifest') setPickNote(tx('That folder has no manifest.json — pick the folder the extension’s manifest is in.', 'لا يحوي هذا المجلد manifest.json — اختر المجلد الذي فيه ملف الإضافة.'));
    } finally { setBusy(false); }
  };
  const forget = async (id) => { setBusy(true); try { setList(await api.bubble.forgetExtension(id)); } finally { setBusy(false); } };
  const SOURCE = {
    'brave-unpacked': tx('unpacked in Brave', 'غير مضغوطة في Brave'),
    folder: tx('unpacked folder', 'مجلد غير مضغوط'),
  };
  const flip = async (id) => {
    const on = list.filter((x) => x.on).map((x) => x.id);
    const next = on.includes(id) ? on.filter((x) => x !== id) : [...on, id];
    setBusy(true);
    try { setList(await api.bubble.setBraveExtensions(next)); } finally { setBusy(false); }
  };
  return (
    <div className="bubble-brave">
      <div className="bubble-brave-head">
        <strong>{tx('Your Brave extensions, in the bubble browser', 'إضافات Brave في متصفح الفقاعة')}</strong>
        <button className="ghost sm" onClick={() => api.bubble.browser()}><Globe size={13} /> {tx('Open it', 'افتحه')}</button>
      </div>
      {list.length === 0
        ? <p className="hint-text">{tx('No Brave extensions found on this computer.', 'لم تُعثر على إضافات Brave في هذا الجهاز.')}</p>
        : (
          <>
            <p className="hint-text">{tx(
              'Loaded straight from Brave’s own folder. Most extensions that work on the page itself (spelling, grammar, dark mode, password fill) work here; ones that need parts of Brave this browser does not have may not. Their buttons sit at the end of the address bar.',
              'تُحمّل مباشرة من مجلد Brave. أغلب الإضافات التي تعمل على الصفحة نفسها (الإملاء، القواعد، الوضع الداكن، تعبئة كلمات المرور) تعمل هنا؛ أما التي تحتاج أجزاء من Brave ليست في هذا المتصفح فقد لا تعمل. أزرارها في آخر شريط العنوان.')}</p>
            {list.map((x) => (
              <label key={x.id} className="check" title={x.dir || ''}>
                <input type="checkbox" checked={x.on} disabled={busy || x.missing} onChange={() => flip(x.id)} />
                <span>{x.name}{SOURCE[x.source] ? <span className="bubble-src">{SOURCE[x.source]}</span> : null}
                  {x.source === 'folder' && (
                    <button type="button" className="bubble-pick-del" onClick={(e) => { e.preventDefault(); forget(x.id); }} aria-label={tx('Remove', 'أزل')}><X size={12} /></button>
                  )}
                  {' '}<small className="hint-text">{x.missing ? tx('folder not found', 'المجلد غير موجود') : `v${x.version}`}{
                  x.on && x.error ? ` · ${tx('could not load', 'تعذّر تحميلها')}: ${x.error}`
                    : x.on && x.partial ? ` · ${tx('only partly works here — its background part would not start', 'تعمل هنا جزئيًا فقط — جزؤها الخلفي لم يبدأ')}`
                      : x.on && x.loaded ? ` · ${tx('loaded', 'محمّلة')}`
                        : x.on ? ` · ${tx('loads when the bubble browser opens', 'تُحمّل حين يُفتح متصفح الفقاعة')}` : ''}</small></span>
              </label>
            ))}
          </>
        )}
      <button className="ghost sm" onClick={pick} disabled={busy}><FolderOpen size={13} /> {tx('Load unpacked…', 'تحميل غير مضغوط…')}</button>
      {pickNote && <p className="hint-text bubble-note">{pickNote}</p>}
    </div>
  );
}

/* The bubbles (the shell still calls them focus modes / templates) the shell
   holds, for the planner's own editors (a task can name the bubble it starts
   with). Empty everywhere but the desktop. */
export function useFocusModes() {
  const api = desktopFocus();
  const [modes, setModes] = useState([]);
  useEffect(() => {
    if (!api) return undefined;
    let alive = true;
    const load = () => api.getData().then((d) => { if (alive) setModes((d && d.templates) || []); }).catch(() => {});
    load();
    const off = api.onDataChanged(load);
    return () => { alive = false; off && off(); };
  }, [api]);
  return modes;
}
