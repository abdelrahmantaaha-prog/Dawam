/* ------------------------------------------------------------------ */
/*  The calendar view — Day, Week, Month.                              */
/*                                                                     */
/*  Dawam's own day is six prayer-anchored periods, not a column of    */
/*  hours, and that stays the way the Plan page works. This is the      */
/*  other thing a planner needs: seeing where the hours actually go,    */
/*  with meetings and slotted tasks in one grid, because a task that    */
/*  looks fine in "Morning" may be sitting on top of a call.            */
/*                                                                     */
/*  Feeds are read-only and stay that way. The one thing that CAN be    */
/*  written about a calendar entry is which project it belongs to, and  */
/*  that is Dawam's own note kept in Dawam's own storage.             */
/* ------------------------------------------------------------------ */
import React, { useMemo, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Target, X } from 'lucide-react';
import {
  addDays, fmtISO, fmtTime, mon, pad, sameDay, tx, wd, wdFull,
  minutesOf, tStartMin, tEndMin,
} from './core.jsx';
import { MODES, layoutDay, monthGrid, rangeOf, step, taskToSpan, weekDates } from './calgrid.js';
import { calSeriesKey, projectMinutes, projectOfEvent } from './calproj.js';

const HOUR_PX = 44;                 // one hour of grid
const px = (min) => (min / 60) * HOUR_PX;
const clock = (ms) => { const d = new Date(ms); return fmtTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`); };
const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

/* Minutes as a person says them: "1h 30m", "45m". */
export const humanMins = (m) => {
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r}${tx('m', 'د')}`;
  return r ? `${h}${tx('h', 'س')} ${r}${tx('m', 'د')}` : `${h}${tx('h', 'س')}`;
};

/* Everything drawable on one day, as one list, so the overlap layout sees
   meetings and tasks together — a task sitting on top of a call is exactly the
   clash worth seeing, and laying them out separately would hide it. */
function dayItems(date, events, tasks) {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayEnd = dayStart + 86400000;
  const out = [];
  for (const e of events || []) {
    if (e.allDay) continue;
    if (e.endMs <= dayStart || e.startMs >= dayEnd) continue;
    out.push({ kind: 'event', ev: e, startMs: e.startMs, endMs: e.endMs });
  }
  for (const t of tasks || []) {
    const sp = taskToSpan(t, date, minutesOf, tStartMin, tEndMin);
    if (sp) out.push({ kind: 'task', task: t, startMs: sp.startMs, endMs: sp.endMs });
  }
  return { dayStart, items: out };
}

const allDayOn = (date, events) => {
  const s = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const e = s + 86400000;
  return (events || []).filter((x) => x.allDay && x.endMs > s && x.startMs < e);
};

/* ---- one column of hours ---- */

function DayColumn({ date, events, tasks, projects, calProjects, onPick, showNow }) {
  const { dayStart, items } = dayItems(date, events, tasks);
  const laid = useMemo(() => layoutDay(items, dayStart), [items, dayStart]);
  const now = new Date();
  const nowMin = showNow && sameDay(now, date) ? now.getHours() * 60 + now.getMinutes() : null;

  return (
    <div className="calv-col" style={{ height: px(1440) }}>
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} className="calv-hourline" style={{ top: px(h * 60) }} />
      ))}
      {nowMin != null && <div className="calv-now" style={{ top: px(nowMin) }} />}
      {laid.map((p, i) => {
        const isTask = p.item.kind === 'task';
        const pid = isTask ? p.item.task.projectRef : projectOfEvent(calProjects, p.item.ev);
        const proj = pid ? (projects || []).find((x) => x.id === pid) : null;
        const label = isTask ? p.item.task.title : (p.item.ev.summary || tx('(busy)', '(مشغول)'));
        // The times live on the item, not on the layout box — layoutDay returns
        // geometry (top/height/columns) and carries the original through as
        // `item`. Reading p.startMs here printed NaN:NaN in every box.
        const { startMs, endMs } = p.item;
        // Half an hour is ~22px: a title and a clock stacked in that do not
        // fit, and the title is the part worth keeping.
        const roomForClock = p.height >= 40;
        return (
          <button
            key={i}
            type="button"
            className={`calv-item ${isTask ? 'task' : 'event'}${p.item.task?.done ? ' done' : ''}`}
            style={{
              top: px(p.top), height: Math.max(16, px(p.height)),
              insetInlineStart: `calc(${p.left * 100}% + 2px)`,
              width: `calc(${p.width * 100}% - 4px)`,
              ...(proj ? { borderInlineStartColor: proj.color } : null),
            }}
            onClick={() => onPick && onPick(p.item)}
            title={`${label} · ${clock(startMs)}–${clock(endMs)}${proj ? ` · ${proj.name}` : ''}`}
          >
            <span className="calv-item-t">{label}</span>
            {roomForClock && <span className="calv-item-w">{clock(startMs)}</span>}
            {proj && <span className="calv-item-p" style={{ background: proj.color }} />}
          </button>
        );
      })}
    </div>
  );
}

