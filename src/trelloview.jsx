/* ------------------------------------------------------------------ */
/*  Trello — the parts you can see.                                     */
/*                                                                      */
/*  Settings: your own API key, a token granted once with read scope,    */
/*  and which boards to watch. Nothing is imported behind your back.     */
/*                                                                      */
/*  In the day: cards that are actually due, with one button to make a   */
/*  Rhythm task out of one. The card is never touched — Rhythm has read  */
/*  access and nothing else, and two systems writing to each other is    */
/*  how you end up with four copies of everything.                       */
/* ------------------------------------------------------------------ */

import React, { useState } from 'react';
import { Trello as TrelloIcon, RefreshCw, Loader2, Check, AlertCircle, Plus, ExternalLink } from 'lucide-react';
import { tx, fmtTime, pad, fmtISO, sameDay } from './core.jsx';
import { authorizeUrl, TRELLO_KEY_URL, trelloReady, listBoards, isOverdue } from './trello.js';

function explain(code) {
  const map = {
    'not-connected': tx('Add your key and token first.', 'أضف المفتاح والرمز أولًا.'),
    'bad-credentials': tx('Trello refused that key or token — the token may have been revoked.', 'رفض ترللو المفتاح أو الرمز — ربما أُلغي الرمز.'),
    'rate-limited': tx('Trello is rate-limiting; try again in a minute.', 'ترللو يحدّ من الطلبات؛ حاول بعد دقيقة.'),
  };
  return map[code] || code || tx('Could not reach Trello.', 'تعذّر الوصول إلى ترللو.');
}

