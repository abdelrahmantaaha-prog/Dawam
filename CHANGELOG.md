# Changelog

All notable changes to **Rhythm** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses a simple incrementing version number (0.1 per release).

---

## [Unreleased]

### Added
- **Dictation, on the laptop and on the phone.** The planning assistant and the
  brain dump both have a microphone now. Where the browser has working Web
  Speech the words appear live and cost nothing; where it does not, the clip is
  recorded and transcribed by Gemini instead, through the shared key pool.

  "Where it does not" could not be a feature check. The Android WebView has no
  `SpeechRecognition` at all, which is easy. Electron defines it, opens the
  microphone with it, and only then fails — the open-source Chromium carries no
  credentials for Google's speech service, and `desktop/mic-probe.mjs` logs the
  whole sequence against the real window: `start -> audiostart ->
  error:network -> end`. So the live lane is believed until it breaks that
  promise, then retired for the session, and the handover to the recorder
  happens inside the same press rather than as an error the person can do
  nothing about. The page re-encodes whatever MediaRecorder produced as 16 kHz mono WAV
  first: Chrome records `audio/webm;codecs=opus`, which is not a container the
  Gemini API lists as accepted, and a malformed clip fails *silently* — the
  request succeeds and the transcript comes back empty, which reads exactly
  like "you said nothing". English, Egyptian Arabic and a mix of both.
  `RECORD_AUDIO` is declared on Android and asked for on first tap; the
  desktop app grants `media` to its own origin and refuses everything else,
  which is narrower than Electron's default of granting whatever is asked.
- **The assistant can now do anything you can.** It was five actions — add,
  move, complete, unschedule, schedule from the backlog — against a snapshot of
  one day. It is thirty-five now, covering tasks and their subtasks, the
  backlog, recurring tasks, habits, prayers, projects and their progress,
  rewards, slotting a day, focus sessions, the wake alarm, pulling overdue
  forward, moving around the app, and the language / theme / clock /
  prayer-gate settings. Approval is still per proposal and still the only way
  anything lands; an *Approve all* button walks the same list through the same
  code path when one sentence meant several changes.
- **One table instead of two lists.** The actions live in `ACTIONS` in
  `src/assistant.js`: the prompt the model reads is generated from it and
  `validateProposal` walks it, so the schema the model is told about and the
  schema the app enforces can no longer disagree. Adding an action is a row
  and a handler.

### Changed
- **The assistant sees the whole week, not just the day on screen.** The cost
  of the old snapshot was invisible until you used the new actions: asked to
  move tomorrow's dentist appointment, the model correctly answered that it
  could not see any such task — an id it cannot see is an id it must not name,
  and the day filter had been hiding six sevenths of the ids it was allowed to
  use. Overdue tasks from earlier weeks still carry no ids; `overdue_to_today`
  remains the only way to reach those.
- **A task the assistant ticks off now pays its points.** Approving
  `complete_task` goes through `toggleDone`, the same path the checkbox uses,
  rather than writing `done: true` behind the ledger's back.
- **Slotting takes a day rather than reading the selection.** `structureSelectedDay`
  and `clearSlots` accept a day index, because the assistant can name a day
  that isn't the one on screen. Asked to slot a day in another week, it opens
  that day and leaves the proposal standing for a second press instead of
  quietly slotting the wrong one.
- **CI-built APKs can carry the key pool.** `.env.local` is gitignored, so
  every APK GitHub Actions built shipped with no pool address at all. The
  workflow now writes one from the `VITE_BROKER_URL` / `VITE_BROKER_TOKEN`
  repository secrets, and skips the step cleanly when they are not set.
