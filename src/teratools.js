/* ------------------------------------------------------------------ */
/*  Tera's hands: every tool she has, one per thing a person can do.  */
/*                                                                     */
/*  The owner asked for "100% control over anything and everything    */
/*  the user can do by hand" (2026-11-14). The list was taken from an  */
/*  inventory of every handler in the app, and three rules shaped it:  */
/*                                                                     */
/*  - SET, never toggle. The app's checkboxes flip (a habit ticked     */
/*    twice is unticked); a tool says what the state should BE, so a   */
/*    repeated call is harmless.                                       */
/*  - ANY week. Several handlers only reach the week on screen; these  */
/*    tools find a task wherever it lives (App.jsx teraOps).            */
/*  - REPORT. Every tool answers with what is now true, so Claude can  */
/*    check its own work and correct it in the same turn.              */
/*                                                                     */
/*  Out of reach on purpose: API keys, the PIN, sync sign-in/out and   */
/*  device linking, and the Trello/Google credentials. Everything else */
/*  the owner can do, she can.                                         */
/*                                                                     */
/*  This file only describes tools and checks their input. Doing the   */
/*  thing is `ops` — functions App.jsx builds from its own handlers.   */
/*  Every change goes through ops.change(summary, fn), which runs them */
/*  one at a time, keeps the Undo snapshot, and in approve-first mode  */
/*  holds the change instead of running it.                            */
/* ------------------------------------------------------------------ */

const BLOCKS = ['fajr', 'morning', 'dhuhr', 'asr', 'maghrib', 'isha'];
const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/* ---------- schema pieces ---------- */
const S = {
  str: (description) => ({ type: 'string', description }),
  date: (description = 'Date, YYYY-MM-DD') => ({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description }),
  hm: (description = 'Time of day, HH:MM 24-hour; "" clears it') => ({ type: 'string', pattern: '^(\\d{1,2}:\\d{2})?$', description }),
  block: (description = 'Period of the day') => ({ type: 'string', enum: BLOCKS, description }),
  int: (description, min, max) => ({ type: 'integer', description, ...(min != null ? { minimum: min } : {}), ...(max != null ? { maximum: max } : {}) }),
  num: (description) => ({ type: 'number', description }),
  bool: (description) => ({ type: 'boolean', description }),
  strs: (description) => ({ type: 'array', items: { type: 'string' }, description }),
  id: (what) => ({ type: 'string', description: `${what} id, from a snapshot or a get_* result` }),
};
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const confirmFlag = S.bool('Must be true. Only when the person explicitly asked for exactly this.');

/* ---------- input checks ---------- */
class Bad extends Error {}
const need = (cond, msg) => { if (!cond) throw new Bad(msg); };
const isDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const [y, m, d] = String(s).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};
const isHM = (s) => s === '' || (/^\d{1,2}:\d{2}$/.test(String(s)) && Number(String(s).split(':')[0]) < 24 && Number(String(s).split(':')[1]) < 60);
const padHM = (s) => (s ? String(s).replace(/^(\d):/, '0$1:') : '');
const checkDate = (v, name = 'date') => need(isDate(v), `${name} must be a real date, YYYY-MM-DD`);
const checkHM = (v, name) => need(v == null || isHM(v), `${name} must be HH:MM (24-hour) or ""`);
const checkBlock = (v) => need(v == null || BLOCKS.includes(v), `block must be one of ${BLOCKS.join(', ')}`);
const only = (o, keys) => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => keys.includes(k) && v !== undefined));
const out = (x) => (typeof x === 'string' ? x : JSON.stringify(x));

/* ---------- the catalogue ---------- */
/* Each entry: name, description, schema, and either read(input, ops) for a
   tool that only looks, or write(input, ops) — which returns a one-line
   summary for the Undo/approval list and the function that does it. */

const T = [];
const read = (name, description, schema, fn) => T.push({ name, description, schema, read: fn });
const write = (name, description, schema, fn) => T.push({ name, description, schema, write: fn });

/* ===== reading ===== */

read('get_day', 'Everything on one date: tasks (with ids, times, steps, notes, labels, project), prayers kept, habits kept, calendar meetings. Use before changing a day you have not seen this turn.',
  obj({ date: S.date() }, ['date']),
  async ({ date }, ops) => { checkDate(date); return ops.getDay(date); });

read('get_days', 'A compact list of tasks per day for a range of up to 31 days (titles, ids, times, done).',
  obj({ from: S.date('First date'), to: S.date('Last date') }, ['from', 'to']),
  async ({ from, to }, ops) => { checkDate(from, 'from'); checkDate(to, 'to'); return ops.getDays(from, to); });

