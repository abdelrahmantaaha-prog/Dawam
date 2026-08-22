/* ------------------------------------------------------------------ */
/*  Calendar — the parts you can see.                                   */
/*                                                                      */
/*  Two ways to connect, and which ones are offered depends on where     */
/*  the app is running rather than on what would be nicest:              */
/*                                                                      */
/*    A feed address works everywhere. Google calls it the "secret       */
/*    address in iCal format"; it never expires, so it is authorise-once */
/*    by construction, which is the whole requirement.                   */
/*                                                                      */
/*    Signing in properly is offered only on the desktop, because only   */
/*    the shell can hold a refresh token. In a browser the token dies    */
/*    after an hour and the day gets interrupted to consent again —      */
/*    which is exactly what this was not allowed to do.                  */
/*                                                                      */
/*  Read-only, both of them. Rhythm never writes to your calendar.       */
/* ------------------------------------------------------------------ */

import React, { useState, useEffect } from 'react';
import { Calendar, Plus, Trash2, RefreshCw, Check, AlertCircle, Loader2, Link as LinkIcon, ShieldAlert } from 'lucide-react';
import { tx, fmtTime, pad } from './core.jsx';
import { newFeed, normalizeFeedUrl, feedLooksSecret } from './calsync.js';

const bridge = () => (typeof window !== 'undefined' && window.rhythmFocus && window.rhythmFocus.calendar) || null;

