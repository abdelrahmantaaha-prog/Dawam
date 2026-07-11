# Changelog

All notable changes to **Rhythm** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses a simple incrementing version number (0.1 per release).

---

## [2.2] — 2026-07-10

Optional cross-device sync via your own Supabase project, and a free-tier AI
option for the brain-dump sorter.

### Added
- **Cross-device sync (opt-in).** Settings → Sync: paste the URL and anon key
  of a Supabase project you own, create an account, and your planner syncs —
  local edits push a couple of seconds after you make them; the app pulls on
  launch, on returning to it, and on regaining network. Conflicts resolve per
  item by most-recent edit (right for one person on a few devices). Edits made
  before enabling sync queue locally and seed the account on first sign-in.
  Setup is a one-time ~10-minute job (one SQL snippet); steps in the README.
  Leaving it off keeps the app fully local, exactly as before.
- **Google Gemini as a free AI-sorting provider.** Settings → Backup → AI
  sorting now has a provider choice: Anthropic (paid) or Gemini, whose free
  tier needs no card (aistudio.google.com/apikey). Caveat stated in-app: on the
  free tier Google may use prompts to improve its products.

### Notes
- Enabling sync changes the privacy story: data leaves the device to your own
  Supabase project, protected by your account and row-level security.
- The sync merge logic is covered by 8 unit tests including a two-device
  convergence round trip (29 tests total). The live Supabase round-trip should
  be verified against your own project after setup.
- Deletes don't propagate: weeks pruned locally linger remotely, harmlessly.

---

## [2.1] — 2026-07-08

Fixes the broken PIN, makes projects lighter-weight (optional targets,
completable), and adds small quality-of-life wins in the backlog and task lists.

### Fixed
- **PIN works again.** The v2.0 module split left `hashPin` unexported, so
  setting a PIN crashed silently. Setting, locking, wrong-PIN rejection, and
  unlocking are all restored and covered by an automated end-to-end test.
- **PIN now re-locks when you return to the app.** An installed PWA stays alive
  in memory, so switching apps never reloaded the page — and the lock only fired
  on load. Rhythm now locks again when you come back after more than 30 seconds
  away; quick app switches stay frictionless.
- **Needed daily pace respects a future start date.** A project starting in 10
  days with a 30-day working window now shows the true rate that window demands,
  instead of diluting it across days before the work begins.

### Added
- **Numeric targets are optional.** Leave Target empty and a project becomes a
  milestone-style project: no progress bar or logging row, status reads "in
  progress," days-to-deadline still shows, and its linked tasks carry the load.
- **Projects can be marked complete** (and reopened) with one tap on the circle
  by the project's name. Completed projects dim, sort to the bottom, and leave
  the on-pace count, which now reads over active projects only.
- **Backlog items can be marked done in place** — a checkbox on each backlog
  row, and equally from the task list inside a linked project.
- **Subtask lists are collapsible.** Tasks with steps get a "n/m steps" toggle
  in the Plan timeline, Now, and Overdue; collapse state lasts for the session.

---

## [2.0] — 2026-07-07

Rhythm graduates from a Claude artifact to a standalone, installable **Vite
PWA**. Local-only by design: all data lives in the browser's storage on your
device, with file export/import as the backup path. This release also lands the
four engineering fixes from the v1.4 code review.

### Changed
- **Standalone Progressive Web App.** Install to your phone's home screen, runs
  fully offline (the service worker precaches the app and its fonts), updates
  automatically on new deploys. Built with Vite; source split into focused
  modules (core logic, storage, components, views, app) with the stylesheet
  extracted from the old inline string.
- **Storage is the browser's localStorage** behind the same async adapter API.
  No cloud, no sync — deliberate. Clearing site data deletes the planner, so the
  Backup tab now says so plainly and pushes periodic file exports.