read('find_tasks', 'Search tasks by words in the title (any week stored on this device), optionally within dates and by done state.',
  obj({ text: S.str('Words to look for; "" for all'), from: S.date('Optional first date'), to: S.date('Optional last date'), done: S.bool('Optional: only done (true) or only open (false)') }, ['text']),
  async (i, ops) => ops.findTasks(i));

read('get_overdue', 'Unfinished tasks from earlier days.', obj({}), async (_, ops) => ops.getOverdue());
read('get_backlog', 'The backlog: tasks with no day yet.', obj({}), async (_, ops) => ops.getBacklog());
read('get_recurring', 'Recurring task definitions, with their repeat rule.', obj({}), async (_, ops) => ops.getRecurring());
read('get_habits', 'Habits with their settings and the last days of their log.',
  obj({ days: S.int('How many recent days of log to include (default 14)', 1, 60) }), async ({ days }, ops) => ops.getHabits(days || 14));
read('get_projects', 'Long-term projects: target, progress, pace, deadline, work plan and sittings, board columns, recent progress entries. Give projectId for one project in full.',
  obj({ projectId: S.str('Optional project id or exact name') }), async ({ projectId }, ops) => ops.getProjects(projectId));
read('get_board', "A project's board: its columns and the cards in each.",
  obj({ projectId: S.str('Project id or exact name') }, ['projectId']), async ({ projectId }, ops) => ops.getBoard(projectId));
read('get_points', 'Points balance, today\'s ledger, rewards and penalties.', obj({}), async (_, ops) => ops.getPoints());
read('get_notes', 'Notebooks: id, title, tags, pinned, first words. Optional search text or tag.',
  obj({ query: S.str('Optional words to look for'), tag: S.str('Optional tag') }), async (i, ops) => ops.getNotes(i));
read('get_note', 'One notebook in full, as plain text.', obj({ noteId: S.id('Note') }, ['noteId']), async ({ noteId }, ops) => ops.getNote(noteId));
read('get_calendar', 'Calendar events (from the connected calendars) between two dates, with the key used to mark or file them.',
  obj({ from: S.date('First date'), to: S.date('Last date') }, ['from', 'to']),
  async ({ from, to }, ops) => { checkDate(from, 'from'); checkDate(to, 'to'); return ops.getCalendar(from, to); });
read('get_settings', 'The planner\'s settings: language, theme, week start, prayer times, labels, locks, reminders, calendars, Tera\'s own settings. Keys and the PIN are never shown.',
  obj({}), async (_, ops) => ops.getSettings());
read('list_backups', 'Automatic backups that can be restored.', obj({}), async (_, ops) => ops.listBackups());

/* ===== tasks ===== */

const taskFields = {
  title: S.str('Title'),
  block: S.block('Period; a start time decides the period on its own'),
  start: S.hm('Start time'), end: S.hm('End time'),
  duration: S.int('Expected minutes', 1, 1440),
  until: S.date('Last day, for a task that runs over several days; "" makes it one day'),
  label: S.str('Label (tag) name; created if new; "" removes it'),
  project: S.str('Long-term project id or exact name; "" unlinks'),
};

write('create_task', 'Put a new task on a day.',
  obj({ ...taskFields, date: S.date(), title: S.str('Title'), steps: S.strs('Optional subtasks, in order'), note: S.str('Optional text for its description'), links: S.strs('Optional links') }, ['title', 'date']),
  (i, ops) => {
    checkDate(i.date); checkBlock(i.block); checkHM(i.start, 'start'); checkHM(i.end, 'end');
    need(String(i.title || '').trim(), 'title is required');
    return [`Add "${i.title}" on ${i.date}`, () => ops.createTask(i)];
  });

write('update_task', 'Change any part of a task: title, date, period, times, duration, multi-day end, label, project, daily focus target, points worth, board column. Give only what changes.',
  obj({ taskId: S.id('Task'), ...taskFields, date: S.date('Move to this date'), focusTarget: S.int('Daily focus minutes target; 0 clears', 0, 600), worth: S.int('Points override; 0 clears', 0, 10000), column: S.str('Board column id or name') }, ['taskId']),
  (i, ops) => {
    if (i.date != null) checkDate(i.date);
    if (i.until) checkDate(i.until, 'until');
    checkBlock(i.block); checkHM(i.start, 'start'); checkHM(i.end, 'end');
    const changes = only(i, ['title', 'date', 'block', 'start', 'end', 'duration', 'until', 'label', 'project', 'focusTarget', 'worth', 'column']);
    need(Object.keys(changes).length, 'nothing to change');
    return [`Edit task ${Object.keys(changes).join(', ')}`, () => ops.updateTask(i.taskId, { ...changes, start: changes.start != null ? padHM(changes.start) : undefined, end: changes.end != null ? padHM(changes.end) : undefined })];
  });