export function TrelloSettings({ trello, onChange, report, onRefresh, refreshing }) {
  const t = trello || {};
  const auth = { key: t.key || '', token: t.token || '' };
  const [boards, setBoards] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    setBusy(true); setErr('');
    try {
      setBoards(await listBoards(auth));
    } catch (e) {
      setErr(explain(e && e.message));
    }
    setBusy(false);
  };

  const toggleBoard = (id) => {
    const chosen = new Set(t.boards || []);
    chosen.has(id) ? chosen.delete(id) : chosen.add(id);
    const next = { ...t, boards: [...chosen] };
    onChange(next);
    onRefresh(next, { force: true });
  };

  return (
    <>
      <div className="sect">
        <div className="sect-h"><TrelloIcon size={13} /> {tx('Trello', 'ترللو')}</div>
        <p className="hint-text">
          {tx('Read-only. Cards with a due date show up in the day, and you decide which ones become tasks.',
            'للقراءة فقط. تظهر البطاقات ذات تاريخ الاستحقاق في اليوم، وأنت تقرر أيها يصبح مهمة.')}
        </p>

        <input className="cal-input" value={t.key || ''} onChange={(e) => onChange({ ...t, key: e.target.value.trim() })}
          placeholder={tx('API key', 'مفتاح API')} aria-label={tx('Trello API key', 'مفتاح ترللو')} />
        <p className="hint-text">
          <a href={TRELLO_KEY_URL} target="_blank" rel="noreferrer">{tx('Get a key', 'احصل على مفتاح')} <ExternalLink size={11} /></a>
          {' — '}{tx('Trello Power-Ups admin → your Power-Up → API key.', 'إدارة Power-Ups في ترللو ← تطبيقك ← مفتاح API.')}
        </p>

        <input className="cal-input" value={t.token || ''} onChange={(e) => onChange({ ...t, token: e.target.value.trim() })}
          placeholder={tx('Token', 'الرمز')} aria-label={tx('Trello token', 'رمز ترللو')} />
        {(t.key || '').trim() && (
          <p className="hint-text">
            <a href={authorizeUrl(t.key)} target="_blank" rel="noreferrer">{tx('Grant read access', 'امنح صلاحية القراءة')} <ExternalLink size={11} /></a>
            {' — '}{tx('Trello shows a token; paste it above. It is read-only and does not expire.',
              'سيعرض ترللو رمزًا؛ الصقه أعلاه. للقراءة فقط ولا ينتهي.')}
          </p>
        )}

        <div className="cal-actions">
          <button className="ghost sm" onClick={load} disabled={busy || !trelloReady(auth)}>
            {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {tx('Find my boards', 'اعرض لوحاتي')}
          </button>
          {(t.boards || []).length > 0 && (
            <button className="ghost sm" onClick={() => onRefresh(t, { force: true })} disabled={refreshing}>
              {refreshing ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {tx('Refresh cards', 'حدّث البطاقات')}
            </button>
          )}
        </div>
        {err && <p className="hint-text" style={{ color: '#B23A3A' }}><AlertCircle size={12} /> {err}</p>}

        {boards && (
          <div className="cal-list">
            {boards.length === 0 && <p className="hint-text">{tx('No open boards on this account.', 'لا توجد لوحات مفتوحة في هذا الحساب.')}</p>}
            {boards.map((b) => {
              const on = (t.boards || []).includes(b.id);
              return (
                <div key={b.id} className={`cal-row ${on ? '' : 'off'}`}>
                  <label className="cal-on"><input type="checkbox" checked={on} onChange={() => toggleBoard(b.id)} /></label>
                  <span className="cal-name">{b.name}</span>
                </div>
              );
            })}
          </div>
        )}

        {report && report.ok === false && (
          <p className="hint-text" style={{ color: '#B23A3A' }}><AlertCircle size={12} /> {explain(report.error)}</p>
        )}
        {report && report.errors && report.errors.length > 0 && (
          <p className="hint-text" style={{ color: '#B23A3A' }}>
            <AlertCircle size={12} /> {tx('Could not read: ', 'تعذّرت قراءة: ')}
            {report.errors.map((e) => e.name || e.id).join(', ')}
          </p>
        )}
        {report && report.ok && report.boards && report.boards.length > 0 && (
          <p className="hint-text"><Check size={12} /> {report.boards.map((b) => `${b.name} (${b.count})`).join(' · ')}</p>
        )}
      </div>

      <div className="sect">
        <div className="sect-h">{tx('How far ahead to look', 'إلى أي مدى ننظر')}</div>
        <div className="seg time-seg">
          {[3, 7, 14, 30].map((d) => (
            <button key={d} className={(t.withinDays ?? 14) === d ? 'on' : ''} onClick={() => onChange({ ...t, withinDays: d })}>
              {tx(`${d}d`, `${d} ي`)}
            </button>
          ))}
        </div>
        <p className="hint-text">{tx('Cards due beyond this are not shown. Overdue ones always are.', 'البطاقات المستحقة بعد هذه المدة لا تُعرض. المتأخرة تُعرض دائمًا.')}</p>
      </div>
    </>
  );
}

/* Due cards, in the day. `onAdd` makes a Rhythm task out of one — a copy, by
   the person's choice, leaving the board alone. */
export function TrelloCards({ cards, onAdd, added }) {
  if (!cards || !cards.length) return null;
  const now = Date.now();
  const dueLabel = (c) => {
    const d = new Date(c.dueMs);
    const today = new Date();
    if (sameDay(d, today)) return `${tx('today', 'اليوم')} ${fmtTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`)}`;
    return fmtISO(d).slice(5); // MM-DD is enough at a glance
  };
  return (
    <div className="trello-list">
      {cards.map((c) => (
        <div key={c.id} className={`trello-card ${isOverdue(c, now) ? 'late' : ''}`}>
          <span className="trello-due">{dueLabel(c)}</span>
          <span className="trello-title">{c.title}</span>
          <span className="trello-where">{c.list}{c.board ? ` · ${c.board}` : ''}</span>
          <button className="tpl-act" onClick={() => onAdd(c)} disabled={added && added.has(c.id)}
            aria-label={tx('Add to this day', 'أضف إلى هذا اليوم')} title={tx('Add to this day', 'أضف إلى هذا اليوم')}>
            {added && added.has(c.id) ? <Check size={14} /> : <Plus size={14} />}
          </button>
        </div>
      ))}
    </div>
  );
}
