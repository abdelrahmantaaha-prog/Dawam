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

**Commitment mode has no step-out.** There was one — a 2.5-second hold on the
lock screen bought five minutes outside — and the test it failed was not
technical: it became the ordinary way to open the laptop, a ritual performed
without deciding anything, which is precisely the habit the mode exists to
interrupt. A door with a slow handle is a door. The machine opens by naming what
you are about to do, and **resting is one of the things you can name**: the
focus page starts a real round on a reward, with its own clock and its own end,
which is the difference between resting and drifting. Nothing is charged for it
— cashing a reward in is a deliberate act on the points page, and making every
rest cost something would only teach you not to rest.

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
also means a relative `/api/me` never leaves the phone: sync would report "no
backend" however the deployment is configured, and no amount of rebuilding
would change it. The app therefore aims its data calls at the deployment by
default when it is running natively (see the second option below). Settings
shows the URL it actually probed and what came back, which is how you tell a
misaimed probe apart from a genuinely backend-less build — read it before
theorising.

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

**Keep the bundle local and point only the API elsewhere.** This is what the
APK does now, with no flag to set: `apiBase()` in `src/sync.js` returns the
deployment whenever `Capacitor.isNativePlatform()` is true, and `VITE_API_BASE`
overrides it for a build that needs somewhere else. On-device data and offline
start survive, because only the data calls move. Cookie sign-in does not travel
— `SameSite=Lax` session cookies aren't sent from `https://localhost` — so the
phone gets onto an account with a **device code** instead: mint one in Settings
→ Sync on a signed-in device, paste it into the APK. That is built and it works.

Two rules this path lives or dies by, both learned the hard way:

- **The base is resolved per call, never once at module load.** Reading
  `window.Capacitor` at module scope makes sync depend on the native bridge
  winning a race against the bundle. Lose it and the base is pinned to `''` for
  the life of the process — the app asking its own WebView for `/api`.
- **A cross-origin call must NOT ask for cookies.** The deployment answers a
  shell origin with `Access-Control-Allow-Origin` and deliberately no
  `Access-Control-Allow-Credentials`; that absence is what keeps the cookie
  session same-origin and its CSRF posture intact. A fetch with
  `credentials: 'include'` against such a response fails the CORS check
  outright — the caller gets a thrown "Failed to fetch" and never sees the 200
  underneath. That is precisely how the APK came to report "no sync backend"
  against a deployment that was up and answering: the `/api/me` probe could not
  read its own success. Cross-origin, the Bearer device token IS the credential
  (`credentialsMode()`); `tests/sync-transport.test.js` holds the line.

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
src/recur.js        when a recurring task is actually due (daily / weekly /
                    monthly), and how a monthly date lands in a short month
src/quota.js        a numbered project's share of TODAY, divided by the
                    sittings that are left rather than the calendar days
src/weekdoc.js      a week document carries its own week (`ws`), and the stamp
                    decides where a write lands — not the caller
src/nowlock.js      the fifteen-minute lock: is it due, and what clears it
src/applock.js      lock task mode on Android — the phone half of that lock
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
  cross-week features (tasks under a Project, overdue, and multi-day tasks that
  start in one week and end in the next) are complete.
- **A week document is only meaningful next to the key it is filed under**, since
  tasks carry a 0–6 day index and nothing else saying which week. Two rules keep
  that pairing honest, and both were learned by losing a week to it:
  never compare a week ISO against `weekStart` inside an async function or a
  memoised callback (use `weekStartRef.current` / `displayedISO()` — a value
  captured by an enclosing render can be answering for a view that has moved
  on); and never save a week document by any route but `saveWeekDoc`, which
  asks the document which week it is via `writeTarget` and redirects a
  misaimed write instead of letting it overwrite a different week.
- Read the displayed week's tasks from `weekShown`, not `week`. Picking a date
  sets `weekStart` synchronously while the document loads in an effect;
  `weekShown` resolves it during render so the two can never be a week apart.
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

## Multi-day tasks

A task can carry an **until** date and then belongs to every day from its own
through that one. There is still exactly one task: it is stored once, in the
week that owns its first day, and ticking it anywhere finishes it everywhere.
The later days show a reference — "day 2 of 4" — rather than a copy, which is
what lets that number be true.

