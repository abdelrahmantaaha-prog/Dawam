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
import { ChevronLeft, ChevronRight, Play, Pause, Square, SkipForward, Timer, ShieldCheck, AlertTriangle, Check, X, Trash2, Save, Settings as SettingsIcon, Flame, Eye } from 'lucide-react';
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
  const [cleared, setCleared] = useState('');
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
      setTplId(tpl.id); setTplName(tpl.name); setCleared(listToText(tpl.allowed)); setTplAuto(true);
    } else if (tplAuto) {
      setTplId(''); setCleared(''); setTplAuto(false);
    }
    // The task's own length beats the mode's: a 20-minute task under a
    // 90-minute mode is still a 20-minute task.
    setMinutes(clamp(Number(known) || (tpl && Number(tpl.workMin)) || settings?.workMin || 50, 1, 240));
  };

  const useTemplate = (tpl) => {
    setTplAuto(false);
    if (tplId === tpl.id) { setTplId(''); setCleared(''); return; }  // tap again to lift it
    setTplId(tpl.id);
    setTplName(tpl.name);
    setMinutes(clamp(Number(tpl.workMin) || 50, 1, 240));
    setCleared(listToText(tpl.allowed));
  };

  useEffect(() => {
    if (settings && !live && !title) setMinutes(clamp(Number(settings.workMin) || 50, 1, 240));
  }, [settings, live, title]);

  const start = async () => {
    const task = title.trim();
    if (!task) return;
    const allowed = textToList(cleared);
    let useId = tplId || null;
    if (saveTpl) {
      const name = (tplName.trim() || task).trim();
      const list = await api.saveTemplate({ id: tplId || null, name, workMin: minutes, allowed });
      const saved = (list || []).find((t) => String(t.name).toLowerCase() === name.toLowerCase());
      if (saved) useId = saved.id;
    }
    // A reward's id is not a task id. Passing it on would have the planner
    // hunting for a task that does not exist when the round ends, and offering
    // to tick off nothing.
    const realTask = taskId && !String(taskId).startsWith('reward:') ? taskId : null;
    const resting = String(taskId || '').startsWith('reward:');
    const pid = !resting && projects.some((p) => p.id === projectId) ? projectId : null;
    await api.startWork({ task, workMin: minutes, allowed, taskId: realTask, templateId: useId, projectId: pid });
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
        <button className={tab === 'focus' ? 'on' : ''} onClick={() => setTab('focus')}><Timer size={15} /> {tx('Focus', 'تركيز')}</button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}><Flame size={15} /> {tx('Tally', 'الحصيلة')}</button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}><SettingsIcon size={15} /> {tx('Focus settings', 'إعدادات التركيز')}</button>
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
        ? <LiveSession api={api} state={state} projects={projects} />
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

            <label className="field">
              <span>{tplId ? `${tx('Cleared by', 'مسموح حسب')} “${tplName}”` : tx('Cleared for this round', 'مسموح لهذه الجولة')}</span>
              <textarea rows={2} value={cleared} onChange={(e) => setCleared(e.target.value)}
                placeholder={tx('one site or app per line — leave empty for relaxed mode', 'موقع أو تطبيق في كل سطر — اتركه فارغًا للوضع المتساهل')} />
            </label>
            <p className="hint-text">
              {textToList(cleared).length
                ? tx('Strict: everything else is off-task and you get returned by force.', 'صارم: كل ما عداها خارج المهمة وستُعاد بالقوة.')
                : tx('Relaxed: only your distraction list nudges you.', 'متساهل: قائمة الإلهاء وحدها هي التي تنبّهك.')}
            </p>
            {tplAuto && tplId && picked && picked.mode && (
              <p className="hint-text focus-modeauto">
                {tx(`“${tplName}” loaded — remembered for this ${picked.mode.from === 'task' ? 'task' : picked.mode.from === 'tag' ? 'tag' : 'project'}. Pick another mode or tap it to lift it for this round.`,
                  `حُمّل «${tplName}» — محفوظ لهذه ${picked.mode.from === 'task' ? 'المهمة' : picked.mode.from === 'tag' ? 'الوسم' : 'المشروع'}. اختر نمطًا آخر أو انقر عليه لرفعه في هذه الجولة.`)}
              </p>
            )}

            {/* Remember the mode, so this task loads it by itself next time.
                Shown only when there is something to remember — a mode is
                applied or about to be saved — or to forget. */}
            {canRemember && !tplAuto && (tplId || saveTpl || pickedMode) && (
              <label className="field focus-remember">
                <span>{tplId || saveTpl ? tx('Load this mode automatically for', 'حمّل هذا النمط تلقائيًا لـ') : tx('Stop loading a mode for', 'أوقف تحميل نمط لـ')}</span>
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
              <span>{tplId ? tx('Update this focus mode', 'حدّث نمط التركيز هذا') : tx('Save these restrictions as a focus mode', 'احفظ هذه القيود كنمط تركيز')}</span>
            </label>
            {saveTpl && (
              <label className="field">
                <span>{tx('Name it', 'سمِّه')}</span>
                <input value={tplName} onChange={(e) => setTplName(e.target.value)}
                  placeholder={tx('Deep work, Admin, Reading…', 'عمل عميق، إداري، قراءة…')} />
                <span className="hint-text">{tx('A focus mode is a set of restrictions, not a task — you can use it with any task.', 'نمط التركيز مجموعة قيود لا مهمة — يمكنك استخدامه مع أي مهمة.')}</span>
              </label>
            )}

            <button className="primary focus-block" onClick={start} disabled={!title.trim()}>
              <Play size={16} /> {tx('Start focusing', 'ابدأ التركيز')}
            </button>

            {templates.length > 0 && (
              <div className="focus-templates">
                <h4 className="focus-h4">{tx('Focus modes', 'أنماط التركيز')}</h4>
                <p className="hint-text">{tx('Restrictions and allow lists you can apply to any task.', 'قيود وقوائم سماح يمكن تطبيقها على أي مهمة.')}</p>
                {templates.map((tpl) => (
                  <div key={tpl.id} className={`focus-tplrow${tplId === tpl.id ? ' on' : ''}`}>
                    <button className="focus-tplname" onClick={() => useTemplate(tpl)}>
                      <span>{tpl.name}</span>
                      <span className="ttime">{tpl.workMin}m</span>
                      {tpl.allowed?.length ? <span className="focus-strict"><ShieldCheck size={12} /> {tx('strict', 'صارم')}</span> : null}
                      {tplId === tpl.id ? <span className="focus-applied">{tx('applied', 'مطبّق')}</span> : null}
                    </button>
                    <button className="ghost sm" onClick={async () => { if (tplId === tpl.id) { setTplId(''); } await api.deleteTemplate(tpl.id); reload(); }}
                      aria-label={tx('Delete focus mode', 'حذف نمط التركيز')}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
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
function LiveSession({ api, state, projects = [] }) {
  const s = state;
  const breakPhase = s.phase === 'break';
  const cls = breakPhase ? 'break' : s.paused ? 'paused' : s.drifting ? 'drifting' : 'working';
  const pct = s.totalSec ? clamp(1 - s.remainingSec / s.totalSec, 0, 1) : 0;

  return (
    <div className={`focus-card focus-live ${cls}`}>
      <span className="focus-phase">
        {breakPhase ? tx('Break', 'استراحة') : s.paused ? tx('Paused', 'موقوف') : tx('Focusing', 'تركيز')}
        {!breakPhase && s.strict ? <span className="focus-strict"><ShieldCheck size={12} /> {tx('strict', 'صارم')}</span> : null}
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
          <span>{tx('Drifted', 'شرود')} {s.driftCount}×</span>
          <span>{tx('Off-task', 'خارج المهمة')} {asMin(s.distractedSec)}m</span>
        </div>
      )}

      {s.drifting && (
        <p className="focus-drift">
          <AlertTriangle size={14} />
          {s.enforceInSec != null
            ? tx(`Off-task — forced back in ${s.enforceInSec}s`, `خارج المهمة — ستُعاد خلال ${s.enforceInSec} ث`)
            : tx('Off-task', 'خارج المهمة')}
        </p>
      )}

      {s.ask && (
        <div className="focus-ask">
          <span><Eye size={14} /> <strong>{s.ask.label}</strong> — {tx('work or distraction?', 'عمل أم إلهاء؟')}</span>
          <span className="focus-ask-btns">
            <button className="primary sm" onClick={() => api.triageVerdict(s.ask.key, 'work')}>{tx('Work', 'عمل')}</button>
            <button className="ghost sm" onClick={() => api.triageVerdict(s.ask.key, 'distraction')}>{tx('Distraction', 'إلهاء')}</button>
            <button className="ghost sm" onClick={() => api.triageSnooze(s.ask.key)} aria-label={tx('Ask later', 'لاحقًا')}><X size={14} /></button>
          </span>
        </div>
      )}

      {!breakPhase && s.current?.title && (
        <p className="hint-text focus-current">{tx('In front of you:', 'أمامك:')} {s.current.title}</p>
      )}

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
        {entry.driftCount ? tx(` · drifted ${entry.driftCount}×`, ` · شردت ${entry.driftCount} مرة`) : ''}
      </p>
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
  const distracted = rounds.reduce((n, h) => n + (h.distractedSec || 0), 0);
  const rate = focused + distracted ? Math.round((focused / (focused + distracted)) * 100) : null;
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
        <div><strong>{rate == null ? '—' : `${rate}%`}</strong><span>{tx('focus rate', 'نسبة التركيز')}</span></div>
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

      <h4 className="focus-h4">{tx('Drift', 'الشرود')}</h4>
      <div className="focus-row">
        {num('graceSec', tx('Grace seconds', 'مهلة بالثواني'), 0, 300, tx('A glance is not a drift.', 'النظرة العابرة ليست شرودًا.'))}
        {num('enforceSec', tx('Force return after', 'الإعادة القسرية بعد'), 3, 300)}
      </div>
      {num('settleSec', tx('Settling seconds', 'ثواني الاستقرار'), 0, 30, tx('A loading page should not be judged by its loading title.', 'الصفحة أثناء التحميل لا تُحاكم بعنوانها المؤقت.'))}
      {toggle('nudgeSound', tx('Sound on nudge', 'صوت عند التنبيه'))}

      <h4 className="focus-h4">{tx('Breaks and the chair', 'الاستراحات والكرسي')}</h4>
      {toggle('breakScreen', tx('Black out the screen on breaks', 'إظلام الشاشة أثناء الاستراحة'))}
      {toggle('chairDetect', tx('Chair detection (webcam, all local)', 'كشف الكرسي (كاميرا، محليًا بالكامل)'))}
      {num('awaySec', tx('Seconds away before blackout', 'ثواني الغياب قبل الإظلام'), 5, 300)}

      <h4 className="focus-h4">{tx('Commitment', 'الالتزام')}</h4>
      {toggle('commitmentMode', tx('Lock the whole laptop between rounds', 'قفل الجهاز كله بين الجولات'),
        tx('Every screen is covered until you start a round with something named and a duration. There is no step-out any more: resting is an answer — pick a reward below and focus on that — but opening the machine without naming anything is not.',
          'تُغطى كل الشاشات حتى تبدأ جولة بشيء محدّد ومدة. لم يعد هناك خروج مؤقت: الراحة إجابة مقبولة — اختر مكافأة من الأسفل وركّز عليها — أما فتح الجهاز دون تحديد أي شيء فلا.'))}

      <h4 className="focus-h4">{tx('Lists', 'القوائم')}</h4>
      {list('alwaysAllowed', tx('Always allowed', 'مسموح دائمًا'), tx('Sites and keywords that are never a distraction in any round — the docs, dictionary or tools you always work from. Unlike a round’s cleared list, this does not make the round strict. The hard block still wins.', 'مواقع وكلمات لا تُعد إلهاءً في أي جولة — المراجع والقاموس والأدوات التي تعمل بها دائمًا. على خلاف قائمة الجولة، لا تجعل الجولة صارمة. الحظر التام يبقى أقوى.'))}
      {list('distractions', tx('Distractions', 'الملهيات'), tx('Matched against the window title, the app name and the address-bar domain.', 'تُطابق عنوان النافذة واسم التطبيق ونطاق شريط العنوان.'))}
      {list('blocklist', tx('Hard block', 'حظر تام'), tx('Minimized on sight, session or not.', 'تُصغَّر فور ظهورها، بجلسة أو بدونها.'))}
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

      {templates.some((t) => t.verdicts && Object.keys(t.verdicts).length) && (
        <>
          <h4 className="focus-h4">{tx('Learned filters', 'المرشّحات المكتسبة')}</h4>
          {templates.filter((t) => t.verdicts && Object.keys(t.verdicts).length).map((t) => (
            <div key={t.id} className="focus-verdicts">
              <strong>{t.name}</strong>
              {Object.entries(t.verdicts).map(([k, v]) => (
                <span key={k} className={`focus-verdict ${v}`}>
                  {k.replace(/^(site|app):/, '')}
                  <button className="ghost sm" onClick={async () => { await api.templateVerdict(t.id, k, null); onSaved(); }}
                    aria-label={tx('Forget', 'انسَ')}><X size={12} /></button>
                </span>
              ))}
            </div>
          ))}
        </>
      )}

      <p className="hint-text"><Save size={12} /> {tx('Changes save as you leave each field.', 'تُحفظ التغييرات عند مغادرة كل حقل.')}</p>
    </div>
  );
}

/* The focus modes the shell holds, for the planner's own editors (a task can
   name the mode it starts with). Empty everywhere but the desktop. */
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