- **Rhythm no longer closes on the desktop.** The tray has no Quit, every
  window's close button already sent it to the tray, and `app.quit()` is now
  refused outright. Two doors stay open on purpose: Windows signing out or
  shutting down, and a `--dev` launch (a packaged build given that flag only
  points itself at a dev server that isn't running, so it is no bypass).
  Ending it for real means Task Manager or the uninstaller. "Start with
  Windows" stops being a toggle to match — a reboot was otherwise the way to
  close what cannot be closed — and the settings row states it instead of
  offering a switch.

### Fixed
- **Picking a day left no mark in dark mode.** `.rhythm.dark .chip` is three
  classes and `.chip.sel` is two, so dark mode was quietly repainting the
  selected day — and a drag's drop target — back to plain panel. The
  selection is verdigris again in both themes.
- **The chosen segment was invisible in dark mode.** Language, theme and clock
  format drew `var(--ink)` behind near-white text: near-black on near-white in
  the light, near-white on near-white in the dark, at 1.03:1. It now wears the
  same deep green `.primary` does after dark — 5.71:1.
- **Destructive buttons after dark.** `.danger` was drawn for a light card:
  #B23A3A at 2.9:1 on the dark panel, with a hover that flashed a near-white
  block behind red. It now uses the red dark mode already wears on late Trello
  cards, at 5.9:1, with a hover tinted from the same colour.
- The desktop smoke test killed only the `cmd` wrapper on Windows, leaving the
  app running after every run — which now matters, because what it leaves
  behind has no Quit of its own. It kills the process tree.

---

## [2.8] — 2026-08-25

The calendar stays read-only toward Google — and stops being read-only toward
you. And the phone finally gets a road to your account.

### Added
- **Meetings are checkable, focusable, and live in Now.** Rhythm never writes
  to a calendar, but it now keeps its own done-marks (per-day pages, synced,
  occurrence-aware for recurring events). A meeting appears in Now when its
  hour arrives: running ones sit under "In a meeting" with a check and a
  "Focus until it ends" button, ended-unchecked ones take a place in the
  queue at their clock position like any unfinished task, and future ones
  wait their turn. Every inline meeting row in the Plan timeline has a check.
  Meetings also appear in the desktop focus picker, sized to what remains.
- **Link a phone with a code.** Google sign-in cannot run inside the Android
  WebView, so a signed-in device now mints a device code (Settings → Sync →
  "Code for another device") that the APK pastes once to join the account —
  a Bearer token over CORS, no cookies involved. The Android build points at
  the deployment automatically.
- **Start with Windows.** The login item is re-asserted on every boot (so a
  reinstall heals its registry entry) and a login launch starts quietly in
  the tray. With commitment mode on, the locks are up from the first minute.
- The Android release keystore now exists (generated locally with openssl —
  PKCS12, so no JDK was needed) and the four signing secrets are set on the
  repo, so CI builds come out release-signed. The keystore lives OUTSIDE the
  repo in `../rhythm-signing/` — back it up; losing it orphans every install.

---

## [2.7] — 2026-08-25

The week page is gone from view: you plan in days now, and the day plans
around everything at once. The desktop can hold the whole laptop shut until
you have named what you are working on.

### Added
- **Cross-device sync on the desktop.** The Electron shell relays every API
  call through its main process to the deployment, cookie jar and all, so the
  same Google account sync the website has now works from rhythm://app —
  sign in from Settings → Sync. The web deployment needed no changes.
- **Commitment mode (desktop).** A new Focus setting locks every display
  behind a full-screen cover whenever no work round is running. The planner
  window sits above the lock — the way out is naming a task and a duration.
  A deliberate 2.5-second hold steps out for a few configurable minutes.
- **Reset points.** Points → Start over erases the balance and the whole
  ledger, with tombstones so sync clears every device instead of restoring it.
- **Meetings and due cards live in the timeline.** Timed calendar events and
  Trello cards due on the day are tucked between the tasks at their clock
  position, inside their prayer block. All-day events and later dues keep
  their own strips. An ongoing meeting shows on the Now page.
- **Theme control.** Auto (dark at night) / Light / Dark, in Settings →
  General — the old checkbox only knew auto and light.

### Changed
- **Continuous days replace the week page.** The Plan strip is any seven
  consecutive dates; the arrows slide it by a week without snapping to a
  boundary, and dragging a task onto a day chip moves it there — including
  across the stored week seam, so Friday → Saturday is finally just the next
  chip over. Weeks remain the storage and sync unit underneath.
- **The task editor was reorganised.** Schedule and ownership fields sit in
  their own cards, the focus-lock chips moved into a single row, and the time
  vault folds shut unless it holds something.
- Settings tabs wrap instead of scrolling sideways with a hidden scrollbar.

### Fixed
- Dark mode: the storage warning and the loading screen were unreadable
  light-only chrome.

---

## [2.6] — 2026-08-22

The day starts planning around the things you never told it about: the
meetings already in your calendar, the prayer itself, and the cards that are
due on a board somewhere. And a remembered duration stops being whatever
happened last time.

### Added
- **Read-only calendars.** Add a feed address — Google calls it the "secret
  address in iCal format" — and everything on it becomes time the planner will
  not schedule over. `src/calendar.js` is a full iCalendar reader: folded
  lines, TZID stamps read through their real zone, RRULE expansion (daily,
  weekly, monthly by nth or last weekday, yearly, INTERVAL/COUNT/UNTIL),
  EXDATE, single-instance RECURRENCE-ID edits, DURATION, and the two flags
  that mean "this does not hold my time" (CANCELLED, TRANSPARENT).
- **Google sign-in, on the desktop.** The shell holds a refresh token, so it is
  authorise-once rather than the hour-long browser token that was ruled out.
  PKCE, loopback redirect, `calendar.readonly`, and the token kept in the OS
  keychain through Electron's safeStorage. Bring your own OAuth client.
- **`GET /api/ics`** — a relay for the web and the phone, which cannot read a
  Google feed directly because it carries no CORS header. Allowlisted to
  calendar hosts, https only, every redirect hop re-checked, size-capped and
  timed out. It is a calendar reader, not a proxy.
- **Conflict-aware slotting.** `structureDay` takes outside obstacles and
  routes around them, and holds the opening minutes of each prayer block for
  the prayer itself (15 by default — the blocks already start AT the adhan,
  which is exactly when a task used to get slotted).
- **Read-only Trello.** Your own API key and a token granted once with
  `scope=read` and no expiry. Cards with a due date show up under the day;
  one button makes a Rhythm task out of one. The card is never touched.

### Changed
- **A remembered duration is now a rolling average of the recent sittings**,
  not the last one. Last-one-wins made the estimate hostage to a single odd
  afternoon: one session where the email took ten minutes because it was
  already half written, and every future slot got ten minutes. Five sittings
  per source, averaged within the strongest source present — so a number set
  by hand still outranks anything measured or guessed. Entries written before
  this become the first sitting rather than being discarded.
- The calendar and Trello caches never enter the sync document: both are
  derived from someone else's system, and one is other people's meetings by
  the megabyte. The feed LIST does sync — it is your own configuration.

---

## [2.5] — 2026-08-22

Anchor moves in. Rhythm becomes a desktop app that contains the whole focus
suite, and the two halves are wired together at the only seam that matters:
the round you run is the task you planned.

### Added
- **Rhythm Desktop** (`desktop/`) — an Electron shell that runs the planner in
  its own window and everything Anchor used to be in the same process: the
  always-on-top overlay, foreground-window polling through the PowerShell
  sidecar, drift nudges and force-return, break and away blackouts, chair
  detection, hard blocks and free times. Anchor is no longer a separate app.
- **Focus view** (`src/focus.jsx`) — start a round from one of today's tasks,
  a saved template or an ad-hoc title; a live card with the clock, drift state
  and the triage question; today's rounds and focus rate; and every focus
  setting, all in Rhythm's own surfaces and in both languages.
- **Rounds are linked to tasks.** A round started from a planned task carries
  its id. When the round ends, the planner is raised and asked whether that
  finishes the task — ticking it off marks it done and records what the work
  actually took.
- **Durations learned from measurement.** A finished round writes its measured
  minutes into duration memory as `kept`, so future slotting is sized by real
  time rather than an estimate. A duration set by hand still outranks it.
- `npm run desktop:smoke` — an end-to-end test that launches the app against a
  throwaway profile and drives a real round over the DevTools protocol, proving
  the planner ↔ session ↔ planner round trip.

### Changed
- **"Focus this" is the real thing on the desktop.** Task and habit focus used
  to start an in-app countdown; where the shell exists it now starts a proper
  round with the overlay and the drift watch. The countdown remains the web and
  Android behaviour.
- The desktop build (`RHYTHM_DESKTOP=1`) leaves the PWA plugin out. The planner
  is served from `rhythm://app` — a registered scheme, so `localStorage` keeps
  one fixed origin for the life of the app — and service workers cannot
  register on anything but http(s).
- Anchor's `%APPDATA%/anchor/anchor-data.json` is adopted on first launch:
  settings, templates, learned filters and history come across. Anchor's own
  file is left untouched.

---

## [2.4] — 2026-07-12

Sync becomes sign-in-and-go, prayers join habits as built-ins, the interface
goes dark at night, and the habit glow gets the calmer rework it needed —
plus a project-link bug fix and quality passes on recurring tasks and Overdue.

### Changed
- **Sync is now just "sign in."** The app ships with its backend built in
  (operator-configured Supabase). Settings → Sync leads with email/password
  and **Continue with Google**; no URLs or keys to paste. A collapsed
  Advanced section still lets a device point at its own Supabase project.
  Notes: the operator is custodian of synced data; an email/password account
  and a Google account with the same address are separate users; Supabase
  free-tier projects pause after ~a week of zero activity (one-click resume).
- **Habit glow reworked.** The flame stays; the fuzzy box-shadow halo is
  gone. Streak now reads as a soft warm wash from the card's edge plus an
  **ember bar** that literally fills toward the 7-day peak (with a gentle
  shimmer at 7). Calmer, clearer, and honest about what it measures.
- **Missed habits in Overdue are now today-only** — habits (and prayers)
  whose period has already passed today without being kept. The week-back
  list is gone; nothing shows during the overnight-Isha window.

### Added
- **Prayers are built-in habits.** The five daily prayers appear on the
  Habits page automatically — streaks, flame, ember and all — tracked from
  the same record as the prayer gate: marking a prayer at the gate and
  ticking it in Habits are one action. Built-ins can't be renamed or
  deleted, and past days can be backfilled from the 7-day strip.
- **Automatic dark mode at night** (Maghrib to Sunrise, following your
  prayer times), with a Settings → General toggle to disable. The dark
  palette is a themed layer — a corner here or there may still want polish
  on a real device.
- **Recurring tasks are editable in place** — tap a chip in the Recurring
  box to open its editor — and their times are now proper **start/end time
  fields** like tasks, not free text. Existing text times migrate
  automatically and show on the chip.

### Fixed
- **A task's project link no longer disappears when moved to the backlog**
  from a day (or back). Both directions now carry the link.

### Changed (2.4 patches)
- **Night mode is now slate/blue-grey, not green.** The dark surfaces were
  tinted with the app's verdigris; they're now a cool neutral palette. The
  verdigris accent is kept for buttons and the active tab as the brand colour.
- **The prayer gate is released by typing والله, not by tapping a button.**
  An oath is a deliberate piece of friction — you can't dismiss the gate
  absent-mindedly. Input is normalised generously (diacritics, tatweel, the ﷲ
  ligature, alef variants, whitespace all fold), so any genuine attempt counts,
  while a wrong word never releases it. The 15-minute unskippable window and
  the unmark penalty still take precedence: during those, there is no input at
  all, only the countdown.

### Added (2.4)
- **Planning assistant (chat).** A sparkle button in the header opens a chat
  that can see the shown day — tasks, habits and streaks, prayers kept, overdue,
  projects and their pace, backlog — and answers questions like "what should I
  focus on?" or "am I overcommitted?". It **proposes** changes rather than
  making them: each proposal (add, move, complete, send to backlog, schedule
  from backlog) appears as a card you Approve or dismiss individually. Nothing
  touches your plan until you approve it. Proposals referencing ids that don't
  exist, unknown actions, or malformed times are discarded before you ever see
  them. Uses the same API key as the brain-dump sorter (Gemini's free tier
  works); without a key it says so rather than failing.


- **Google Calendar, read-only.** Optionally show your Google Calendar events
  inside the Plan day — each timed event in the prayer period its start falls
  in, all-day events pinned at the top. One-way (Google → Rhythm); the app
  never writes to your calendar. Connect under Settings → Sync, then pick which
  calendars to show. Uses your Google sign-in; the calendar permission is
  short-lived, so the section occasionally asks to reconnect, and nothing else
  in the app is affected when it does. Token is device-local, never synced.
  Setup steps (enable the Calendar API, add the read-only scope) are in the
  README.

### Fixed (2.4 patches)
- **Dark mode now covers the Plan and Projects pages.** Their surfaces —
  the day timeline, day pills, recurring/backlog cards, project cards — were
  forced white and stayed white at night; they now follow the dark palette.
- **Calmer page background.** The full-screen sky behind the content was a
  five-stop gradient that showed as three stacked colour bands down the left
  and right edges. It's now a single soft wash at the very top resolving to
  one solid colour, so the edges read as one calm tone in both themes. The
  moon/stars scene in the top card is unchanged.
- **Unmarking a prayer re-arms the 15-minute lock.** Marking a prayer done
  and then unmarking it — any time within that prayer's window — now starts a
  fresh 15-minute unskippable lock, by design, to discourage marking a prayer
  you haven't prayed. The penalty is stored device-locally so a page reload
  can't dodge it.
- **Scheduled tasks now sync like everything else (patch).** On the built-in
  backend, the in-session auto-push was gated on a per-device URL that is empty
  when the baked backend is used — so weekly task edits only reached the server
  on the next app launch, appearing as "tasks don't sync" while settings and
  backlog (changed in earlier sessions) seemed fine. Auto-push now keys off the
  effective backend, and pending edits are flushed the instant the app is
  hidden or closed, so tasks added right before backgrounding aren't stranded.

---

## [2.3] — 2026-07-11

Fixes the Gemini 429, adds Google sign-in for sync, hardens the prayer gate,
and rounds out habits (period grouping, focus, missed-days recovery).

### Fixed
- **Gemini sorting no longer 429s on a fresh key.** v2.2 called
  `gemini-2.0-flash`, a model Google retired on 2026-03-03 — requests to it
  come back as quota errors. The sorter now uses **Flash-Lite** (ample for
  sorting a task list, and the most generous free-tier limits) via the
  `gemini-flash-lite-latest` alias, which tracks the newest version so future
  retirements can't silently break it, with a pinned fallback. Genuine 429s now
  show a useful message: free-tier limits are per-minute and per-day, with the
  daily quota resetting at midnight Pacific.

### Added
- **The first 15 minutes of each prayer are unskippable.** When a prayer's
  period begins, the gate shows a countdown instead of the "I've prayed"
  button — that time belongs to the prayer and cannot be dismissed. After 15
  minutes the button returns and the gate behaves as before. (The Fajr
  carry-through-morning lock is past its own first 15 minutes by definition,
  so it stays dismissible.)
- **Habits are grouped by time period** on the Habits page — Fajr through Isha
  in day order, each group under its period heading.
- **Focus on a habit.** Open a habit and start a 5–45 minute focus lock on it,
  identical to the task focus lock, with the habit's name on the lock screen.
- **Missed habits appear in Overdue** — each unkept day from the past week
  (never earlier than the habit's creation) is listed with its date and
  period; checking one backfills that day's log and feeds the streak. The
  Overdue count now includes them.
- **"Continue with Google"** in Settings → Sync. The in-app code is done; it
  needs a one-time ~10-minute setup on your side (Google Cloud OAuth client +
  enabling the Google provider in Supabase) — exact steps in the README.
  Email + password continues to work with no setup. Note: the same email via
  password and via Google are *different* Supabase users with separate data —
  pick one method and stick with it.

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
