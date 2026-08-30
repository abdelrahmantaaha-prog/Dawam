/* ------------------------------------------------------------------ */
/*  One filter, every surface.                                         */
/*                                                                     */
/*  Plan, the board, the calendar and the notes wall all show the same  */
/*  work from different angles, so "show me only the Bugs project"      */
/*  should mean the same thing on all of them and should not have to be */
/*  set four times. The filter is held once in the app and read by      */
/*  every view.                                                        */
/*                                                                     */
/*  Sorting is NOT shared, because the orders that make sense differ:   */
/*  a board has no clock to sort by and the Plan page's manual order is */
/*  the whole point of it. Each view declares which sorts it offers and */
/*  a sort it does not know falls back to its first — so switching to a */
/*  view cannot leave it ordered by something it cannot express.        */
/* ------------------------------------------------------------------ */

export const EMPTY = { labels: [], projects: [], sort: 'manual' };

/* Sorts, and which views admit them. `manual` means "leave the order alone" —
   the caller has already put them in the order it wants. */
export const SORTS = ['manual', 'date', 'title', 'recent'];

export const isFiltering = (f) => !!(f && ((f.labels || []).length || (f.projects || []).length));

const has = (list, v) => (list || []).includes(v);

/* Toggle one value in one dimension, returning a new filter. */
export function toggle(filter, dim, id) {
  const cur = (filter && filter[dim]) || [];
  const next = has(cur, id) ? cur.filter((x) => x !== id) : [...cur, id];
  return { ...EMPTY, ...filter, [dim]: next };
}

export const clear = (filter) => ({ ...EMPTY, ...filter, labels: [], projects: [] });

/* Does one item survive the filter?
 *
 * Within a dimension the chosen values are OR — picking two labels means
 * "either". Across dimensions they are AND — a label AND a project narrows.
 * That is what people mean by ticking boxes, and the opposite (AND within a
 * dimension) would make two labels select nothing, since a task has one.
 *
 * `get` pulls the ids off whatever kind of thing this is, so the same function
 * filters tasks, board cards, calendar events and notebooks. */
export function matches(item, filter, get = {}) {
  if (!isFiltering(filter)) return true;
  const labels = filter.labels || [];
  const projects = filter.projects || [];
  if (labels.length) {
    const l = get.label ? get.label(item) : item.projectId;
    if (!has(labels, l)) return false;
  }
  if (projects.length) {
    const p = get.project ? get.project(item) : item.projectRef;
    if (!has(projects, p)) return false;
  }
  return true;
}

export const applyFilter = (items, filter, get) => (items || []).filter((i) => matches(i, filter, get));

/* Ordering. `manual` returns the list untouched — not a copy sorted by
   nothing, which would still cost a pass and could destabilise equal keys. */
export function applySort(items, sort, get = {}) {
  const list = items || [];
  if (!sort || sort === 'manual' || !SORTS.includes(sort)) return list;
  const out = [...list];
  if (sort === 'title') {
    const t = get.title || ((i) => i.title || '');
    // localeCompare so Arabic titles order sensibly rather than by code point.
    out.sort((a, b) => String(t(a)).localeCompare(String(t(b)), undefined, { sensitivity: 'base' }));
    return out;
  }
  if (sort === 'recent') {
    const r = get.recent || ((i) => i.updatedAt || 0);
    out.sort((a, b) => (Number(r(b)) || 0) - (Number(r(a)) || 0));
    return out;
  }
  // date: earliest first, and anything undated goes last rather than to 1970.
  const d = get.date || ((i) => (i.date ? new Date(i.date).getTime() : null));
  out.sort((a, b) => {
    const x = d(a), y = d(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return x - y;
  });
  return out;
}

/* A sort this view can actually express, falling back to its first. */
export const sortFor = (sort, allowed) => ((allowed || []).includes(sort) ? sort : (allowed || ['manual'])[0]);

export const arrange = (items, filter, allowed, get) =>
  applySort(applyFilter(items, filter, get), sortFor(filter && filter.sort, allowed), get);

/* What the filter is currently saying, for a chip that can be cleared. */
export function describeFilter(filter, { labelName, projectName } = {}) {
  if (!isFiltering(filter)) return '';
  const bits = [
    ...(filter.projects || []).map((id) => (projectName ? projectName(id) : id)),
    ...(filter.labels || []).map((id) => (labelName ? labelName(id) : id)),
  ].filter(Boolean);
  return bits.join(', ');
}