- **Google Drive sync is removed** (it depended on the artifact's AI connector
  and was the app's most fragile part). File export/import remains and accepts
  every prior backup schema, so moving data off the artifact is: export there,
  import here.
- **The AI brain-dump sorter now uses your own Anthropic API key**, entered once
  under Settings → Backup and stored only on-device. Without a key the sorter
  explains what it needs instead of failing. Using it sends your dump text to
  Anthropic — the single, opt-in exception to local-only.

### Fixed
- **Tasks under a Project are now complete.** All stored weeks are preloaded
  into the session cache at startup, so a project shows its tasks from any week
  — not just weeks visited this session. (Verified: a task in a three-week-old,
  never-opened week appears under its project on first load.)
- **The translator-shadowing bug class is eliminated.** The i18n function is
  renamed `t` → `tx` across all 230+ call sites, so `.map((t) => …)` callbacks
  can never shadow it again — the root cause of two prior defensive rewrites.
- **The plan wizard no longer performs side effects during render.** Skipping
  unresolvable items moved from a `setTimeout` inside render to a proper effect.

### Added
- **A real test suite.** `npm test` runs 19 unit tests over the pure core:
  project pace (behind / on pace / not started), habit streaks (gaps, unchecked
  today), block resolution including the overnight-Isha window, settings
  migration, and the glow cap.
- Generated PWA icons (regular + maskable) matching the in-app mark.

### Migration
- From the artifact: Settings → Backup → export the .json, then import it in the
  PWA. Settings migration fills the new fields automatically.
- The artifact v1.4 file remains available and functional if you want it.

---

## [1.4] — 2026-07-07

A living flame for habit streaks, and a fix for recurring tasks slipping into
the backlog.

### Changed
- **The streak flame is now animated.** It starts as a cold ember at zero, warms
  and begins to flicker from day two, gains a pulsing halo from day three, and by
  days six and seven burns hot — faster flicker, a glowing halo, rising sparks,
  and a card that gently breathes with light. The whole ramp is pure CSS and is
  disabled automatically for users with reduced-motion enabled.

### Fixed
- **Dragging a recurring task no longer adds it to the backlog by accident.**
  When Recurring and Backlog merged into one box (v1.2), the whole box became a
  backlog drop zone — so picking up a recurring chip and releasing it without
  leaving the box silently created a backlog item. Drag-to-backlog for recurring
  tasks is removed (each chip's explicit backlog button remains), and the box only
  accepts drops while the Backlog tab is showing. The floating "drop here" bar
  still appears during any task drag, so unscheduling by drag is unaffected.

---

## [1.3] — 2026-07-07

Habits now live where you actually work — inside their time period on both the
Now and Plan screens — instead of a separate strip.

### Changed
- **Habits appear under their time period.** On the **Plan** timeline, each habit
  now sits inside its block (Fajr, morning, Dhuhr, Asr, Maghrib, or Isha),
  checkable for the selected day. On **Now**, the habits for the *current* period
  surface at the top of the list, checkable for today.
- **Removed the separate "Daily habits" strip** at the top of the Plan day. It's
  replaced by the per-period placement above, so a habit shows in one clear place
  rather than two.

### Notes
- In the overnight window (after midnight, before Fajr), a Now habit is tied to
  the same calendar day as the tasks shown there — the day that is ending — so it
  stays consistent with the rest of that view.
- A habit's period is set in the Habits tab (each habit's "Day period"). Change it
  there and it moves to the matching block everywhere.

---

## [1.2] — 2026-07-07

Adds a habit tracker, links tasks to projects, ships a PIN lock, and reorganises
Settings into tabs — alongside four targeted fixes.

### Added
- **Habits** — a new tab for daily commitments. Each habit tracks completion per
  day and shows a **streak that glows brighter the longer it runs, reaching full
  brightness at seven days**. Habits also appear:
  - as a **Daily habits** strip on the Plan day, where checking one counts toward
    that day's commitment and feeds the streak (the "representative task" on the
    planning page); and
  - inside **Plan the day**, which now walks you through any habit not yet kept.
- **Tasks can belong to a project.** Every task and backlog item has an optional
  **Project** selector, and the Projects tab lists the tasks linked to each
  project with a done/total rollup. You can tick a task or jump to it from there.
- **App PIN (soft lock).** Set a four-digit PIN under Settings → Security to
  require it when Rhythm opens. Stated plainly in the UI: this deters someone
  casually picking up your device; it is **not encryption** and does not protect
  the data from anyone with technical access to the device.

### Changed
- **Projects no longer "feed" from labels.** The label-picker on a project is
  gone; the relationship now runs the other way — you attach a task to a project
  from the task itself. Cleaner, and it scales past the handful of labels.
- **Recurring and Backlog now share one box** on the Plan screen, switched by a
  toggle, reclaiming vertical space.
- **Settings is split into tabs** — General, Labels, Recurring, Prayer, Security,
  Backup — with tightened spacing and clearer grouping.
- **Fajr's prayer lock now holds through the morning until Dhuhr**, rather than
  lifting at sunrise. It releases the instant you mark Fajr done. (This is a
  deliberately long lock; it can be turned off entirely under Settings → Prayer.)