write('set_task_done', 'Tick a task off (done true) or reopen it (false). Ticking pays its points, like the checkbox.',
  obj({ taskId: S.id('Task'), done: S.bool('true = done') }, ['taskId', 'done']),
  (i, ops) => [`${i.done ? 'Tick off' : 'Reopen'} a task`, () => ops.setTaskDone(i.taskId, !!i.done)]);

write('delete_task', 'Delete a task for good (prefer task_to_backlog unless they said delete).',
  obj({ taskId: S.id('Task') }, ['taskId']), (i, ops) => ['Delete a task', () => ops.deleteTask(i.taskId)]);

write('task_to_backlog', 'Take a task off its day and keep it in the backlog.',
  obj({ taskId: S.id('Task') }, ['taskId']), (i, ops) => ['Move a task to the backlog', () => ops.taskToBacklog(i.taskId)]);

write('set_steps', 'Replace a task\'s whole subtask list (add, rename, remove, reorder in one go). Use tick_step to tick one off — that pays points; this does not.',
  obj({ taskId: S.id('Task'), steps: { type: 'array', items: obj({ title: S.str('Subtask'), done: S.bool('Done?') }, ['title']), description: 'The full new list, in order' } }, ['taskId', 'steps']),
  (i, ops) => [`Set ${i.steps.length} subtasks`, () => ops.setSteps(i.taskId, i.steps)]);

write('tick_step', 'Tick one subtask off (done true) or reopen it, by its number (1 = first).',
  obj({ taskId: S.id('Task'), step: S.int('Subtask number, 1-based', 1, 50), done: S.bool('true = done') }, ['taskId', 'step', 'done']),
  (i, ops) => [`${i.done ? 'Tick' : 'Untick'} subtask ${i.step}`, () => ops.tickStep(i.taskId, i.step, !!i.done)]);

write('set_task_notes', 'Replace a task\'s description: text paragraphs and links, in order.',
  obj({ taskId: S.id('Task'), notes: { type: 'array', items: obj({ type: { type: 'string', enum: ['text', 'link'] }, content: S.str('Text, or a URL') }, ['type', 'content']) } }, ['taskId', 'notes']),
  (i, ops) => ['Rewrite a task description', () => ops.setTaskNotes(i.taskId, i.notes)]);

write('reorder_tasks', 'Set the order of tasks inside one period of one day (first = first done on Now).',
  obj({ date: S.date(), block: S.block(), taskIds: S.strs('Task ids in the new order') }, ['date', 'block', 'taskIds']),
  (i, ops) => { checkDate(i.date); checkBlock(i.block); return [`Reorder ${i.block} on ${i.date}`, () => ops.reorderTasks(i.date, i.block, i.taskIds)]; });

write('add_task_series', 'Put one task on many days: every N days (everyDays 1 = daily, 7 = weekly) or on named weekdays, from a date until a date (default one week).',
  obj({ title: S.str('Title'), block: S.block(), from: S.date('First day'), until: S.date('Optional last day'), everyDays: S.int('Days between repeats', 1, 90), weekdays: { type: 'array', items: { type: 'string', enum: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] } }, start: S.hm(), end: S.hm(), label: S.str('Optional label name'), project: S.str('Optional project id or name') }, ['title', 'block', 'from']),
  (i, ops) => [`Add "${i.title}" as a series`, () => ops.apply({ kind: 'add_task_series', ...i })]);

write('clear_day', 'Delete every task on one date.', obj({ date: S.date(), confirm: confirmFlag }, ['date', 'confirm']),
  (i, ops) => { checkDate(i.date); need(i.confirm === true, 'confirm must be true'); return [`Clear every task on ${i.date}`, () => ops.clearDay(i.date)]; });

write('overdue_to_today', 'Bring every overdue task onto today.', obj({}), (_, ops) => ['Move all overdue to today', () => ops.apply({ kind: 'overdue_to_today' })]);
write('complete_overdue', 'Mark overdue tasks done (late, half points). Give taskIds, or none for all of them.',
  obj({ taskIds: S.strs('Optional: just these overdue task ids') }),
  (i, ops) => [`Mark ${i.taskIds && i.taskIds.length ? i.taskIds.length : 'all'} overdue done`, () => ops.completeOverdue(i.taskIds || [])]);