The rule that makes the feature worth having is that a spanning task is **not
overdue while its span is still running**. "Read the report by Thursday" should
sit quietly on Tuesday and start shouting on Friday. `slotPassed` judges it on
the last day of the span, not the first.

A borrowed copy cannot be dragged — it lives somewhere else, and moving it from
a day it does not belong to would be a lie about what happened. Tapping it
opens the real task on its own day.

## Recurring tasks have a schedule

Every day, weekly on the weekdays you pick, or monthly on the dates you pick.
**Plan the day** offers only what is due on the day being planned.

That is the whole point: a weekly chore offered seven times a week is how a
person learns to press Skip without reading, and once that habit forms the
wizard has stopped working for everything else too.

A monthly date past the end of a short month lands on its last day — the 31st
fires on 30 September and on 28 February. A rent reminder that skips February
is worse than one that arrives a day early. A schedule with nothing picked yet
is due every day rather than never: mid-edit is not a silent stop, and a
recurrence that quietly stops appearing is indistinguishable from a deleted one.

Recurring tasks also carry a project now, and hand it to every task they create.

## Projects that ask for their share of the day

A project with a number on it (**Projects → Remind me to work on this**) can
name the weekdays it is worked on and the period it should surface in. On those
days it appears in Plan and in Now — "The Book · 11 pages today" — with the box
to log progress on the line itself, and goes quiet the moment the share is in.

**The pace divides by the sittings that are left, not the calendar days.** A
hundred pages in ten days is ten a day only if you work all ten; someone who
writes on Tuesdays and Thursdays has three sittings, and telling them "ten
pages" every Tuesday sets them up to miss by a factor of three, invisibly. The
number rounds up, because a third of a page is still a page you have to open.

Effectively a habit with an end date, which is why it reads like one.

## Focus targets

A task can carry a **focus target** in minutes: not "is this finished" but "did
it get the time I promised it". Measured rounds count towards it, per date, so
a target on something you return to all week means something on each of those
days. Minutes are banked when a round ends whether or not the task is ticked
off — work that is never really "done" is exactly the case a target is for.

## The queue does not negotiate

A task the Now queue has actually presented — offered as the thing to do now,
not merely listed under **Next** — stops being movable. Its grip becomes a
lock, and its date, period and times freeze in the editor.

The one-thing-at-a-time design makes rearranging Plan feel free: drag the task
you do not want below the next one and the queue obligingly hands you something
easier. Four of those and the day has been renegotiated into whatever was most
comfortable, with no moment where you noticed you were doing it.

Two answers remain: do it, or **delete** it. Deleting stays available on
purpose — the point is not to trap you with a task that turned out to be wrong,
it is to make dropping it a decision with a name rather than a drag that leaves
it looking planned. Ticking it off releases every field again, so undoing a
mis-tap does not leave it frozen.

## The Now lock

Off unless you switch it on (**Settings → The Now lock**). Once on: every
fifteen minutes in which nothing at all was finished, the app stops being an
app. Not a banner behind which the planner keeps working — nothing is
reachable, including Settings and the switch itself, until one task or a single
step of one is ticked.

Four rules keep it from being a trap:

- **It never fires on a day with nothing left to do.** Locking someone out of a
  finished day is punishing them for finishing it.
- **Any completion clears it.** A subtask counts; the two-minute version of a
  habit counts. The bar is "you moved", not "you moved enough" — a lock that
  demands a big task is a lock that gets solved by force-quitting the app.
- **The clock runs from the last thing you finished**, not from the top of the
  hour, so a productive stretch is never interrupted and a lock you just
  satisfied does not come straight back.
- **It never appears during a focus round.** A round in progress is the
  strongest evidence the app has that work is happening; covering the screen in
  the middle of one would interrupt the exact behaviour the lock exists to
  produce, and do it to the person who was already doing the right thing. A
  finished round counts as activity, so the lock is not waiting on the other
  side of it either.

And one thing you can always do while it is up: **write something down.** Quick
add opens over the lock. It does not clear it — only finishing something does —
so it costs the commitment nothing, and it saves the one thing the commitment
would otherwise have destroyed, which is the thought you had while being held.

### On a phone

Covering the app is the whole lock on a laptop, where the desktop shell owns
every display. On a phone it is barely half of one: the page can be as complete
as it likes and Home still leaves. So the lock asks Android for **lock task
mode**, the platform's own kiosk primitive, which takes Home, Recents and the
notification shade away for as long as it is held — there is no route out to
Settings either.