const clockOf = (ms) => { const d = new Date(ms); return fmtTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`); };

/* The error names the transports throw, said in a way that points at what the
   person can actually do about it. */
function explain(code) {
  const map = {
    'host-not-allowed': tx('That host is not one Rhythm will fetch from. Google, iCloud, Outlook and Fastmail feeds work.', 'هذا المضيف ليس ضمن ما يجلبه ريذم. تعمل تغذيات جوجل وآي كلاود وأوتلوك وفاست ميل.'),
    'https-only': tx('The address has to be https.', 'يجب أن يكون العنوان https.'),
    'not-a-calendar': tx('That address answered with a page, not a calendar — check you copied the iCal link and not the calendar page.', 'ردّ هذا العنوان بصفحة لا بتقويم — تأكد أنك نسخت رابط iCal لا صفحة التقويم.'),
    'bad-url': tx('That does not look like a web address.', 'لا يبدو هذا عنوانًا صحيحًا.'),
    'timeout': tx('The calendar server took too long.', 'استغرق خادم التقويم وقتًا طويلًا.'),
    'not-connected': tx('Not signed in to Google yet.', 'لم يتم تسجيل الدخول إلى جوجل بعد.'),
    'google-needs-desktop': tx('This calendar was added on the desktop app and only refreshes there.', 'أُضيف هذا التقويم من تطبيق سطح المكتب ويُحدَّث هناك فقط.'),
    'local-address': tx('That address points back at this machine.', 'يشير هذا العنوان إلى هذا الجهاز نفسه.'),
  };
  if (map[code]) return map[code];
  if (/^upstream-40[13]$/.test(code || '')) return tx('The calendar server refused that address — it may have been reset.', 'رفض خادم التقويم هذا العنوان — ربما أُعيد ضبطه.');
  if (/^upstream-404$/.test(code || '')) return tx('No calendar at that address.', 'لا يوجد تقويم على هذا العنوان.');
  return code || tx('Could not read that calendar.', 'تعذّرت قراءة هذا التقويم.');
}

export function CalendarSettings({ feeds, onFeedsChange, report, onRefresh, refreshing, calSettings, onCalSettings }) {
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');
  const desktop = !!bridge();
  const cs = calSettings || {};

  const [google, setGoogle] = useState({ connected: false, protectedStore: false });
  const [googleCals, setGoogleCals] = useState(null);
  const [googleBusy, setGoogleBusy] = useState('');

  useEffect(() => {
    if (!desktop) return;
    bridge().status().then(setGoogle, () => {});
  }, [desktop]);

  const add = async () => {
    const clean = normalizeFeedUrl(url);
    if (!clean) return;
    if (feeds.some((f) => f.url === clean)) { setErr(tx('That calendar is already here.', 'هذا التقويم مضاف بالفعل.')); return; }
    setAdding(true); setErr('');
    const feed = newFeed(clean);
    const next = [...feeds, feed];
    await onFeedsChange(next);
    const rep = await onRefresh(next, { force: true });
    const mine = (rep || []).find((r) => r.id === feed.id);
    if (mine && mine.ok === false) setErr(explain(mine.error));
    else setUrl('');
    setAdding(false);
  };

  const remove = async (id) => onFeedsChange(feeds.filter((f) => f.id !== id));
  const toggle = async (id) => {
    const next = feeds.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f));
    await onFeedsChange(next);
    onRefresh(next, { force: false });
  };

  const connectGoogle = async () => {
    setGoogleBusy(tx('Waiting for your browser…', 'في انتظار المتصفح…'));
    const r = await bridge().authorize(cs.googleClientId || '', cs.googleClientSecret || '');
    setGoogleBusy('');
    if (!r || !r.ok) { setErr(explain(r && r.error)); return; }
    setGoogle(await bridge().status());
    loadGoogleCals();
  };

  const loadGoogleCals = async () => {
    setGoogleBusy(tx('Reading your calendars…', 'قراءة تقاويمك…'));
    const r = await bridge().listCalendars();
    setGoogleBusy('');
    if (!r || !r.ok) { setErr(explain(r && r.error)); return; }
    setGoogleCals(r.calendars);
  };

  const addGoogleCal = async (c) => {
    if (feeds.some((f) => f.kind === 'google' && f.calendarId === c.id)) return;
    const feed = { id: `g:${c.id}`, kind: 'google', calendarId: c.id, name: c.name, enabled: true, addedAt: Date.now() };
    const next = [...feeds, feed];
    await onFeedsChange(next);
    onRefresh(next, { force: true });
  };

  const disconnectGoogle = async () => {
    await bridge().disconnect();
    setGoogle(await bridge().status());
    setGoogleCals(null);
    await onFeedsChange(feeds.filter((f) => f.kind !== 'google'));
  };

  const reportFor = (id) => (report || []).find((r) => r.id === id);

  return (
    <>
      <div className="sect">
        <div className="sect-h"><Calendar size={13} /> {tx('Calendars', 'التقاويم')}</div>
        <p className="hint-text">
          {tx('Read-only. Everything on them becomes time the planner will not schedule over.',
            'للقراءة فقط. كل ما فيها يصبح وقتًا لن يجدول عليه المخطط.')}
        </p>

        {feeds.length > 0 && (
          <div className="cal-list">
            {feeds.map((f) => {
              const r = reportFor(f.id);
              return (
                <div key={f.id} className={`cal-row ${f.enabled ? '' : 'off'}`}>
                  <label className="cal-on">
                    <input type="checkbox" checked={!!f.enabled} onChange={() => toggle(f.id)} />
                  </label>
                  <span className="cal-name">
                    {f.name || (r && r.calName) || (f.kind === 'google' ? tx('Google calendar', 'تقويم جوجل') : tx('Calendar', 'تقويم'))}
                    <small>
                      {f.kind === 'google'
                        ? tx('Google · signed in', 'جوجل · مسجّل الدخول')
                        : tx('Feed address', 'عنوان تغذية')}
                      {r && r.ok === false ? ` · ${explain(r.error)}` : ''}
                      {r && r.count != null ? tx(` · ${r.count} events`, ` · ${r.count} حدثًا`) : ''}
                    </small>
                  </span>
                  <button className="tpl-act" onClick={() => remove(f.id)} aria-label={tx('Remove', 'إزالة')}><Trash2 size={14} /></button>
                </div>
              );
            })}
          </div>
        )}

        <div className="cal-add">
          <input
            value={url}
            onChange={(e) => { setUrl(e.target.value); setErr(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder={tx('Paste a calendar feed address (…/basic.ics)', 'الصق عنوان تغذية التقويم (…/basic.ics)')}
            aria-label={tx('Calendar feed address', 'عنوان تغذية التقويم')}
          />
          <button className="primary sm" onClick={add} disabled={adding || !url.trim()}>
            {adding ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} {tx('Add', 'أضف')}
          </button>
        </div>
        {err && <p className="hint-text" style={{ color: '#B23A3A' }}><AlertCircle size={12} /> {err}</p>}

        {feedLooksSecret(url) && (
          <p className="hint-text"><ShieldAlert size={12} /> {tx(
            'That is a secret address: anyone who has it can read this calendar. It is stored with your data and travels with your account sync.',
            'هذا عنوان سري: أي شخص يملكه يستطيع قراءة هذا التقويم. يُحفظ مع بياناتك وينتقل مع مزامنة حسابك.')}</p>
        )}

        <p className="hint-text">
          {tx('In Google Calendar: Settings → your calendar → Integrate calendar → "Secret address in iCal format".',
            'في تقويم جوجل: الإعدادات ← تقويمك ← دمج التقويم ← «العنوان السري بتنسيق iCal».')}
        </p>

        {feeds.length > 0 && (
          <button className="ghost sm" onClick={() => onRefresh(feeds, { force: true })} disabled={refreshing}>
            {refreshing ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {tx('Refresh now', 'حدّث الآن')}
          </button>
        )}
      </div>

      {desktop && (
        <div className="sect">
          <div className="sect-h"><LinkIcon size={13} /> {tx('Sign in to Google', 'تسجيل الدخول بجوجل')}</div>
          {google.connected ? (
            <>
              <p className="hint-text"><Check size={12} /> {tx('Connected. The desktop app holds a refresh token, so this stays signed in.', 'متصل. يحتفظ تطبيق سطح المكتب برمز تحديث، لذا يبقى تسجيل الدخول قائمًا.')}
                {google.protectedStore
                  ? tx(' The token is kept in the system keychain.', ' يُحفظ الرمز في مخزن مفاتيح النظام.')
                  : tx(' The system keychain was unavailable, so the token is stored as plain text.', ' مخزن مفاتيح النظام غير متاح، لذا يُحفظ الرمز كنص عادي.')}
              </p>
              <div className="cal-actions">
                <button className="ghost sm" onClick={loadGoogleCals} disabled={!!googleBusy}>{tx('Choose calendars', 'اختر التقاويم')}</button>
                <button className="danger" onClick={disconnectGoogle}>{tx('Disconnect', 'قطع الاتصال')}</button>
              </div>
              {googleCals && (
                <div className="cal-list">
                  {googleCals.map((c) => {
                    const already = feeds.some((f) => f.kind === 'google' && f.calendarId === c.id);
                    return (
                      <div key={c.id} className="cal-row">
                        <span className="cal-name">{c.name}<small>{c.primary ? tx('Main calendar', 'التقويم الرئيسي') : ''}</small></span>
                        <button className="ghost sm" onClick={() => addGoogleCal(c)} disabled={already}>
                          {already ? <Check size={13} /> : <Plus size={13} />} {already ? tx('Added', 'مضاف') : tx('Add', 'أضف')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="hint-text">
                {tx('This needs an OAuth client of your own — Google Cloud Console → Credentials → Create client → Desktop app. Rhythm asks only for read access to your calendars.',
                  'يتطلب هذا عميل OAuth خاصًا بك — Google Cloud Console ← بيانات الاعتماد ← إنشاء عميل ← تطبيق سطح مكتب. يطلب ريذم صلاحية القراءة فقط.')}
              </p>
              <input className="cal-input" value={cs.googleClientId || ''} onChange={(e) => onCalSettings({ googleClientId: e.target.value.trim() })}
                placeholder={tx('Client ID', 'معرّف العميل')} aria-label={tx('Google client ID', 'معرّف عميل جوجل')} />
              <input className="cal-input" value={cs.googleClientSecret || ''} onChange={(e) => onCalSettings({ googleClientSecret: e.target.value.trim() })}
                placeholder={tx('Client secret', 'سر العميل')} aria-label={tx('Google client secret', 'سر عميل جوجل')} />
              <button className="primary sm" onClick={connectGoogle} disabled={!!googleBusy || !(cs.googleClientId || '').trim()}>
                {googleBusy ? <Loader2 size={14} className="spin" /> : <LinkIcon size={14} />} {tx('Connect', 'اتصل')}
              </button>
              {googleBusy && <p className="hint-text">{googleBusy}</p>}
            </>
          )}
        </div>
      )}

      <div className="sect">
        <div className="sect-h">{tx('How the day is planned around them', 'كيف يُخطَّط اليوم حولها')}</div>
        <label className="toggle">
          <input type="checkbox" checked={cs.includeAllDay === true} onChange={(e) => onCalSettings({ includeAllDay: e.target.checked })} />
          <span>{tx('All-day events block the whole day', 'الأحداث اليومية تحجز اليوم كله')}</span>
        </label>
        <p className="hint-text">{tx('Off by default: "Ali\'s birthday" is a note on the day, not a claim on its hours.', 'معطّل افتراضيًا: «عيد ميلاد علي» ملاحظة على اليوم لا حجزًا لساعاته.')}</p>

        <div className="sect-h" style={{ marginTop: 12 }}>{tx('Keep free for the prayer itself', 'اترك وقتًا للصلاة نفسها')}</div>
        <div className="seg time-seg">
          {[0, 10, 15, 20, 30].map((m) => (
            <button key={m} className={(cs.prayerReserveMin ?? 15) === m ? 'on' : ''} onClick={() => onCalSettings({ prayerReserveMin: m })}>
              {m === 0 ? tx('Off', 'إيقاف') : `${m}m`}
            </button>
          ))}
        </div>
        <p className="hint-text">
          {tx('The blocks already start at the adhan — this stops a task being slotted into the minute it sounds.',
            'تبدأ الفترات عند الأذان أصلًا — وهذا يمنع جدولة مهمة في اللحظة التي يُرفع فيها.')}
        </p>
      </div>
    </>
  );
}

/* The day's events, read-only, so the person can see what the plan bent
   around. Shown wherever the day is shown — not a calendar of its own. */
export function DayEvents({ events, compact = false }) {
  if (!events || !events.length) return null;
  return (
    <div className={`cal-agenda ${compact ? 'compact' : ''}`}>
      {events.map((e, i) => (
        <div key={`${e.uid}-${i}`} className="cal-event">
          <span className="cal-when">
            {e.allDay ? tx('All day', 'طوال اليوم') : `${clockOf(e.startMs)}–${clockOf(e.endMs)}`}
          </span>
          <span className="cal-what">{e.summary || tx('(busy)', '(مشغول)')}</span>
        </div>
      ))}
    </div>
  );
}