write('delete_all_overdue', 'Delete every overdue task for good.', obj({ confirm: confirmFlag }, ['confirm']),
  (i, ops) => { need(i.confirm === true, 'confirm must be true'); return ['Delete all overdue', () => ops.deleteAllOverdue()]; });

write('slot_day', 'Auto-slot a day: give every untimed task a start and end around what is fixed.',
  obj({ date: S.date() }, ['date']), (i, ops) => { checkDate(i.date); return [`Slot ${i.date}`, () => ops.slotDay(i.date)]; });
write('clear_slots', 'Remove the auto-assigned times from a day.',
  obj({ date: S.date() }, ['date']), (i, ops) => { checkDate(i.date); return [`Clear slots on ${i.date}`, () => ops.clearSlots(i.date)]; });

/* ===== backlog ===== */

write('create_backlog_item', 'Capture something with no day yet.',
  obj({ title: S.str('Title'), label: S.str('Optional label name'), project: S.str('Optional project id or name'), steps: S.strs('Optional subtasks'), duration: S.int('Optional minutes', 1, 1440), note: S.str('Optional description') }, ['title']),
  (i, ops) => [`Add "${i.title}" to the backlog`, () => ops.createBacklog(i)]);
write('update_backlog_item', 'Change a backlog item: title, label, project, minutes, subtasks (full list), done.',
  obj({ poolId: S.id('Backlog item'), title: S.str('Title'), label: S.str('Label name, "" removes'), project: S.str('Project id or name, "" unlinks'), duration: S.int('Minutes', 0, 1440), steps: { type: 'array', items: obj({ title: S.str('Subtask'), done: S.bool('Done?') }, ['title']) }, done: S.bool('Done?') }, ['poolId']),
  (i, ops) => ['Edit a backlog item', () => ops.updateBacklog(i.poolId, only(i, ['title', 'label', 'project', 'duration', 'steps', 'done']))]);
write('schedule_backlog_item', 'Put a backlog item onto a day (it leaves the backlog).',
  obj({ poolId: S.id('Backlog item'), date: S.date(), block: S.block() }, ['poolId', 'date', 'block']),
  (i, ops) => { checkDate(i.date); return [`Schedule a backlog item on ${i.date}`, () => ops.apply({ kind: 'backlog_to_day', poolId: i.poolId, date: i.date, block: i.block })]; });
write('delete_backlog_item', 'Delete a backlog item.', obj({ poolId: S.id('Backlog item') }, ['poolId']),
  (i, ops) => ['Delete a backlog item', () => ops.apply({ kind: 'delete_backlog', poolId: i.poolId })]);
write('clear_done_backlog', 'Delete every backlog item marked done.', obj({}), (_, ops) => ['Clear done backlog items', () => ops.clearDoneBacklog()]);

/* ===== recurring ===== */

const repeatSchema = obj({
  every: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
  days: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'Weekly: weekdays, 0 = Sunday' },
  dates: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 31 }, description: 'Monthly: dates of the month' },
}, ['every']);
const tplFields = { title: S.str('Title'), block: S.block(), start: S.hm(), end: S.hm(), duration: S.int('Minutes', 1, 1440), label: S.str('Label name'), project: S.str('Project id or name'), repeat: repeatSchema, autoAdd: S.bool('Put it on its days automatically'), steps: S.strs('Subtasks') };

write('create_recurring', 'Define a recurring task (with a repeat rule; autoAdd puts it on its days by itself).',
  obj(tplFields, ['title', 'block']), (i, ops) => { checkBlock(i.block); return [`Define recurring "${i.title}"`, () => ops.createRecurring(i)]; });
write('update_recurring', 'Change a recurring task. Tasks it already made are untouched.',
  obj({ recurringId: S.id('Recurring task'), ...tplFields }, ['recurringId']),
  (i, ops) => ['Edit a recurring task', () => ops.updateRecurring(i.recurringId, only(i, Object.keys(tplFields)))]);
write('delete_recurring', 'Delete a recurring task definition.', obj({ recurringId: S.id('Recurring task') }, ['recurringId']),
  (i, ops) => ['Delete a recurring task', () => ops.apply({ kind: 'delete_recurring', recurringId: i.recurringId })]);
