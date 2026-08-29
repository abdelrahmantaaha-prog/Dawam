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
import { Play, Pause, Square, SkipForward, Timer, ShieldCheck, AlertTriangle, Check, X, Trash2, Save, Settings as SettingsIcon, Flame, Eye } from 'lucide-react';
import { tx, fmtTime } from './core.jsx';

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
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

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
export function FocusView({ tasks = [], durationFor, pendingRound, onDismissRound, onMarkTaskDone, onLearnDuration }) {
  const { api, state, data, reload } = useFocus();
  const [tab, setTab] = useState('focus'); // focus | history | settings
  const [taskId, setTaskId] = useState('');
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState(50);
  const [cleared, setCleared] = useState('');
  const [saveTpl, setSaveTpl] = useState(false);

  const settings = data?.settings || null;
  const templates = data?.templates || [];
  const history = data?.history || [];
  const live = state && state.phase !== 'idle';

  // Picking a planned task fills in everything the planner already knows about
  // it: the title, and a duration from its own slot or from what past rounds
  // taught us. Nothing here is a guess the person cannot overrule.
  const pickTask = (t) => {
    setTaskId(t.id);
    setTitle(t.title);
    const known = (t.minutes || null) || (durationFor ? durationFor(t.title) : null);
    setMinutes(clamp(Number(known) || settings?.workMin || 50, 1, 240));
    const tpl = templates.find((x) => x.task.toLowerCase() === t.title.trim().toLowerCase());
    setCleared(tpl ? listToText(tpl.allowed) : '');
  };

  const useTemplate = (tpl) => {
    setTaskId('');
    setTitle(tpl.task);
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
    if (saveTpl) await api.saveTemplate({ task, workMin: minutes, allowed });
    await api.startWork({ task, workMin: minutes, allowed, taskId: taskId || null });
    reload();
  };

  if (!api) return null;

  return (
    <div className="view focus-view">
      <div className="focus-tabs">
        <button className={tab === 'focus' ? 'on' : ''} onClick={() => setTab('focus')}><Timer size={15} /> {tx('Focus', 'تركيز')}</button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}><Flame size={15} /> {tx('Today', 'اليوم')}</button>
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

      {tab === 'focus' && (live
        ? <LiveSession api={api} state={state} />
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

            <label className="field">
              <span>{tx('Task', 'المهمة')}</span>
              <input value={title} onChange={(e) => { setTitle(e.target.value); setTaskId(''); }}
                placeholder={tx('What are you working on?', 'على ماذا تعمل؟')} />
            </label>

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
              <span>{tx('Cleared for this task', 'مسموح لهذه المهمة')}</span>
              <textarea rows={2} value={cleared} onChange={(e) => setCleared(e.target.value)}
                placeholder={tx('one site or app per line — leave empty for relaxed mode', 'موقع أو تطبيق في كل سطر — اتركه فارغًا للوضع المتساهل')} />
            </label>
            <p className="hint-text">
              {textToList(cleared).length
                ? tx('Strict: everything else is off-task and you get returned by force.', 'صارم: كل ما عداها خارج المهمة وستُعاد بالقوة.')
                : tx('Relaxed: only your distraction list nudges you.', 'متساهل: قائمة الإلهاء وحدها هي التي تنبّهك.')}
            </p>

            <label className="check">
              <input type="checkbox" checked={saveTpl} onChange={(e) => setSaveTpl(e.target.checked)} />
              <span>{tx('Save as a template', 'احفظها كقالب')}</span>
            </label>

            <button className="primary focus-block" onClick={start} disabled={!title.trim()}>
              <Play size={16} /> {tx('Start focusing', 'ابدأ التركيز')}
            </button>

            {templates.length > 0 && (
              <div className="focus-templates">
                <h4 className="focus-h4">{tx('Templates', 'القوالب')}</h4>
                {templates.map((tpl) => (
                  <div key={tpl.id} className="focus-tplrow">
                    <button className="focus-tplname" onClick={() => useTemplate(tpl)}>
                      <span>{tpl.task}</span>
                      <span className="ttime">{tpl.workMin}m</span>
                      {tpl.allowed?.length ? <span className="focus-strict"><ShieldCheck size={12} /> {tx('strict', 'صارم')}</span> : null}
                    </button>
                    <button className="ghost sm" onClick={async () => { await api.deleteTemplate(tpl.id); reload(); }}
                      aria-label={tx('Delete template', 'حذف القالب')}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

      {tab === 'history' && <FocusHistory history={history} />}
      {tab === 'settings' && settings && <FocusSettings api={api} settings={settings} templates={templates} onSaved={reload} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Live session — the same numbers the overlay shows, with room to     */
/*  show the window that is currently being judged.                     */
/* ------------------------------------------------------------------ */
function LiveSession({ api, state }) {
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
/*  Today's rounds                                                      */
/* ------------------------------------------------------------------ */
function FocusHistory({ history }) {
  const since = startOfToday();
  const today = history.filter((h) => h.endedAt >= since);
  const focused = today.reduce((n, h) => n + (h.focusedSec || 0), 0);
  const distracted = today.reduce((n, h) => n + (h.distractedSec || 0), 0);
  const rate = focused + distracted ? Math.round((focused / (focused + distracted)) * 100) : null;

  return (
    <div className="focus-card">
      <div className="focus-totals">
        <div><strong>{today.length}</strong><span>{tx('rounds', 'جولات')}</span></div>
        <div><strong>{asMin(focused)}m</strong><span>{tx('focused', 'تركيز')}</span></div>
        <div><strong>{rate == null ? '—' : `${rate}%`}</strong><span>{tx('focus rate', 'نسبة التركيز')}</span></div>
      </div>
      {today.length === 0 && <p className="hint-text">{tx('No rounds yet today.', 'لا جولات اليوم بعد.')}</p>}
      {today.map((h, i) => (
        <div key={`${h.endedAt}-${i}`} className="focus-histrow">
          <span className={`focus-dot ${h.completed ? 'ok' : 'part'}`} />
          <span className="focus-histtask">{h.task}</span>
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
        tx('Every screen is covered until you start a focus round with a task and a duration. A 2.5-second hold on the lock screen steps out temporarily.', 'تُغطى كل الشاشات حتى تبدأ جولة تركيز بمهمة ومدة. الضغط المطوّل (٢٫٥ ثانية) على شاشة القفل يمنح خروجًا مؤقتًا.'))}
      {num('unlockMin', tx('Step-out minutes', 'دقائق الخروج المؤقت'), 1, 60, tx('How long a completed hold keeps the laptop open.', 'مدة بقاء الجهاز مفتوحًا بعد الضغط المطوّل.'))}

      <h4 className="focus-h4">{tx('Lists', 'القوائم')}</h4>
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
              <strong>{t.task}</strong>
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