/* "2 PM", not "2:00 PM": every label is on the hour, and the long form
   wrapped onto two lines in a phone-width gutter. */
const hourLabel = (h) => fmtTime(hhmm(h * 60)).replace(/:00(?=\s*[AaPp][Mm])/, '');
const HourGutter = () => (
  <div className="calv-gutter" style={{ height: px(1440) }}>
    {Array.from({ length: 24 }, (_, h) => (
      <div key={h} className="calv-hour" style={{ top: px(h * 60) }}>{hourLabel(h)}</div>
    ))}
  </div>
);

/* Scroll the working day into view rather than opening on midnight — and,
   where the week is wider than the screen, sideways to today. */
function useScrollToMorning(ref, mode, date) {
  useEffect(() => {
    const el = ref.current;
    if (!el || mode === 'month') return;
    el.scrollTop = px(7 * 60);
    if (mode === 'week' && el.scrollWidth > el.clientWidth) {
      const today = el.querySelector('.calv-adcol.today');
      if (today) today.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }, [mode, ref, date]);
}

/* ---- the view ---- */

export function CalendarView({
  mode, date, onMode, onDate,
  events: allEvents, tasksByISO, projects, calProjects, weekStartDay = 6,
  filterBar, eventFilter, onAssign, picked, onPick,
}) {
  const scroller = useRef(null);
  useScrollToMorning(scroller, mode, date && date.getTime());
  /* Filtered once, at the top: the grid, the all-day row, the month cells and
     the totals underneath all read from this, so they cannot disagree about
     what is being shown. */
  const events = eventFilter ? (allEvents || []).filter(eventFilter) : (allEvents || []);

  const days = mode === 'day' ? [date] : mode === 'week' ? weekDates(date, weekStartDay) : [];
  const cells = mode === 'month' ? monthGrid(date, weekStartDay) : [];
  const [fromMs, toMs] = rangeOf(mode, date, weekStartDay);

  /* Time per project over exactly the range on screen, so the figure under the
     grid always describes what is above it. */
  const totals = useMemo(() => {
    const mins = projectMinutes(events, calProjects, fromMs, toMs);
    return Object.entries(mins)
      .map(([id, m]) => ({ project: (projects || []).find((p) => p.id === id), minutes: m }))
      .filter((r) => r.project)
      .sort((a, b) => b.minutes - a.minutes);
  }, [events, calProjects, fromMs, toMs, projects]);

  const title = mode === 'month'
    ? `${mon(date.getMonth())} ${date.getFullYear()}`
    : mode === 'week'
      ? (() => { const w = weekDates(date, weekStartDay); return `${mon(w[0].getMonth())} ${w[0].getDate()} – ${mon(w[6].getMonth())} ${w[6].getDate()}`; })()
      : `${wdFull(date.getDay())} ${date.getDate()} ${mon(date.getMonth())}`;

  const eventsFor = (d) => {
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const e = s + 86400000;
    return (events || []).filter((x) => x.endMs > s && x.startMs < e);
  };

  return (
    <div className="calv">
      <div className="calv-head">
        <div className="calv-nav">
          <button className="icon" onClick={() => onDate(step(mode, date, -1))} aria-label={tx('Previous', 'السابق')}><ChevronLeft size={18} /></button>
          <strong className="calv-title">{title}</strong>
          <button className="icon" onClick={() => onDate(step(mode, date, 1))} aria-label={tx('Next', 'التالي')}><ChevronRight size={18} /></button>
          <button className="ghost sm" onClick={() => onDate(new Date())}>{tx('Today', 'اليوم')}</button>
        </div>
        {filterBar}
        <div className="seg calv-modes">
          {MODES.map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => onMode(m)}>
              {m === 'day' ? tx('Day', 'يوم') : m === 'week' ? tx('Week', 'أسبوع') : tx('Month', 'شهر')}
            </button>
          ))}
        </div>
      </div>

      {mode === 'month' ? (
        <div className="calv-month">
          {weekDates(date, weekStartDay).map((d, i) => (
            <div key={i} className="calv-mhead">{wd(d.getDay())}</div>
          ))}
          {cells.map((c) => {
            const list = eventsFor(c.date);
            const tasks = (tasksByISO || {})[c.iso] || [];
            return (
              <button
                key={c.iso}
                type="button"
                className={`calv-cell${c.inMonth ? '' : ' out'}${sameDay(c.date, new Date()) ? ' today' : ''}`}
                onClick={() => { onDate(c.date); onMode('day'); }}
              >
                <span className="calv-cell-n">{c.date.getDate()}</span>
                <span className="calv-chips">
                  {list.slice(0, 3).map((e, i) => {
                    const pid = projectOfEvent(calProjects, e);
                    const proj = pid ? (projects || []).find((x) => x.id === pid) : null;
                    return (
                      <span key={i} className="calv-chip" style={proj ? { borderInlineStartColor: proj.color } : null}>
                        {e.allDay ? '' : `${clock(e.startMs)} `}{e.summary || tx('(busy)', '(مشغول)')}
                      </span>
                    );
                  })}
                  {list.length > 3 && <span className="calv-more">+{list.length - 3}</span>}
                  {!!tasks.length && <span className="calv-tcount">{tasks.length} {tx('tasks', 'مهام')}</span>}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        /* One scroller for both directions: the day headers stick to the top
           and the hour gutter to the side, so on a phone the week can scroll
           sideways at a readable column width instead of being squeezed to
           seven 36px slivers. */
        <div className={`calv-scroll ${mode}`} ref={scroller}>
          <div className="calv-alldays">
            <div className="calv-gutter-h" />
            {days.map((d, i) => {
              const ad = allDayOn(d, events);
              return (
                <div key={i} className={`calv-adcol${sameDay(d, new Date()) ? ' today' : ''}`}>
                  <button type="button" className="calv-dayhead" onClick={() => { onDate(d); onMode('day'); }}>
                    <span className="calv-dh-w">{wd(d.getDay())}</span>
                    <span className="calv-dh-n">{d.getDate()}</span>
                  </button>
                  {ad.map((e, j) => <span key={j} className="calv-adchip">{e.summary || tx('(all day)', '(طوال اليوم)')}</span>)}
                  {/* Untimed tasks have no hour to sit at, so they were not on
                      this view at all. They line up here, in the order the
                      sort picker chose. */}
                  {(() => {
                    const loose = ((tasksByISO || {})[fmtISO(d)] || []).filter((t) => tStartMin(t) == null);
                    const cap = mode === 'day' ? 12 : 3;
                    return (<>
                      {loose.slice(0, cap).map((t) => (
                        <span key={t.id} className={`calv-adchip task${t.done ? ' done' : ''}`} title={t.title}>{t.title}</span>
                      ))}
                      {loose.length > cap && <span className="calv-more">+{loose.length - cap}</span>}
                    </>);
                  })()}
                </div>
              );
            })}
          </div>
            <div className="calv-grid">
              <HourGutter />
              {days.map((d, i) => (
                <DayColumn
                  key={i}
                  date={d}
                  events={events}
                  tasks={(tasksByISO || {})[fmtISO(d)] || []}
                  projects={projects}
                  calProjects={calProjects}
                  onPick={onPick}
                  showNow
                />
              ))}
            </div>
        </div>
      )}

      {!!totals.length && (
        <div className="calv-totals">
          <span className="calv-tot-h">{tx('Calendar time by project', 'وقت التقويم حسب المشروع')}</span>
          {totals.map((r) => (
            <span key={r.project.id} className="calv-tot">
              <span className="calv-dot" style={{ background: r.project.color }} />
              {r.project.name} · {humanMins(r.minutes)}
            </span>
          ))}
        </div>
      )}

      {picked && picked.kind === 'event' && (
        <AssignSheet
          ev={picked.ev}
          projects={projects}
          current={projectOfEvent(calProjects, picked.ev)}
          onAssign={onAssign}
          onClose={() => onPick(null)}
        />
      )}
    </div>
  );
}

/* Filing one entry. Says plainly that it files the whole series, because that
   is a bigger action than the tap suggests. */
function AssignSheet({ ev, projects, current, onAssign, onClose }) {
  const key = calSeriesKey(ev);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head plain">
          <strong><Target size={15} /> {tx('File under a project', 'أسنِد إلى مشروع')}</strong>
          <button className="icon" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="calv-ev-t">{ev.summary || tx('(busy)', '(مشغول)')}</p>
          <p className="hint-text">
            {ev.allDay ? tx('All day', 'طوال اليوم') : `${clock(ev.startMs)}–${clock(ev.endMs)}`}
            {' · '}
            {tx('The calendar itself is never changed — this is Dawam’s own note, and it files every occurrence of this entry.',
              'لا يُعدَّل التقويم نفسه أبدًا — هذه ملاحظة خاصة بـ«دوام»، وتُسنِد كل تكرارات هذا الموعد.')}
          </p>
          <div className="calv-picklist">
            <button className={`calv-pick${!current ? ' on' : ''}`} onClick={() => { onAssign(key, null); onClose(); }}>
              {tx('— none —', '— بدون —')}
            </button>
            {(projects || []).filter((p) => !p.completedAt).map((p) => (
              <button
                key={p.id}
                className={`calv-pick${current === p.id ? ' on' : ''}`}
                onClick={() => { onAssign(key, p.id); onClose(); }}
              >
                <span className="calv-dot" style={{ background: p.color }} />
                {p.name}
              </button>
            ))}
          </div>
          {!(projects || []).some((p) => !p.completedAt) && (
            <p className="hint-text">{tx('No projects yet — add one under Projects first.', 'لا مشاريع بعد — أضف مشروعًا من تبويب المشاريع أولًا.')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default CalendarView;