write('place_recurring', 'Put a recurring task on a day.', obj({ recurringId: S.id('Recurring task'), date: S.date(), block: S.block('Optional period') }, ['recurringId', 'date']),
  (i, ops) => { checkDate(i.date); return [`Place a recurring task on ${i.date}`, () => ops.apply({ kind: 'recurring_to_day', ...i })]; });
write('recurring_to_backlog', 'Copy a recurring task into the backlog.', obj({ recurringId: S.id('Recurring task') }, ['recurringId']),
  (i, ops) => ['Copy a recurring task to the backlog', () => ops.recurringToBacklog(i.recurringId)]);

/* ===== habits and prayers ===== */

const habitFields = { name: S.str('Name'), block: S.block(), color: S.str('Colour, #RRGGBB'), identity: S.str('Who this makes them ("a reader")'), cue: S.str('When/where'), tiny: S.str('The two-minute version'), after: S.str('Habit id it follows, or "prayer:<period>", or "" for none'), reward: S.str('Reward text') };
write('create_habit', 'Start tracking a daily habit.', obj(habitFields, ['name', 'block']), (i, ops) => { checkBlock(i.block); return [`Start habit "${i.name}"`, () => ops.createHabit(i)]; });
write('update_habit', 'Change a habit\'s settings.', obj({ habitId: S.id('Habit'), ...habitFields }, ['habitId']),
  (i, ops) => ['Edit a habit', () => ops.updateHabit(i.habitId, only(i, Object.keys(habitFields)))]);
write('delete_habit', 'Stop tracking a habit.', obj({ habitId: S.id('Habit') }, ['habitId']), (i, ops) => ['Delete a habit', () => ops.apply({ kind: 'delete_habit', habitId: i.habitId })]);
write('set_habit_done', 'Record a habit for a date: "done", "tiny" (the two-minute version) or "not".',
  obj({ habitId: S.id('Habit'), date: S.date(), state: { type: 'string', enum: ['done', 'tiny', 'not'] } }, ['habitId', 'date', 'state']),
  (i, ops) => { checkDate(i.date); return [`Habit ${i.state} on ${i.date}`, () => ops.setHabitDone(i.habitId, i.date, i.state)]; });
write('set_prayer', 'Record a prayer as prayed (true) or not (false) on a date. Only when they say so.',
  obj({ prayer: { type: 'string', enum: PRAYERS }, date: S.date(), done: S.bool('true = prayed') }, ['prayer', 'date', 'done']),
  (i, ops) => { checkDate(i.date); return [`${i.prayer} ${i.done ? 'prayed' : 'not prayed'} on ${i.date}`, () => ops.setPrayer(i.prayer, i.date, !!i.done)]; });

/* ===== projects ===== */

const projFields = { name: S.str('Name'), goal: S.str('Why / what it is'), unit: S.str('Unit (pages, words, sessions)'), target: S.num('Target amount'), color: S.str('#RRGGBB'), startDate: S.date('Start date'), deadline: S.date('Deadline') };
write('create_project', 'Start a long-term project.', obj(projFields, ['name']), (i, ops) => [`Start project "${i.name}"`, () => ops.createProject(i)]);
write('update_project', 'Change a project: fields, completed, and its work plan (on, weekdays 0=Sunday, period, start time, sittings).',
  obj({ projectId: S.str('Project id or exact name'), ...projFields, completed: S.bool('true = finished, false = reopen'),
    plan: obj({ on: S.bool('Work plan on'), days: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 } }, block: S.block(), start: S.hm(), sittings: { type: 'array', items: obj({ block: S.block(), start: S.hm() }, ['block']) } }) }, ['projectId']),
  (i, ops) => ['Edit a project', () => ops.updateProject(i.projectId, only(i, [...Object.keys(projFields), 'completed', 'plan']))]);
write('delete_project', 'Delete a project.', obj({ projectId: S.str('Project id or exact name'), confirm: confirmFlag }, ['projectId', 'confirm']),
  (i, ops) => { need(i.confirm === true, 'confirm must be true'); return ['Delete a project', () => ops.deleteProject(i.projectId)]; });
write('log_progress', 'Log progress on a project (negative corrects an over-log). Pays goal points.',
  obj({ projectId: S.str('Project id or exact name'), amount: S.num('Amount, in the project\'s unit'), note: S.str('Optional note'), date: S.date('Optional date (default today)') }, ['projectId', 'amount']),
  (i, ops) => [`Log ${i.amount} on a project`, () => ops.logProgress(i)]);
