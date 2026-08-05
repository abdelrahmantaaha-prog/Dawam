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
```

Deploy `dist/` to any static host (Netlify, Vercel, GitHub Pages, a folder on
your own server). **The service worker requires HTTPS** (or localhost).

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

## AI brain-dump sorting (optional)

The "Brain dump" box on the Plan page can file free text into your day using an
AI model. Pick a provider and add your key under **Settings → Backup → AI
sorting** (stored only on this device):

- **Google Gemini — free tier.** Get a key at aistudio.google.com/apikey, no
  card needed. Rhythm calls Flash-Lite via the `gemini-flash-lite-latest`
  alias (with a pinned fallback), so Google's model retirements don't break the
  sorter. Free-tier limits are per-minute and per-day (HTTP 429 when exceeded;
  daily quota resets at midnight Pacific). Caveat: on the free tier, Google may
  use prompts to improve its products.
- **Anthropic (Claude)** — paid; keys at console.anthropic.com.

When you use the sorter, your dump text is sent to the chosen provider — an
opt-in exception to local-only; the rest of the app never touches the network.

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

