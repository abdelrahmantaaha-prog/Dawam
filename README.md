# Rhythm — v2.0

A prayer-time-anchored daily planner. **Local-only by design**: everything lives
in your browser's storage on your device. Nothing is synced, nothing is sent
anywhere (one opt-in exception: the AI brain-dump sorter, see below).

This is the Vite PWA edition of Rhythm, converted from the original single-file
Claude artifact.

## Run it

```bash
npm install
npm run dev        # local dev server
npm run build      # production build → dist/
npm run preview    # serve the production build locally
npm test           # unit tests (vitest)
npm run icons      # regenerate PWA icons into public/

npm run desktop:install  # once — pulls Electron into desktop/
npm run desktop          # build the planner, then launch the Windows app
npm run desktop:dev      # Electron pointed at the dev server on :5199
npm run desktop:smoke    # end-to-end test of the planner ↔ focus seam
```

Deploy `dist/` to any static host (Netlify, Vercel, GitHub Pages, a folder on
your own server). **The service worker requires HTTPS** (or localhost).

## Desktop app — the planner and the focus suite together

On Windows, Rhythm runs as its own app that also contains everything **Anchor**
used to be: the always-on-top overlay, the drift watch, force-return, break and
away blackouts, chair detection, hard blocks and free times. Anchor is not a
separate program any more — see `desktop/README.md`.

What the merge is for is the seam between the two halves. A round is started
**from a planned task**, sized by that task's own slot or by what past rounds
taught Rhythm it takes; "focus this" anywhere in the planner starts a real round
instead of the plain countdown the web build falls back to; and when the round
ends the planner is told, with the task id and the time really spent, so it can
offer to tick the task off and learn the duration from measurement rather than
from a guess. A duration you typed yourself still wins.

The focus view and its nav button exist **only** where the shell does: the web
and Android builds see no bridge on `window` and render neither, rather than
shipping buttons that cannot work.

## Calendars and Trello (read-only)

Rhythm can plan around what you have already committed to. **Settings →
Calendar** takes a feed address (in Google Calendar: Settings → your calendar →
Integrate calendar → "Secret address in iCal format"); everything on it becomes
time the planner will not schedule over. On the desktop you can sign in to
Google properly instead — the shell holds a refresh token, so it is
authorise-once rather than the hour-long token a browser gets. Both routes ask
for read access only; Rhythm never writes to your calendar.

All-day events do not block the day's hours by default — a birthday is a note
on the day, not a claim on it — and there is a setting for the minutes each
prayer block keeps for the prayer itself.

**Settings → Trello** takes your own API key and a token granted with
`scope=read` and no expiry. Cards with a due date appear under the day, and one
button copies one into your plan. The card is left alone.

Why the two connect so differently: Trello's API answers cross-origin, so the
page can call it directly on any platform. A Google feed does not, so the
desktop reads it in the main process and the web build relays it through
`/api/ics` — allowlisted to calendar hosts, https only, every redirect hop
re-checked.

## Install as an app

Open the deployed site on your phone → browser menu → **Add to Home Screen**
(Safari) or **Install app** (Chrome/Edge). Rhythm then launches standalone,
works fully offline (the service worker precaches the whole app and the fonts),
and updates itself automatically when you deploy a new build.

## Bring your data over from the artifact

1. In the artifact version: **Settings → Backup → Generate export → Download .json**
2. In this app: **Settings → Backup → import** (pick the file or paste it)

The import path accepts every prior backup schema and migrates in place.

## Where your data lives — and what that means

- Storage is the browser's `localStorage` for this site, on this device.
- **Clearing site data / browsing data deletes your planner.** Export a backup
  file periodically. There is deliberately no cloud copy.
- The PIN is a soft lock (deters casual access). It is not encryption; the data
  in localStorage is readable by anyone with technical access to the device.

## AI features (optional)

The brain-dump sorter, the planning assistant, dictation and task sizing all
share one transport: **Google Gemini (free tier) primary, Groq (free tier) as an
automatic fallback**, with the shared key pool in front of both when this copy
is pointed at one. Keys live under **Settings → Backup → AI features**,
stored only on this device.

### The assistant can change anything you can

It reads a snapshot of the week — every task with its id, the backlog,
recurring tasks, habits, prayers, overdue, projects, rewards, the alarm and
your settings — and answers in plain language. When a change would help it
proposes one, and **nothing happens until you approve it**: per proposal, or
with the one *Approve all* button when a single sentence meant several changes.

