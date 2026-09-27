/* ------------------------------------------------------------------ */
/*  The filter bar, shared by every view that lists work.              */
/*                                                                     */
/*  Collapsed to a single button until something is on, because most    */
/*  of the time nothing is filtered and a permanent row of every label  */
/*  and project would cost more screen than it earns. Once a filter IS  */
/*  on it stays visible as a chip — a hidden filter is how a page ends  */
/*  up looking empty for no apparent reason.                            */
/* ------------------------------------------------------------------ */
import React, { useState } from 'react';
import { ArrowDownUp, Filter, X } from 'lucide-react';
import { clear, describeFilter, isFiltering, toggle } from './filters.js';
import { tx } from './core.jsx';

const SORT_LABEL = {
  manual: () => tx('Manual', 'يدوي'),
  date: () => tx('Date', 'التاريخ'),
  title: () => tx('Title', 'الاسم'),
  recent: () => tx('Recent', 'الأحدث'),
  tag: () => tx('Tag', 'الوسم'),
  project: () => tx('Project', 'المشروع'),
};

export function FilterBar({ filter, onChange, labels = [], projects = [], sorts = ['manual'], compact = false }) {
  const [open, setOpen] = useState(false);
  const on = isFiltering(filter);
  /* Finished projects are left out of the picker — except one the filter is
     still holding. That used to be the trap: filter on a project, complete
     it, and the filter went on hiding every task while its chip had no name
     and no toggle left to switch it off. The desktop app never restarts, so
     an in-memory filter like that could sit there for days. */
  const held = new Set(filter.projects || []);
  const live = projects.filter((p) => !p.completedAt || held.has(p.id));

  const summary = describeFilter(filter, {
    labelName: (id) => (labels.find((l) => l.id === id) || {}).name || tx('a deleted tag', 'وسم محذوف'),
    projectName: (id) => (projects.find((p) => p.id === id) || {}).name || tx('a deleted project', 'مشروع محذوف'),
  });

  return (
    <div className={`fbar ${compact ? 'compact' : ''}`}>
      <button className={`fbar-btn ${on ? 'on' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Filter size={14} />
        {on ? (summary || tx('Filtered', 'مُصفّى')) : tx('Filter', 'تصفية')}
      </button>

      {on && (
        <button className="fbar-clear" onClick={() => onChange(clear(filter))} aria-label={tx('Clear filter', 'مسح التصفية')}>
          <X size={13} />
        </button>
      )}

      {sorts.length > 1 && (
        <span className="fbar-sort">
          <ArrowDownUp size={13} />
          <select value={filter.sort} onChange={(e) => onChange({ ...filter, sort: e.target.value })}
            aria-label={tx('Sort by', 'الترتيب حسب')}>
            {sorts.map((s) => <option key={s} value={s}>{(SORT_LABEL[s] || (() => s))()}</option>)}
          </select>
        </span>
      )}

      {open && (
        <div className="fbar-panel">
          {live.length > 0 && (
            <>
              <div className="fbar-h">{tx('Projects', 'المشاريع')}</div>
              <div className="fbar-chips">
                {live.map((p) => (
                  <button key={p.id} className={`fchip ${(filter.projects || []).includes(p.id) ? 'on' : ''}`}
                    style={{ '--fcolour': p.color }} onClick={() => onChange(toggle(filter, 'projects', p.id))}>
                    <span className="fchip-dot" />{p.name}
                  </button>
                ))}
              </div>
            </>
          )}
          {labels.length > 0 && (
            <>
              <div className="fbar-h">{tx('Tags', 'الوسوم')}</div>
              <div className="fbar-chips">
                {labels.map((l) => (
                  <button key={l.id} className={`fchip ${(filter.labels || []).includes(l.id) ? 'on' : ''}`}
                    style={{ '--fcolour': l.color }} onClick={() => onChange(toggle(filter, 'labels', l.id))}>
                    <span className="fchip-dot" />{l.name}
                  </button>
                ))}
              </div>
            </>
          )}
          {!live.length && !labels.length && (
            <p className="hint-text" style={{ margin: 0 }}>{tx('No tags or projects yet.', 'لا وسوم أو مشاريع بعد.')}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default FilterBar;