write('delete_progress_entry', 'Remove one logged progress entry (its points go with it).',
  obj({ projectId: S.str('Project id or exact name'), entryId: S.id('Progress entry') }, ['projectId', 'entryId']),
  (i, ops) => ['Delete a progress entry', () => ops.deleteProgress(i.projectId, i.entryId)]);
write('move_card', "Move a task to a column on its project's board; Done ticks it off.",
  obj({ taskId: S.id('Task or backlog item'), column: S.str('Column id or name') }, ['taskId', 'column']),
  (i, ops) => ['Move a board card', () => ops.moveCard(i.taskId, i.column)]);
write('add_column', 'Add a board column.', obj({ projectId: S.str('Project id or name'), name: S.str('Column name') }, ['projectId', 'name']),
  (i, ops) => [`Add column "${i.name}"`, () => ops.apply({ kind: 'add_column', project: i.projectId, name: i.name })]);
write('rename_column', 'Rename a board column.', obj({ projectId: S.str('Project id or name'), column: S.str('Column id or name'), name: S.str('New name') }, ['projectId', 'column', 'name']),
  (i, ops) => ['Rename a column', () => ops.apply({ kind: 'rename_column', project: i.projectId, column: i.column, name: i.name })]);
write('delete_column', 'Remove a board column (its cards go to the first column).', obj({ projectId: S.str('Project id or name'), column: S.str('Column id or name') }, ['projectId', 'column']),
  (i, ops) => ['Delete a column', () => ops.apply({ kind: 'delete_column', project: i.projectId, column: i.column })]);
write('reorder_columns', 'Set the order of a board\'s columns (Done always stays last).', obj({ projectId: S.str('Project id or name'), columns: S.strs('Column ids or names in the new order') }, ['projectId', 'columns']),
  (i, ops) => ['Reorder columns', () => ops.reorderColumns(i.projectId, i.columns)]);

/* ===== points ===== */

write('create_reward', 'Add something points can buy.', obj({ name: S.str('Reward'), cost: S.int('Points', 1, 100000), minutes: S.int('Optional: minutes of rest it is worth', 1, 600) }, ['name', 'cost']),
  (i, ops) => [`Add reward "${i.name}"`, () => ops.createReward(i)]);
write('update_reward', 'Change a reward.', obj({ rewardId: S.id('Reward'), name: S.str('Name'), cost: S.int('Points', 1, 100000) }, ['rewardId']),
  (i, ops) => ['Edit a reward', () => ops.updateReward(i.rewardId, only(i, ['name', 'cost']))]);
write('delete_reward', 'Delete a reward.', obj({ rewardId: S.id('Reward') }, ['rewardId']), (i, ops) => ['Delete a reward', () => ops.deleteReward(i.rewardId)]);
write('cash_in_reward', 'Spend points on a reward (only when they say they are taking it).', obj({ rewardId: S.id('Reward') }, ['rewardId']),
  (i, ops) => ['Cash in a reward', () => ops.cashIn(i.rewardId)]);
write('create_penalty', 'Add a penalty (wipe true = it resets points to zero).', obj({ name: S.str('Penalty'), cost: S.int('Points', 1, 100000), wipe: S.bool('Wipe the balance') }, ['name', 'cost']),
  (i, ops) => [`Add penalty "${i.name}"`, () => ops.createPenalty(i)]);
write('update_penalty', 'Change a penalty.', obj({ penaltyId: S.id('Penalty'), name: S.str('Name'), cost: S.int('Points', 1, 100000), wipe: S.bool('Wipe') }, ['penaltyId']),
  (i, ops) => ['Edit a penalty', () => ops.updatePenalty(i.penaltyId, only(i, ['name', 'cost', 'wipe']))]);
write('delete_penalty', 'Delete a penalty.', obj({ penaltyId: S.id('Penalty') }, ['penaltyId']), (i, ops) => ['Delete a penalty', () => ops.deletePenalty(i.penaltyId)]);
write('charge_penalty', 'Charge a penalty now (only when they say they slipped). Each call charges again.', obj({ penaltyId: S.id('Penalty') }, ['penaltyId']),
  (i, ops) => ['Charge a penalty', () => ops.chargePenalty(i.penaltyId)]);
write('reset_points', 'Erase every points page — the balance goes to zero, history and all.', obj({ confirm: confirmFlag }, ['confirm']),
  (i, ops) => { need(i.confirm === true, 'confirm must be true'); return ['Reset all points', () => ops.resetPoints()]; });

/* ===== notes ===== */