### Fixed
- **Project pace now accounts for the start date.** "Where you should be today"
  is measured from the project's start, so a project 50% through its timeline
  expects 50% of its target. A project whose start is in the future reads as
  **not started yet** rather than instantly behind.
- **The wrong Isha period is no longer highlighted after midnight.** Between
  midnight and Fajr, the Plan timeline no longer marks the coming night's Isha as
  the current block.
- **Project titles are fully visible** in the Projects tab — long names wrap
  instead of being clipped.
- **The language button no longer overflows its box** — the icon and label sit
  correctly within a single control.
- **Overdue tasks are now editable.** Tapping an overdue item (or its edit icon)
  opens the full editor, loading the task's week first if needed.

### Notes & limitations
- The PIN is a deterrent, not security. See the caveat above and in-app.
- Tasks shown under a project are gathered from the weeks loaded this session plus
  your backlog; navigating to a week loads its tasks into that view.
- The bottom navigation now carries five tabs; on the narrowest phones it is
  snug but fits.
- No migration needed. New fields (`habits`, `pin`, per-task `projectRef`) default
  cleanly on existing data, and old backups import unchanged.

---

## [1.1] — 2026-07-05

The first versioned release. Renamed the app to **Rhythm**, split tagging from
long-term goal tracking, made recurring tasks safe to edit, added Arabic with
full right-to-left support, and sped up Drive sync.

### Added
- **Projects** — a dedicated tab for long-term goals with a finish line
  (translating a book, a course, a run of investigations). Each project has:
  - a goal, a unit (e.g. pages), a numeric target, a start date, and a deadline;
  - a progress log — record how much you did and when;
  - a progress bar with a marker showing where you *should* be today;
  - a pace read-out: on pace / behind, days left, the daily rate still required
    to finish on time, and a projected finish date at your current rate;
  - **linked labels** — choose which labels feed the project and see a rollup of
    how many tagged tasks are done.
- **Language switching (English / Arabic)** with a one-tap toggle in the header
  and a full control in Settings. Arabic switches the entire interface to
  right-to-left; day names, month names, prayer periods, and all controls are
  translated. Numeric and time fields stay left-to-right so digits read
  correctly.
- **Version badge** shown in the header and in Settings so you always know which
  build you are on.

### Changed
- **"Projects" (colored tags) are now "Labels."** This is a pure rename — your
  existing tags, their colors, and every task tagged with them are preserved.
  "Projects" now refers exclusively to the new long-term goals feature.
- **"Templates" are now "Recurring tasks,"** relabeled everywhere (the plan
  sidebar, Settings, and the day-planning wizard).
- **Google Drive sync is significantly faster.** Sync works by asking an AI
  connector to write the file, so it is inherently a few-second operation rather
  than an instant local save. It now runs on the fastest model and with a tight
  output budget and terser instructions, which cuts the round-trip time
  substantially. Settings now states plainly that Drive sync takes a few seconds.
- Backup schema bumped to version 3. Older backups (v2) import cleanly and are
  upgraded automatically on load or import.

### Fixed
- **Editing a recurring task no longer touches tasks already on your calendar.**
  A recurring task is now strictly a *template*: adding it to a day copies its
  title, time, label, and steps by value, so later edits to the recurring task
  only affect tasks you add *after* the edit. Nothing you have already scheduled
  changes.
- **Eliminated a state-handling bug that could drop edits or appear to reset
  saved data.** Recurring-task edits, label edits, and project edits now use
  functional state updates, and the Settings panel re-syncs from the live data
  instead of a stale snapshot taken when it was opened. Fast typing in a name or
  step field no longer loses characters, and an edit can no longer overwrite
  newer data.

### Migration notes
- No action required. On first launch, v1.0 data is migrated in place: your old
  colored "projects" become **Labels**, and the new **Projects** list starts
  empty.
- The change is backward-compatible with existing backups. Importing a v1.0 or
  v2 backup applies the same migration.

---

## [1.0] — Prior to versioning

Initial release (previously "Planner").

- Prayer-time-anchored day planner with a live sky that shifts with the clock.
- Six day periods anchored to Fajr, sunrise, Dhuhr, Asr, Maghrib, and Isha,
  with on-device prayer-time calculation for Cairo (Egyptian Authority).
- **Now / Overdue / Plan** views, a day-planning wizard, and a focus lock.
- Colored **project tags** (now Labels), a **backlog**, and reusable
  **templates** (now Recurring tasks).
- **Brain dump** — free-text notes sorted into day slots or the backlog by AI.
- Prayer lock that pauses the app at each prayer time until it is marked done.
- Local persistence with export/import and Google Drive backup.