The set of things it can propose is a table in `src/assistant.js` —
`ACTIONS` — and it is the whole contract. The prompt the model reads is
generated from that table, and `validateProposal` walks the same table to
check what comes back, so the two cannot drift apart. Roughly: add / move /
edit / complete / reopen / delete a task, add and tick subtasks, everything the
backlog and recurring tasks do, habits and prayers, projects and progress,
rewards, slotting a day, focus sessions, the wake alarm, pulling overdue
forward, moving around the app, and the language / theme / clock / prayer-gate
settings.

Two rails hold, whatever it says:

- **Only ids the snapshot showed it.** A proposal naming anything else is
  dropped before it can be displayed, so an invented id can never reach a
  week document. Overdue tasks from earlier weeks have no ids in the
  snapshot — `overdue_to_today` is the only way to reach them.
- **Values are whitelisted, not trusted.** Periods, dates, times, views,
  themes and settings keys are each checked against a fixed list; numbers are
  clamped. A malformed proposal is dropped rather than guessed at.

### Dictation

Both the assistant and the brain dump have a microphone, in the browser and on
a phone. Which engine runs depends on what the shell offers, and the app does
not ask you to care:

- **Web Speech** where the browser has it (Chrome, Safari). Words appear as
  you say them, and it costs no model tokens.