const noteFields = { title: S.str('Title'), text: S.str('Body as plain text; blank lines separate paragraphs'), tags: S.strs('Tags'), pinned: S.bool('Pinned to the top'), colour: S.str('Colour name or #RRGGBB') };
write('create_note', 'Start a notebook (optionally attached to a task).', obj({ ...noteFields, taskId: S.str('Optional task id to attach it to') }, ['title']),
  (i, ops) => [`New notebook "${i.title}"`, () => ops.createNote(i)]);
write('update_note', 'Change a notebook: title, whole text, append a paragraph, tags, pin, colour.',
  obj({ noteId: S.id('Note'), ...noteFields, append: S.str('Text to add at the end') }, ['noteId']),
  (i, ops) => ['Edit a notebook', () => ops.updateNote(i.noteId, only(i, [...Object.keys(noteFields), 'append']))]);
write('delete_note', 'Delete a notebook.', obj({ noteId: S.id('Note') }, ['noteId']), (i, ops) => ['Delete a notebook', () => ops.deleteNote(i.noteId)]);

/* ===== calendar and meetings ===== */

write('set_meeting_done', 'Mark a calendar meeting attended (done true) or not.', obj({ date: S.date(), key: S.str('Meeting key from get_calendar / get_day'), done: S.bool('true = attended') }, ['date', 'key', 'done']),
  (i, ops) => { checkDate(i.date); return ['Mark a meeting', () => ops.setMeetingDone(i.date, i.key, !!i.done)]; });
write('assign_meeting_project', 'File a meeting series under a project (projectId "" clears).', obj({ date: S.date(), key: S.str('Meeting key'), projectId: S.str('Project id or name, or ""') }, ['date', 'key', 'projectId']),
  (i, ops) => { checkDate(i.date); return ['File a meeting under a project', () => ops.assignMeetingProject(i.date, i.key, i.projectId)]; });
write('set_meeting_purpose', 'Write what a meeting series is for (shown on its prep sheet).', obj({ date: S.date(), key: S.str('Meeting key'), text: S.str('Up to 500 characters') }, ['date', 'key', 'text']),
  (i, ops) => { checkDate(i.date); return ['Describe a meeting', () => ops.setMeetingPurpose(i.date, i.key, i.text)]; });
