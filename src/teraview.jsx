/* ------------------------------------------------------------------ */
/*  Tera's screen: the conversation, the big microphone, her settings. */
/*                                                                     */
/*  The talking loop lives here. Tap the mic once and it is a          */
/*  conversation: you speak, the take ends by itself when you go       */
/*  quiet, she answers aloud, and she listens again — until you tap    */
/*  the mic, say nothing for a few seconds, or leave the screen.       */
/*  Tapping while she talks cuts her off and listens, as you would     */
/*  with a person.                                                     */
/*                                                                     */
/*  Everything that changes the planner happens in App.jsx (onSend,    */
/*  onUndo, onApprove); this file only talks and listens.              */
/* ------------------------------------------------------------------ */
import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCircle2, ListChecks, Loader2, Mic, Send, Settings2, Square, Undo2, Volume2, X } from 'lucide-react';
import { tx } from './core.jsx';
import { useDictation } from './dictation.js';
import { TERA_VOICES, isHM } from './tera.js';
import { CLAUDE_MODELS, EFFORTS, loadClaudeKey, saveClaudeKey, looksLikeClaudeKey, testClaudeKey } from './teraclaude.js';
import { teraSpeak, teraStopSpeaking } from './teranative.js';

const AVATAR = '/tera.png';

function fmtClock(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function TeraView({
  t, patchTera, msgs, busy, err, setErr, talkLang, onSend, onUndo, onApprove, onDismiss, onApproveAll, applyBusy,
  describe, native, status, refreshStatus, onTest, onOpenOverlay, onOpenExact, onClear,
  apiKey, broker, dictationError, talkToken, onClose, activity,
}) {
  const [draft, setDraft] = useState('');
  const [convo, setConvo] = useState(false);        // in a spoken back-and-forth
  const [speaking, setSpeaking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const convoRef = useRef(false);
  convoRef.current = convo;
  const listRef = useRef(null);
  const sendRef = useRef(null);

  const mic = useDictation({
    lang: talkLang, apiKey, broker,
    autoStop: convo ? { silenceMs: 1300, waitMs: 9000 } : null,
    onText: (text, final, done) => {
      setDraft(text);
      if (done === 'done' && convoRef.current) sendRef.current?.(text);
    },
    onError: (e) => {
      const m = String((e && e.message) || e);
      // Silence ends a conversation quietly; it is how you hang up.
      if (m === 'no-speech' && convoRef.current) { setConvo(false); return; }
      setConvo(false);
      setErr(dictationError(e));
    },
  });

  const say = async (text, lang) => {
    if (!t.speakReplies || !text) return;
    setSpeaking(true);
    await teraSpeak(text, lang);
    setSpeaking(false);
  };

  const submit = async (textIn) => {
    const text = String(textIn ?? draft).trim();
    if (!text || busy) return;
    setDraft('');
    setErr('');
    const res = await onSend(text);
    if (!res) { setConvo(false); return; }
    await say(res.reply, res.lang);
    // Still talking? Then it is her turn to listen.
    if (convoRef.current && t.handsFree) mic.start();
    else setConvo(false);
  };
  sendRef.current = submit;

  const tapMic = async () => {
    if (speaking) { await teraStopSpeaking(); setSpeaking(false); setConvo(true); mic.start(); return; }
    if (mic.state === 'listening') { if (convo) { mic.stop(); } else mic.toggle(); return; }
    if (mic.state === 'transcribing' || busy) return;
    setErr('');
    setConvo(true);
    mic.start();
  };
  const hangUp = async () => { setConvo(false); mic.cancel(); await teraStopSpeaking(); setSpeaking(false); };

  // Opened from the floating face's "Talk": start listening straight away.
  useEffect(() => {
    if (!talkToken) return;
    setConvo(true);
    const id = setTimeout(() => mic.start(), 350);
    return () => clearTimeout(id);
  }, [talkToken]); // eslint-disable-line

  // Leaving the screen ends the conversation and her sentence.
  useEffect(() => () => { teraStopSpeaking(); }, []);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, busy]);

  const mood = speaking ? tx('Talking…', 'بتتكلم…')
    : busy ? tx('Thinking…', 'بتفكر…')
      : mic.state === 'listening' ? tx('Listening…', 'سامعاك…')
        : mic.state === 'transcribing' ? tx('Catching that…', 'بكتب اللي قلته…')
          : tx('Your sarcastic secretary', 'سكرتيرتك الرخمة');

  const lastUndoable = (() => { for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'assistant') return msgs[i].undo && !msgs[i].undone ? i : -1; return -1; })();

  const needsSetup = native && status && (!status.overlay || !status.exactAlarm);

  return (
    <div className="tera">
      <div className="tera-head">
        <div className={`tera-face ${speaking ? 'talking' : ''} ${mic.state === 'listening' ? 'hearing' : ''}`} style={mic.state === 'listening' ? { '--lvl': mic.level } : undefined}>
          <img src={AVATAR} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
        </div>
        <div className="tera-id">
          <strong>{tx('Tera', 'تيرا')}</strong>
          <span>{mood}</span>
        </div>
        <button className="icon" onClick={() => setShowSettings((v) => !v)} aria-label={tx('Tera settings', 'إعدادات تيرا')} title={tx('Tera settings', 'إعدادات تيرا')}><Settings2 size={17} /></button>
        {onClose && <button className="icon" onClick={onClose} aria-label={tx('Close', 'إغلاق')}><X size={18} /></button>}
      </div>

      {needsSetup && !showSettings && (
        <div className="tera-setup">
          <Bell size={15} />
          <span>{!status.overlay
            ? tx('Let Tera pop up over other apps, so she can check on you.', 'اسمح لتيرا تظهر فوق التطبيقات التانية عشان تقدر تسأل عليك.')
            : tx('Allow exact alarms so her reminders come on time.', 'اسمح بالمنبهات الدقيقة عشان تفكيرها ييجي في ميعاده.')}</span>
          <button className="primary sm" onClick={() => (!status.overlay ? onOpenOverlay() : onOpenExact())}>{tx('Allow', 'اسمح')}</button>
        </div>
      )}

      {showSettings ? (
        <TeraSettings t={t} patch={patchTera} native={native} status={status} refresh={refreshStatus}
          onTest={onTest} onOpenOverlay={onOpenOverlay} onOpenExact={onOpenExact} onClear={onClear}
          onVoiceTest={(lang) => say(lang === 'ar' ? 'أهلًا، أنا تيرا. هفضل وراك لحد ما تخلّص.' : "Hi, I'm Tera. I'll be on your case until it's done.", lang)} />
      ) : (
        <div className="tera-log" ref={listRef}>
          {msgs.length === 0 && (
            <div className="tera-empty">
              <p>{tx('Talk to me. Tell me what you finished, ask what is next, or tell me to move things around — I just do it, and you can undo.', 'كلّمني. قولّي خلّصت إيه، اسألني اللي جاي إيه، أو قولّي أحرّك حاجة — هعملها على طول، وتقدر ترجّعها.')}</p>
              <div className="chat-suggests">
                {[tx('What should I do now?', 'أعمل إيه دلوقتي؟'), tx('I finished the first task', 'خلصت أول مهمة'), tx('Push my next meeting by an hour', 'أجّل الميعاد الجاي ساعة'), tx('How bad is today looking?', 'النهارده شكله عامل إزاي؟')].map((sg) => (
                  <button key={sg} className="ghost sm" onClick={() => submit(sg)}>{sg}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, mi) => (
            <div key={mi} className={`chat-msg ${m.role} ${m.popup ? 'popup' : ''}`}>
              <div className="chat-bubble" dir="auto">{m.text}</div>
              {m.role === 'assistant' && (m.proposals || []).length > 0 && (
                <div className="chat-props">
                  {!m.auto && (m.proposals || []).filter((_, i) => !(m.applied || {})[i]).length > 1 && (
                    <button className="ghost sm chat-apply-all" onClick={() => onApproveAll(mi)} disabled={applyBusy}>
                      <ListChecks size={13} /> {tx('Approve all', 'وافق على الكل')}
                    </button>
                  )}
                  {m.proposals.map((p, pi) => {
                    const state = (m.applied || {})[pi];
                    return (
                      <div key={pi} className={`chat-prop ${state || ''} ${m.undone ? 'skip' : ''}`}>
                        <div className="chat-prop-main"><span className="chat-prop-desc">{describe(p)}</span></div>
                        {m.undone ? <span className="chat-prop-state muted">{tx('undone', 'اترجعت')}</span>
                          : state === 'done' ? <span className="chat-prop-state"><CheckCircle2 size={14} /> {tx('done', 'تم')}</span>
                            : state === 'skip' ? <span className="chat-prop-state muted">{tx('skipped', 'اتلغت')}</span>
                              : state === 'fail' ? <span className="chat-prop-state muted">{tx("couldn't", 'معرفتش')}</span>
                                : (
                                  <span className="chat-prop-actions">
                                    <button className="primary sm" onClick={() => onApprove(mi, pi)} disabled={applyBusy}>{tx('Do it', 'اعمليها')}</button>
                                    <button className="ghost sm" onClick={() => onDismiss(mi, pi)} disabled={applyBusy}>{tx('No', 'لأ')}</button>
                                  </span>
                                )}
                      </div>
                    );
                  })}
                  {mi === lastUndoable && (
                    <button className="ghost sm tera-undo" onClick={() => onUndo(mi)} disabled={applyBusy}><Undo2 size={13} /> {tx('Undo', 'رجّعها')}</button>
                  )}
                </div>
              )}
              {m.role === 'assistant' && m.text && t.speakReplies && (
                <button className="tera-replay" onClick={() => say(m.text, m.lang)} aria-label={tx('Say it again', 'قوليها تاني')}><Volume2 size={13} /></button>
              )}
            </div>
          ))}
          {busy && <div className="chat-msg assistant"><div className="chat-bubble thinking"><Loader2 size={14} className="spin" /> {activity ? `${tx('Working', 'بتشتغل')}: ${activity.replace(/_/g, ' ')}` : tx('Thinking…', 'بتفكر…')}</div></div>}
          {err && <p className="hint-text tera-err">{err}</p>}
        </div>
      )}

      {!showSettings && (
        <div className="tera-foot">
          <input className="chat-input" dir="auto" value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder={mic.state === 'listening' ? tx('Listening…', 'سامعاك…') : tx('Type, or tap the mic and talk', 'اكتب، أو دوس على المايك واتكلم')}
            aria-label={tx('Message to Tera', 'رسالة لتيرا')} />
          {draft.trim() && mic.state === 'idle' && (
            <button className="icon tera-send" onClick={() => submit()} disabled={busy} aria-label={tx('Send', 'إرسال')}><Send size={17} /></button>
          )}
          {mic.available && (
            <button
              className={`tera-mic ${mic.state} ${convo ? 'convo' : ''} ${speaking ? 'speaking' : ''}`}
              onClick={tapMic}
              onContextMenu={(e) => { e.preventDefault(); hangUp(); }}
              disabled={mic.state === 'transcribing'}
              style={mic.state === 'listening' ? { '--mic-level': mic.level } : undefined}
              aria-label={mic.state === 'listening' ? tx('Stop listening', 'كفاية') : tx('Talk to Tera', 'كلّم تيرا')}
            >
              {mic.state === 'transcribing' || busy ? <Loader2 size={22} className="spin" />
                : mic.state === 'listening' ? <Square size={18} />
                  : <Mic size={24} />}
            </button>
          )}
          {(convo || speaking) && (
            <button className="ghost sm tera-hang" onClick={hangUp}>{tx('Stop', 'خلاص')}</button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="tera-row">
      <div className="tera-row-text"><span>{label}</span>{hint && <small>{hint}</small>}</div>
      <div className="tera-row-ctl">{children}</div>
    </div>
  );
}

function Toggle({ on, set, label }) {
  return (
    <button className={`tera-toggle ${on ? 'on' : ''}`} role="switch" aria-checked={!!on} aria-label={label} onClick={() => set(!on)}>
      <span />
    </button>
  );
}

/* Her brain: the owner's own Claude key (this device only), the model and
   how hard she thinks. The key field never shows the key back in full. */
function ClaudeBrain({ t, patch }) {
  const [saved, setSaved] = useState(() => loadClaudeKey());
  const [draft, setDraft] = useState('');
  const [test, setTest] = useState(null); // null | 'busy' | {ok, ms} | {error}
  const masked = saved ? `${saved.slice(0, 10)}…${saved.slice(-4)}` : '';
  const save = () => {
    if (!looksLikeClaudeKey(draft)) { setTest({ error: tx('That does not look like an Anthropic key (sk-ant-…).', 'ده مش شكل مفتاح Anthropic (sk-ant-…).') }); return; }
    saveClaudeKey(draft); setSaved(draft.trim()); setDraft(''); setTest(null);
  };
  const run = async () => {
    setTest('busy');
    try { setTest(await testClaudeKey({ apiKey: saved, model: t.model })); }
    catch (e) { setTest({ error: e.code === 'auth' ? tx('The key was refused.', 'المفتاح اترفض.') : `${e.code || ''} ${e.message || e}` }); }
  };
  return (
    <>
      <h4>{tx('Her brain (Claude)', 'دماغها (Claude)')}</h4>
      <Row label={tx('Anthropic API key', 'مفتاح Anthropic')} hint={saved ? `${masked} · ${tx('kept on this device only', 'محفوظ على الجهاز ده بس')}` : tx('From console.anthropic.com → API keys. Kept on this device only.', 'من console.anthropic.com ← API keys. بيتحفظ على الجهاز ده بس.')}>
        <input type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: 150 }} />
        <button className="primary sm" onClick={save} disabled={!draft.trim()}>{tx('Save', 'احفظ')}</button>
      </Row>
      {saved && (
        <Row label={tx('Check the key', 'جرّب المفتاح')} hint={test === 'busy' ? tx('Asking Claude…', 'بسأل Claude…') : test?.error ? test.error : test?.ok ? tx(`Working · ${test.ms} ms`, `شغال · ${test.ms} م.ث`) : ''}>
          <button className="ghost sm" onClick={run} disabled={test === 'busy'}>{tx('Test', 'جرّب')}</button>
          <button className="ghost sm" onClick={() => { saveClaudeKey(''); setSaved(''); setTest(null); }}>{tx('Remove', 'امسحه')}</button>
        </Row>
      )}
      <Row label={tx('Model', 'الموديل')}>
        <select value={t.model} onChange={(e) => patch({ model: e.target.value })}>
          {CLAUDE_MODELS.map((m) => <option key={m.id} value={m.id}>{tx(m.en, m.ar)}</option>)}
        </select>
      </Row>
      <Row label={tx('Thinking', 'التفكير')} hint={tx('Low answers fastest; high is for big reorganisations.', 'القليل أسرع رد؛ العالي للترتيبات الكبيرة.')}>
        <select value={t.effort} onChange={(e) => patch({ effort: e.target.value })}>
          {EFFORTS.map((x) => <option key={x} value={x}>{x === 'low' ? tx('Low', 'قليل') : x === 'medium' ? tx('Medium', 'متوسط') : tx('High', 'عالي')}</option>)}
        </select>
      </Row>
    </>
  );
}

function TeraSettings({ t, patch, native, status, refresh, onTest, onOpenOverlay, onOpenExact, onClear, onVoiceTest }) {
  useEffect(() => { refresh?.(); }, []); // eslint-disable-line
  const mins = (v) => (v >= 60 ? (v % 60 ? `${Math.floor(v / 60)}h ${v % 60}m` : tx(`${v / 60} h`, `${v / 60} س`)) : tx(`${v} min`, `${v} د`));
  const rateN = Number(String(t.rate || '+0%').replace('%', '')) || 0;
  return (
    <div className="tera-settings">
      <ClaudeBrain t={t} patch={patch} />

      <h4>{tx('How she works', 'بتشتغل إزاي')}</h4>
      <Row label={tx('Just do it', 'نفّذي على طول')} hint={tx('Apply what I ask straight away, with Undo. Off: she asks first.', 'تطبّق اللي بطلبه على طول، ومعاه «رجّعها». لو مقفولة: تسأل الأول.')}>
        <Toggle on={t.autonomous} set={(v) => patch({ autonomous: v })} label={tx('Just do it', 'نفّذي على طول')} />
      </Row>
      <Row label={tx('Speak her answers', 'تتكلم بصوت')}>
        <Toggle on={t.speakReplies} set={(v) => patch({ speakReplies: v })} label={tx('Speak her answers', 'تتكلم بصوت')} />
      </Row>
      <Row label={tx('Hands-free', 'من غير إيدين')} hint={tx('After she answers, she listens again.', 'بعد ما ترد، تسمعك تاني.')}>
        <Toggle on={t.handsFree} set={(v) => patch({ handsFree: v })} label={tx('Hands-free', 'من غير إيدين')} />
      </Row>

      <h4>{tx('Voice', 'الصوت')}</h4>
      <Row label={tx('Arabic', 'عربي')}>
        <select value={t.voiceAr} onChange={(e) => patch({ voiceAr: e.target.value })}>
          {TERA_VOICES.ar.map((v) => <option key={v.id} value={v.id}>{tx(v.en, v.ar)}</option>)}
        </select>
        <button className="ghost sm" onClick={() => onVoiceTest('ar')}><Volume2 size={13} /></button>
      </Row>
      <Row label={tx('English', 'إنجليزي')}>
        <select value={t.voiceEn} onChange={(e) => patch({ voiceEn: e.target.value })}>
          {TERA_VOICES.en.map((v) => <option key={v.id} value={v.id}>{tx(v.en, v.ar)}</option>)}
        </select>
        <button className="ghost sm" onClick={() => onVoiceTest('en')}><Volume2 size={13} /></button>
      </Row>
      <Row label={tx('Speed', 'السرعة')} hint={`${rateN > 0 ? '+' : ''}${rateN}%`}>
        <input type="range" min={-20} max={30} step={5} value={rateN} onChange={(e) => { const n = Number(e.target.value); patch({ rate: `${n >= 0 ? '+' : ''}${n}%` }); }} />
      </Row>

      <h4>{tx('Checking on you', 'السؤال عليك')}{!native && <small className="tera-phone-only"> · {tx('phone app only', 'في تطبيق الموبايل بس')}</small>}</h4>
      <Row label={tx('Pop up when I go quiet', 'تظهر لما أسكت')} hint={tx('Nothing ticked off for…', 'مفيش حاجة خلصت بقالها…')}>
        <Toggle on={t.nag} set={(v) => patch({ nag: v })} label={tx('Pop up when I go quiet', 'تظهر لما أسكت')} />
        <select value={t.nagMin} disabled={!t.nag} onChange={(e) => patch({ nagMin: Number(e.target.value) })}>
          {[60, 90, 120, 150, 180, 240].map((v) => <option key={v} value={v}>{mins(v)}</option>)}
        </select>
      </Row>
      <Row label={tx('…then again every', '…وبعدها كل')}>
        <select value={t.repeatMin} disabled={!t.nag} onChange={(e) => patch({ repeatMin: Number(e.target.value) })}>
          {[30, 45, 60, 90, 120].map((v) => <option key={v} value={v}>{mins(v)}</option>)}
        </select>
      </Row>
      <Row label={tx('Ask about appointments', 'تسأل على المواعيد')} hint={tx('Timed tasks and calendar events, with push-back buttons.', 'المهام اللي ليها ميعاد وأحداث التقويم، ومعاها زراير التأجيل.')}>
        <Toggle on={t.appts} set={(v) => patch({ appts: v })} label={tx('Ask about appointments', 'تسأل على المواعيد')} />
        <select value={t.leadMin} disabled={!t.appts} onChange={(e) => patch({ leadMin: Number(e.target.value) })}>
          {[0, 5, 10, 15, 30, 45, 60].map((v) => <option key={v} value={v}>{v === 0 ? tx('at start', 'في ميعاده') : tx(`${v} min before`, `قبلها بـ${v} د`)}</option>)}
        </select>
      </Row>
      <Row label={tx('Quiet hours', 'ساعات الهدوء')} hint={tx('She never pops up in between.', 'مش هتظهر خالص في الوقت ده.')}>
        <input type="time" value={t.quietFrom} onChange={(e) => isHM(e.target.value) && patch({ quietFrom: e.target.value })} />
        <span className="tera-dash">–</span>
        <input type="time" value={t.quietTo} onChange={(e) => isHM(e.target.value) && patch({ quietTo: e.target.value })} />
      </Row>
      <Row label={tx('Read pop-ups aloud', 'تقول الرسايل بصوت')} hint={tx('Only when the ringer is on.', 'لما الرنة شغالة بس.')}>
        <Toggle on={t.speakPopups} set={(v) => patch({ speakPopups: v })} label={tx('Read pop-ups aloud', 'تقول الرسايل بصوت')} />
      </Row>

      {native && (
        <>
          <h4>{tx('On this phone', 'على الموبايل ده')}</h4>
          <Row label={tx('Show over other apps', 'تظهر فوق التطبيقات')} hint={status?.overlay ? tx('Allowed — her face pops up.', 'مسموح — وشها بيظهر.') : tx('Not allowed — she falls back to notifications.', 'مش مسموح — هتبعت إشعارات بدالها.')}>
            {status?.overlay ? <CheckCircle2 size={16} className="tera-ok" /> : <button className="primary sm" onClick={onOpenOverlay}>{tx('Allow', 'اسمح')}</button>}
          </Row>
          <Row label={tx('Exact alarms', 'منبهات دقيقة')}>
            {status?.exactAlarm ? <CheckCircle2 size={16} className="tera-ok" /> : <button className="primary sm" onClick={onOpenExact}>{tx('Allow', 'اسمح')}</button>}
          </Row>
          {status?.nextAt > 0 && <p className="hint-text">{tx('Next check-in', 'السؤال الجاي')}: {fmtClock(status.nextAt)}</p>}
          <div className="tera-tests">
            <button className="ghost sm" onClick={() => onTest('nag')}>{tx('Try a pop-up', 'جرّب رسالة')}</button>
            <button className="ghost sm" onClick={() => onTest('appt')}>{tx('Try an appointment', 'جرّب ميعاد')}</button>
          </div>
        </>
      )}
      <div className="tera-tests">
        <button className="ghost sm" onClick={onClear}>{tx('Clear the conversation', 'امسح الكلام')}</button>
      </div>
    </div>
  );
}