It comes in two strengths, and the card says which one it actually got rather
than claiming the better one:

| Mode | What it is |
| --- | --- |
| **pinned** | The ordinary case. Android shows its own confirmation and you can leave by holding Back and Overview together. A speed bump with a name. |
| **locked** | Rhythm is the device owner. Nothing leaves until the app releases it. |

The second needs provisioning once, by hand, from a computer, on a device with
no accounts on it yet:

```bash
adb shell dpm set-device-owner app.rhythm.planner/.RhythmDeviceAdmin
```

That cliff is deliberate. Device ownership is the real thing and should cost a
cable and a wiped phone, not a toggle flipped while annoyed. The receiver it
needs declares **no policies at all** — every other power device ownership
carries (wiping the device, forcing a password, disabling the camera) is left
unclaimed.

> **What this deliberately does not do: block the Accessibility settings page.**
> An app cannot block the system Settings app, and it cannot single out one
> screen inside it. The technique that used to — an accessibility service
> watching for that screen, or an overlay drawn on top of it — is exactly what
> Android hardened against (Settings hides overlays from Android 12 on), and
> Play policy restricts accessibility services to accessibility. It would break
> on the next release and could not be published. Lock task mode is stronger
> for this purpose anyway: it does not block one screen of Settings, it blocks
> leaving Rhythm at all.

## Points can go down

Rewards make the number worth having; **penalties** are what make it worth
protecting, and they are for the habits you are trying to stop. Two shapes, both
priced by you: a **cost**, which subtracts a fixed number, and a **wipe**, which
takes the balance to zero.

A wipe is still an entry, never a delete. It writes minus whatever the balance
was, so the ledger sums to nothing and the whole history is still there to read
— a balance of zero with no history is a balance with no meaning. And unlike
ticking a task, penalties are deliberately **not idempotent**: the same slip
twice costs twice, because it happened twice.

Charging one is a two-tap confirm, and a wipe names the number it is about to
take before it takes it.

## Quick add

One button, one line, from any page. The same parser every other box uses, so
"call the dentist tomorrow 3pm #calls %Health" lands where it says it lands.
Without a date in the words it goes onto today at whatever period is running —
the answer that needs no decision — and the backlog is one tap away.

While you type a `#tag` or a `%project`, the matches appear under the box.
The list is generated by the **parser's own matcher**, so picking a name and
typing the letters can never mean different things; a list that disagreed with
the parser would teach a syntax the app does not have. A chosen name with a
space in it is quoted, because unquoted `%Bugs and Features` tags "Bugs" and
leaves two words loose in the title.

On Android the home-screen widget has a **+** that opens the app straight into
that sheet. A widget cannot host a text field — RemoteViews has no such view,
which is why every "quick add" widget on Android is a shortcut into its app —
so this is the honest whole of what one can be.

## Habit stacking, made real

"After I pray Fajr, I will read ten pages" used to be a sentence printed on a
card while both habits sat in the queue at once, in whatever order their blocks
ran. The stack was a label on something the app was not doing.

A stacked habit now **waits**. It stays out of the Now queue until its anchor is
done that day, and the moment the anchor is ticked it is the very next thing you
see. That is the whole mechanism the book describes — the anchor is the cue, and
a cue that fires at the wrong time is not a cue.

Three things it refuses to do, each of which would lose a habit off the screen:
a missing anchor (deleted, or from an old backup) releases it; a cycle releases
both; and a chain is walked, so a habit three deep waits for everything above it
rather than only its parent.

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

Four things sit outside that queue:

- **Outstanding prayers.** A prayer whose period has passed and was never
  marked leaves the queue entirely and sits above everything until it is dealt
  with. The queue works by hiding what is not next, which is exactly the wrong
  treatment here: it put the prayer behind however many tasks happened to sit
  above it. The prayer for the *current* period has not been missed yet and
  stays in the queue where it belongs.
- **Getting ready.** A timed task appears under **Get ready** `leadMin`
  minutes before it starts (30 by default, Settings → The Now page, zero turns
  it off). A meeting that surfaces at the minute it begins has already begun;
  the lead is the difference between being told about a thing and being able to
  be at it.

and the two that always did:

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