write('add_calendar_feed', 'Connect a calendar by its iCal (.ics) address — read only.', obj({ url: S.str('The secret iCal address'), name: S.str('Optional name') }, ['url']),
  (i, ops) => { need(/^https?:\/\//i.test(i.url) || /^webcal:/i.test(i.url), 'url must be an http(s) or webcal address'); return ['Connect a calendar', () => ops.addFeed(i.url, i.name)]; });
write('update_calendar_feed', 'Turn a connected calendar on or off, or rename it.', obj({ feedId: S.id('Calendar'), enabled: S.bool('On?'), name: S.str('Name') }, ['feedId']),
  (i, ops) => ['Change a calendar', () => ops.updateFeed(i.feedId, only(i, ['enabled', 'name']))]);
write('remove_calendar_feed', 'Disconnect a calendar.', obj({ feedId: S.id('Calendar') }, ['feedId']), (i, ops) => ['Disconnect a calendar', () => ops.removeFeed(i.feedId)]);

/* ===== labels ===== */

write('create_label', 'Add a label (tag); project ties every task with it to a project.', obj({ name: S.str('Name'), color: S.str('#RRGGBB'), project: S.str('Optional project id or name') }, ['name']),
  (i, ops) => [`Add label "${i.name}"`, () => ops.createLabel(i)]);
write('update_label', 'Change a label.', obj({ labelId: S.str('Label id or name'), name: S.str('Name'), color: S.str('#RRGGBB'), project: S.str('Project id or name, "" unties') }, ['labelId']),
  (i, ops) => ['Edit a label', () => ops.updateLabel(i.labelId, only(i, ['name', 'color', 'project']))]);
write('delete_label', 'Delete a label (tasks keep their titles; the tag goes).', obj({ labelId: S.str('Label id or name') }, ['labelId']),
  (i, ops) => ['Delete a label', () => ops.deleteLabel(i.labelId)]);

/* ===== settings ===== */

write('update_settings', 'Change planner settings. Give only what changes.',
  obj({
    lang: { type: 'string', enum: ['en', 'ar'], description: 'Interface language' },
    theme: { type: 'string', enum: ['auto', 'light', 'dark'] },
    time24: S.bool('24-hour clock'),
    weekStartDay: S.int('Week starts on, 0 = Sunday … 6 = Saturday', 0, 6),
    leadMin: S.int('Minutes before a timed task that it shows as "soon"', 0, 180),
    nowLock: obj({ on: S.bool('Now lock on'), everyMin: S.int('Minutes without finishing anything before it locks', 1, 240) }),
    timeLock: S.bool('Time lock: cover the app during a timed task until a focus round runs'),
    prayerUseLive: S.bool('Use calculated prayer times (false = the custom times below)'),
    prayerTimes: obj({ Fajr: S.hm(), Sunrise: S.hm(), Dhuhr: S.hm(), Asr: S.hm(), Maghrib: S.hm(), Isha: S.hm() }),
    calendarAllDay: S.bool('All-day events block the day'),
    calendarPrayerReserve: S.int('Minutes each prayer keeps free', 0, 60),
    autoBackup: S.bool('Daily automatic backups'),
    tera: obj({
      nag: S.bool('Pop up when nothing is ticked off'), nagMin: S.int('…after this many minutes', 15, 600), repeatMin: S.int('…then again every', 10, 600),
      appts: S.bool('Ask about appointments'), leadMin: S.int('…this many minutes before', 0, 180), quietFrom: S.hm(), quietTo: S.hm(),
      speakPopups: S.bool('Read pop-ups aloud'), speakReplies: S.bool('Speak in the chat'), handsFree: S.bool('Listen again after answering'), autonomous: S.bool('Act without asking'),
    }),
  }),
  (i, ops) => {
    const keys = Object.keys(i);
    need(keys.length, 'nothing to change');
    if (i.prayerTimes) for (const [k, v] of Object.entries(i.prayerTimes)) checkHM(v, k);
    return [`Change settings: ${keys.join(', ')}`, () => ops.updateSettings(i)];
  });

/* ===== moments ===== */

write('set_alarm', 'Set the wake alarm (phone).', obj({ at: S.hm('Time, HH:MM'), label: S.str('Optional label') }, ['at']),
  (i, ops) => { need(isHM(i.at) && i.at, 'at must be HH:MM'); return [`Alarm at ${i.at}`, () => ops.apply({ kind: 'set_alarm', at: padHM(i.at), label: i.label })]; });
write('cancel_alarm', 'Cancel the wake alarm.', obj({}), (_, ops) => ['Cancel the alarm', () => ops.apply({ kind: 'cancel_alarm' })]);
write('start_focus', 'Start a focus round on a task now.', obj({ taskId: S.id('Task'), minutes: S.int('Minutes (default 25)', 1, 600) }, ['taskId']),
  (i, ops) => ['Start focusing', () => ops.startFocus(i.taskId, i.minutes || 25)]);
write('show', 'Bring a page or a day up on screen for them.', obj({ view: { type: 'string', enum: ['now', 'plan', 'calendar', 'projects', 'habits', 'notes', 'overdue'] }, date: S.date('Optional day to show') }, ['view']),
  (i, ops) => [`Show ${i.view}`, () => ops.show(i.view, i.date)]);
write('backup_now', 'Take a backup of the whole planner now.', obj({}), (_, ops) => ['Back up now', () => ops.backupNow()]);
write('restore_backup', 'Replace the whole planner with an automatic backup (a backup of the current state is taken first).', obj({ name: S.str('Backup name from list_backups'), confirm: confirmFlag }, ['name', 'confirm']),
  (i, ops) => { need(i.confirm === true, 'confirm must be true'); return [`Restore backup ${i.name}`, () => ops.restoreBackup(i.name)]; });

export const TOOL_NAMES = T.map((t) => t.name);
export const READ_TOOLS = T.filter((t) => t.read).map((t) => t.name);

/* The tools as the runner wants them, bound to `ops`. `ops.change(summary,
   fn)` decides whether a change runs now or is held for approval, and keeps
   the Undo snapshot; reading never goes through it. */
export function buildTeraTools(ops) {
  return T.map((t) => ({
    name: t.name,
    description: t.description,
    schema: t.schema,
    run: async (input) => {
      try {
        if (t.read) return out(await t.read(input, ops));
        const [summary, fn] = t.write(input, ops);
        return out(await ops.change({ tool: t.name, input, summary }, fn));
      } catch (e) {
        // Back to Claude as an error result she can act on.
        throw new Error(e instanceof Bad ? `Invalid input: ${e.message}` : `Failed: ${e?.message || e}`);
      }
    },
  }));
}

export const _test = { isDate, isHM, padHM, T };
