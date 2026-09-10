/* ------------------------------------------------------------------ */
/*  When a recurring task is actually due.                             */
/*                                                                     */
/*  A recurring task used to be offered every single time you planned a */
/*  day, which is right for "make the bed" and wrong for "pay the rent" */
/*  — and a weekly chore offered seven times a week is how a person     */
/*  learns to click Skip without reading. So a recurrence now carries a */
/*  schedule, and "Plan the day" only offers what the schedule says is  */
/*  due on the day being planned.                                      */
/*                                                                     */
/*  Three kinds, and nothing more, because a fourth would need a UI     */
/*  nobody would learn:                                                 */
/*                                                                     */
/*    daily     every day. The default, and what every existing         */
/*              recurring task migrates to — an upgrade must not        */
/*              silently stop offering work someone relies on.          */
/*    weekly    on the weekdays you pick.                              */
/*    monthly   on the dates of the month you pick.                    */
/* ------------------------------------------------------------------ */

export const DAILY = 'daily';
export const WEEKLY = 'weekly';
export const MONTHLY = 'monthly';
export const EVERY = [DAILY, WEEKLY, MONTHLY];

const uniqSorted = (a) => [...new Set(a)].sort((x, y) => x - y);

/* Accept anything — an old template with no `repeat` at all, a half-built one
   from the editor, junk from a hand-edited backup — and return a schedule the
   rest of the file can trust. */
export function normalizeRepeat(r) {
  const every = r && EVERY.includes(r.every) ? r.every : DAILY;
  const days = uniqSorted(((r && r.days) || [])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6));
  const dates = uniqSorted(((r && r.dates) || [])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31));
  return { every, days, dates };
}

const lastDateOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

/* Is this schedule due on this date?
 *
 * A weekly or monthly schedule with nothing picked is due every day rather
 * than never. Someone who switches to "weekly" and has not yet ticked a box is
 * mid-edit, and a recurrence that silently stops appearing is indistinguishable
 * from one that was deleted.
 *
 * The 31st in a 30-day month lands on the 30th, and the 30th in February lands
 * on the 28th (29th in a leap year). "Monthly on the 31st" has to mean
 * something in every month or it means nothing in half of them — and a rent
 * reminder that skips February is worse than one that arrives a day early. */
export function dueOn(repeat, date) {
  const r = normalizeRepeat(repeat);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return true;
  if (r.every === WEEKLY) return r.days.length === 0 || r.days.includes(date.getDay());
  if (r.every === MONTHLY) {
    if (r.dates.length === 0) return true;
    const dom = date.getDate();
    const last = lastDateOfMonth(date);
    // On the last day of the month, anything scheduled beyond it lands here.
    return r.dates.some((n) => n === dom || (dom === last && n > last));
  }
  return true;
}

/* Whether this schedule is anything other than "every day" — the one thing the
   sidebar needs in order to decide whether to say anything at all. */
export const isScheduled = (repeat) => normalizeRepeat(repeat).every !== DAILY;

/* A short human line for a card: "Mon, Wed, Fri" or "on the 1st and 15th". */
export function describeRepeat(repeat, { dayName, tx } = {}) {
  const t = tx || ((en) => en);
  const r = normalizeRepeat(repeat);
  const wd = dayName || ((i) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]);
  if (r.every === WEEKLY) {
    if (!r.days.length) return t('every day', 'كل يوم');
    return r.days.map((d) => wd(d)).join(', ');
  }
  if (r.every === MONTHLY) {
    if (!r.dates.length) return t('every day', 'كل يوم');
    return `${t('day', 'يوم')} ${r.dates.join(', ')}`;
  }
  return t('every day', 'كل يوم');
}