- **Record and transcribe** everywhere else. The Android WebView Capacitor
  runs in has no `SpeechRecognition` at all. Electron is sneakier: it defines
  the interface and opens the microphone, then fails with `error:network`,
  because the open-source Chromium it is built from carries no credentials for
  Google's speech service. A feature check cannot see that, so the live lane is
  believed until it says otherwise and retired for the session when it does —
  the handover happens inside the same press, so the person just keeps talking.
  The clip is re-encoded in the page as 16 kHz mono WAV (Chrome records
  `audio/webm;codecs=opus`, which Gemini's API does not list as accepted) and
  sent to Gemini for transcription — through the key pool when one is
  configured. Nothing is stored: the clip lives in memory for one request.

  `node desktop/mic-probe.mjs` launches the real desktop window and prints
  what it offers, what Web Speech actually does when started, and whether the
  mic button rendered. That is where the Electron behaviour above was measured
  rather than assumed.

English and Egyptian Arabic both work, and so does mixing them in one
sentence. The Android build declares `RECORD_AUDIO`, asked for the first time
you tap the mic; the desktop app grants `media` to its own origin and nothing
else.

### The shared key pool

`VITE_BROKER_URL` and `VITE_BROKER_TOKEN` (or **Settings → key pool address
/ token**) point this copy at *keybroker*, which rotates the keys every project
in this folder shares and remembers the cooldowns they have all discovered.
It is tried first; the keys above are what answers when it cannot be reached.
A browser has nowhere to hide a token, so Rhythm holds its own — revocable on
its own without taking the other apps down.

For CI-built APKs, set the same two names as repository secrets: `.env.local`
is gitignored, so without them the build ships with no pool and every AI
feature asks for a key the phone does not have.

- **Gemini** — get a key at aistudio.google.com/apikey, no card needed. Rhythm
  calls Flash-Lite via the `gemini-flash-lite-latest` alias (with a pinned
  fallback), so Google's model retirements don't break anything. Free-tier
  limits are per-minute and per-day (HTTP 429; daily quota resets at midnight
  Pacific). Caveat: on the free tier, Google may use prompts to improve its
  products.
- **Groq (optional backup)** — console.groq.com. Used automatically **only on
  outage-type failures** (Gemini unreachable, rate-limited, or 5xx), never on
  configuration errors: a bad key fails loudly instead of being papered over.
  Different infrastructure, so the two rarely fail together. A Groq-only setup
  (no Gemini key) also works.

There is deliberately no provider switch. An earlier version had one, and it
was a trap: a key for one provider entered while the toggle pointed at the
other made every AI feature die with a 401 and nothing to say why. One primary,
one backup, zero configuration to get wrong. When you use these features, your
text is sent to the provider — an opt-in exception to local-only; the rest of
the app never touches the network.

## Cross-device sync

Optional, and off unless a deployment configures it. localStorage stays the
source of truth: the app works with no account and no network, and sync is a
background reconciliation — pull, merge, adopt, push — that never blocks a
render and never makes you wait to tick something off.

Sign in with Google (Auth.js), and the whole planner is stored as one document
per account in Postgres. Conflicts resolve **per key by most-recent edit** —
right for one person on a few devices, not for teams — and deleted keys carry
tombstones so pruning an old week isn't undone by the next pull. Device clocks
decide ties.

**Where it runs.** One Express function (`api/index.js`) on Vercel, Neon for
Postgres. Four environment variables, all server-side:

| Variable | What |
| --- | --- |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth client; callback `https://your-app/api/auth/callback/google` |
| `DATABASE_URL` | Neon connection string |

`GET /api/me` reports `{ auth, db, sync, user }`. With any of them missing it
answers `sync: false`, the Settings panel says so, and every sync is a clean
no-op — that is the supported local-only mode, not an error.

**Cadence.** There is no fixed timer. A sync runs on launch, ~4s after your
edits stop (`PUSH_DEBOUNCE`), when the app is brought back to the foreground,
and when the network returns. **Settings → Sync → "Sync now"** always runs
immediately.

**The bug this is built around.** Deciding "has anything changed?" with
`JSON.stringify` compares key *order*, which is an artefact of how an object
was built — the server builds the merged document one way and `migrate()`
rebuilds it another. An unchanged document then compares unequal on every round
trip, so the client pushes, adopts, sees a difference, and pushes again,
forever. Every comparison goes through `fingerprint()` in `shared/model.js`,
which sorts keys; **none use `JSON.stringify`.** Keep it that way.

### Sync in the APK

The APK serves the bundled build from `https://localhost` — the WebView's own
asset server. That is what makes Rhythm work with no network at all, but it
also means a relative `/api/me` never leaves the phone. Sync then reports "no
backend" however the deployment is configured, and no amount of rebuilding
changes it. Settings shows the URL it actually probed, which is how you tell
that case apart from a genuinely backend-less build.

Two ways out, and they trade against each other:

**Load the deployment directly.** `RHYTHM_REMOTE_URL=https://your-app npm run
android:remote` patches the synced (gitignored) `capacitor.config.json` with a
`server.url`. The origin becomes your domain, so the API, the session cookie
and the Google round trip all line up with no CORS and no cross-site cookies.
But **localStorage is per origin**: an install built this way cannot see data
written by a `https://localhost` install. Export a backup before installing,
import after. First launch needs the network; the service worker covers later
ones.

The script also lists Google's OAuth hosts under `server.allowNavigation`.
Without that, Capacitor sends the sign-in navigation to the system browser, the
callback sets the session cookie in *Chrome's* cookie jar, and the app comes
back still signed out. **Google may refuse the flow anyway**: it blocks OAuth
from embedded WebViews with `disallowed_useragent`, and Android's WebView is
identifiable. If that happens, don't spoof the user agent — it's Google's
anti-phishing control and faking it is against their terms. Sign-in then needs
a real token handoff: open the flow in a Custom Tab, finish it in the browser,
and hand a short-lived token back to the app through a deep link, which the app
exchanges for its own session. That is unbuilt, and it is the same work
option B needs.

Nothing above affects reminders, the widget or the vault — those are native and
origin-independent. Only account sync depends on sign-in.

**Keep the bundle local and point only the API elsewhere.** `VITE_API_BASE`
prefixes the data calls at build time, so on-device data and offline start
survive. Cookie sign-in from a different origin does not — `SameSite=Lax`
session cookies aren't sent from `https://localhost`, so this needs token-based
auth and a deep link back from the browser. Not built.

## Project layout

```
src/core.jsx        pure logic: i18n (tx), dates, prayer math, sky, blocks,
                    project pace, habits, settings migration
src/storage.js      async localStorage adapter (get/set/delete/list)
src/components.jsx  scene, flame glyph, habit line, block row, sidebar, editors
src/views.jsx       Habits, Projects, Settings, PIN screen
src/App.jsx         the main component: state, handlers, wizard, gate, routing
src/sync.js         backend-agnostic merge engine + twice-a-day cadence
src/focus.jsx       the focus suite's view + bridge hooks (desktop only)
src/calendar.js     iCalendar reader: parsing, recurrence, busy intervals
src/calsync.js      where feed text comes from (shell / direct / relay) and
                    where the expanded events are cached
src/calview.jsx     calendar settings + the day's agenda
src/trello.js       read-only Trello: boards, lists, cards that are due
src/trelloview.jsx  Trello settings + due cards in the day
api/_ics.js         the calendar relay's guard rails (allowlist, hop checks)
desktop/            the Electron shell: Anchor's machinery in one process with
                    the planner. See desktop/README.md
src/styles.css      the full stylesheet (extracted from the artifact)
tests/core.test.js  unit tests for the pure functions
tests/sync.test.js  merge + cadence tests against a mock transport
scripts/gen-icons.mjs  PWA icon generator (pngjs)
```

Notes for future work:
- The translator is `tx(en, ar)` — renamed from `t` specifically so `.map((t) => …)`
  callbacks can never shadow it again. Keep it that way.
- All stored weeks are preloaded into the session cache at startup, so
  cross-week features (tasks under a Project, overdue) are complete.
- `npm test` covers pace math, streaks, block resolution, and the sync merge and
  cadence. Extend it when touching `core.jsx` or `sync.js`.
- Careful with `.sub > span` in CSS: it also matches `.sub-bullet` and will
  stretch that 5px dot into a bar (this shipped as a visual bug once).

## Android app (Capacitor) — reminders that fire with the app closed

The PWA is unchanged and still the primary target. The Android shell exists for
one reason the web can't do: **local notifications at an exact time while the
app is closed**, with no server and no push infrastructure (Android
`AlarmManager` via `@capacitor/local-notifications`).

It gives you:
- a **reminder when a timed task's window opens**;
- an **ongoing card** in the notification shade mirroring the Now page, which
  is sticky (not swipe-dismissible).

### Building the APK on GitHub (no local toolchain)

`.github/workflows/android.yml` builds it on GitHub's runners, which already
have a JDK and the Android SDK. **Actions → Build Android APK → Run workflow**,
then download the `rhythm-apk` artifact. It also runs on pushes to `main` that
touch the app, and pushing a `v*` tag additionally attaches the APK to a GitHub
Release — much easier to download straight onto a phone than a CI artifact.

> **Read this before you rely on it.** With no signing secrets set, CI produces
> a **debug** APK, and the runner generates a fresh debug keystore on every run.
> A different signature means Android refuses to install over the previous
> build — you have to uninstall first, **and uninstalling wipes the WebView
> storage your entire planner lives in**. So either set up signing below, or
> **export a backup from Settings before every reinstall**.

To get stable, upgradeable installs, add four repository secrets and CI will
build a signed release instead:

| Secret | What |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | store password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

Generate the keystore once, on any machine with a JDK:

```bash
keytool -genkeypair -v -keystore release.keystore -alias rhythm \
        -keyalg RSA -keysize 2048 -validity 10000
```

Keep that file safe and out of the repo (`*.keystore` is gitignored). Lose it
and you can never upgrade an existing install again — only uninstall and
reinstall, wiping data. Signing is wired through env vars in
`android/app/build.gradle`, so no key material ever touches the repository.

### Building locally instead

```bash
npm run android:sync    # vite build + cap sync
npm run android:open    # …and open Android Studio
npm run android:apk     # …and assemble a debug APK
npm run android:remote  # …and point the WebView at RHYTHM_REMOTE_URL (see above)
```

Needs **JDK 17** and the **Android SDK** (easiest via Android Studio).

Then in the app: **Settings → Sync → Enable reminders** (Android 13+ needs the
runtime notification permission; the request only ever fires from that button,
never on launch).

**How the PWA stays intact.** Every export in `src/notify.js` is a no-op unless
`Capacitor.isNativePlatform()` is true, and the plugin is behind a dynamic
`import()` — so the browser build never calls a Capacitor API and never even
downloads the notification chunk. Verify with the browser devtools: no
`local-notifications` request, `isNativePlatform() === false`.

Two things worth knowing:

- **Exact alarms need manifest permissions the plugin doesn't provide.**
  `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` are added by hand in
  `android/app/src/main/AndroidManifest.xml`; without them Android 12+ refuses
  `setExactAndAllowWhileIdle` and reminders drift or don't fire. `USE_EXACT_ALARM`
  is Play-restricted to alarm/reminder apps — fine for personal or sideloaded
  builds, needs justification if you publish.
- **The ongoing card is only as fresh as the last time the app ran.** Local
  notifications carry text fixed at schedule time and nothing of ours runs in
  the background, so it refreshes when the app is open or resumed. Making it
  update live while closed needs a native foreground service.

## Slotting the day

**Plan → "Slot the day"** gives every remaining task a strict start–end time in
one press. Sizing runs in three tiers, best available wins:

1. **Memory** — durations you've already established. Hand-setting a task's
   start and end teaches it (`manual`), and so does completing an auto-slotted
   task without touching its slot (`kept` — it remembers the duration you
   actually worked, not the guess). Keyed by task text, so next week's "Email
   the client" is sized by this week's evidence: free, offline, instant. A
   weaker source never overwrites a stronger one — once you've said 40 minutes,
   no model opinion changes it.
2. **AI** — with an API key set (Settings → AI), tasks with no memory are sized
   from their text by your model, clamped to 5–180 min and cached on the task
   until its text changes. Any failure — no key, offline, junk reply — falls
   through silently.
3. **Heuristic** — 25 min + 10 per subtask, capped at 90. The floor the app
   always stands on.

The task editor shows what the next slotting would use (`~40m (remembered)`). Manually timed tasks and vault windows stay put and everything else
flows around them; on today, packing starts from *now*. A block holding more
intent than time shrinks every slot in it proportionally (10-minute floor), so
an overfull day looks overfull everywhere instead of collapsing at the end;
what can't get even ten minutes is reported, never silently dropped. Slotted
times are real start/end times, so reminders, the Now page's timed windows and
the focus lock all apply. "Clear slots" removes only what the button wrote —
hand-set times are never touched, and editing a time by hand releases that task
from future clears.

## Sleep

During Isha the Now page shows bedtimes counted back from Fajr in ~90-minute
sleep cycles (+15 min to fall asleep), what sleeping right now fits, and — in
the Android app — one-tap wake alarms at Fajr or at the last cycle boundary
before it. **This is arithmetic, not measurement**: real sleep-phase detection
needs movement or heart-rate sensing all night, which no phone on a nightstand
can honestly do. Waking at a computed cycle boundary is the defensible version.
The alarm is a maximum-importance notification on its own channel (crank its
sound in system settings); it is not the system alarm-clock app, and it
respects Do Not Disturb unless you exempt the channel.

## The day, and the Now page

**The day runs Fajr → next Fajr.** Between midnight and Fajr you are still in
*yesterday's* day: nothing rolls over to overdue, the Plan page still highlights
yesterday, and the Now queue keeps serving that day. One helper — `logicalDayMid`
in `App.jsx` — decides this, and everything meaning "today" goes through it.
Don't reintroduce a calendar-midnight `new Date()` for "today".

**Now shows one thing at a time.** The queue is the whole day, every block
top-to-bottom in exactly the Plan page's order, with prayers, habits and a
task's subtasks folded in — so nothing left behind earlier in the day gets
skipped. Checking the card slides it out to the left and the next one in from
the right (skipped under `prefers-reduced-motion`).

Two things sit outside that queue:

- **Caught up.** When the head of the queue belongs to a *later* block,
  everything through the current period is clear: Now says *"You're all caught
  up."* and shows that item under **Next** as a muted look-ahead until its
  period arrives.
- **Timed tasks.** A task with **both a start and an end** is a commitment to a
  slot, not a queue item. While the clock is inside its window it surfaces on
  its own under **Happening now**, wherever it falls in the order. Outside that
  window it rejoins the queue so it can't quietly disappear.

**Time vault.** A task can carry a `secret` that is only legible inside its own
start–end window — write it any time, read it only when the window opens (it
surfaces on the Now card with a Copy button, then re-hides). Intended as a
commitment device: park a password behind a window so the app only hands it
back during the hour you allowed yourself.

> This is **friction, not security.** The value sits in `localStorage` in plain
> text and appears in `Settings → Backup` exports, so anyone with devtools can
> read it at any hour — including you. A time-lock you control can't be real
> cryptography: for the app to reveal it unattended, the key has to be on the
> device. Don't let it be the only copy of anything you can't recover.

Ordering is manual and drag-only: tasks reorder by dragging their grip in the
Plan timeline (which also moves them between prayer blocks); subtasks reorder by
dragging their text **inside the task's editor** — deliberately not in the
timeline, which stays a calm read/check surface. `tasksFor` sorts by `order`
alone, never by start time, so Plan and Now can't drift apart.

