# Rhythm Desktop — the planner and the focus suite in one app

This is Rhythm on Windows: the same planner you use in the browser, in its own
window, plus everything **Anchor** used to be — the always-on-top overlay, focus
modes, the break blackout, chair detection, hard blocks and free times. Anchor is not a separate app any more; this is where it lives.

The point of putting them together is the seam between them:

- A focus round can be started **from a task you actually planned**. The task's
  own slot sizes the round, or — when it has no slot — whatever past rounds
  taught Rhythm the task takes.
- "Focus this" anywhere in the planner (a task, a habit) now starts a real
  round with the overlay, instead of the plain countdown
  the web build falls back to.
- When the round ends, the planner is told — with the task id and the time
  actually spent. It offers to tick the task off, and it learns the duration
  from what was measured rather than from what was guessed. A duration you
  typed yourself still wins; a measured one only ever overwrites another
  measurement.

## Run

```bash
npm install                 # once, in this folder — pulls Electron
cd .. && npm run desktop    # builds the planner, then launches the app
```

During UI work, run the planner's dev server and point the shell at it, so
edits hot-reload inside the real Electron window:

```bash
npm run dev -- --port 5199  # in the repo root
npm run desktop:dev         # in this folder (or `npm run desktop:dev` from the root)
```

`RHYTHM_DEV_URL` overrides the dev address if 5199 is taken.

## How it is put together

| File | What it is |
| --- | --- |
| `src/main.js` | App bootstrap, tray, every window, all the IPC |
| `src/session.js` | The session state machine and drift accounting — Anchor's, plus the planner task id it now carries |
| `src/bubble.js` | What a bubble's items (apps, sites, old keywords) let through. Pure; tested in `tests/bubble.test.js` |
| `src/bubbles.js` | Everything around a bubble: the wall, the dock, drops, the bubble browser, Brave's extensions, the bridge to the Brave extension |
| `src/poller.js` + `src/active-window.ps1` | The foreground-window watcher, a PowerShell sidecar so there are no native modules to build. Event-driven (Windows says when the window in front changes) with a 1.5 s heartbeat |
| `src/enforcer.ps1` | Minimize-the-offender / refocus-your-work window commands, plus `activate` and `list` for the dock and the drag palette |
| `../brave-extension/` | The Rhythm extension for Brave (loaded unpacked; copied to `%APPDATA%/Rhythm/brave-extension` on launch) |
| `src/store.js` | Settings, templates and history in `%APPDATA%/Rhythm/rhythm-focus-data.json` |
| `src/preload.js` | The one bridge, `window.rhythmFocus`, shared by every window |
| `src/windows/` | Overlay, break blackout, away blackout, and the hidden presence worker |
| `smoke.mjs` | End-to-end test of the seam, driven over the DevTools protocol |

### Why the planner is served from `rhythm://app`

Rhythm keeps everything in `localStorage`, and `localStorage` is keyed by
origin. `file://` hands every document its own opaque origin, and a localhost
server moves the data whenever the port changes — either way a plan written
today could be gone tomorrow. A registered standard scheme is one fixed, secure
origin for the life of the app.

That build leaves the PWA plugin out (`npm run desktop:build` sets
`RHYTHM_DESKTOP=1`): service workers refuse to register on anything but
http(s), an installed app has no use for one, and its registration only ever
produced a console error.

### Your Anchor data comes with you

On first launch, if there is no `rhythm-focus-data.json` yet, the store reads
Anchor's own `%APPDATA%/anchor/anchor-data.json` and adopts it — settings,
templates, learned filters and history. Anchor's file is left where it is;
nothing is deleted.

## Sync

The planner's sync calls are same-origin, and `rhythm://app` has no `/api`, so
sync reports "no backend" here exactly as it does in the APK. Pointing a
desktop build at a deployment needs `VITE_API_BASE` at build time — and
cookie-based sign-in from a custom scheme is its own problem, which the desktop
OAuth work (holding a real refresh token in the shell) is meant to solve.

## Testing

```bash
npm run smoke     # from this folder, or `npm run desktop:smoke` from the root
```

It launches the app against a throwaway user-data directory, starts a real
one-minute round from the planner window, pauses it, resumes it, stops it past
the thirty seconds a stopped round needs to count, and checks that the finished
round arrives back in the planner carrying its task id and its measured time.
About 45 seconds. Rhythm must not already be running — the single-instance lock
would send the test's copy straight back out.

## Commitment mode

Focus settings → Commitment. While it is on and no round is running, every
display is covered by a lock screen; the planner window rides above the lock,
because the way out is through it — name the task, give it a duration, start
the round. The lock screen's escape is a held press (2.5s), which buys a
configurable few minutes outside; releasing early resets. All of it lives in
main.js (`lockWanted`/`showLockScreens`) and `windows/lock.*`.

## Account sync

The planner's origin is rhythm://app, so its own fetch could never carry the
deployment's session cookie. Every /api call is relayed through the main
process instead (`sync-fetch`), which has no CORS and no SameSite rules; the
deployment needed no changes. Sign-in opens a real window on the deployment
(Settings → Sync), and the cookies land in the app's own session. The server
address defaults to rhythm-ruby.vercel.app and can be overridden with a
`syncBase` key in the focus settings file.

## Building an exe

```bash
npm run desktop:dist
```

From the repo root. It builds the planner with `RHYTHM_DESKTOP=1` and then runs
electron-builder, leaving two files in `desktop/release/`:

- **`Rhythm-Setup-<version>.exe`** — the installer. Pick this one. It asks where
  to install, makes the desktop and Start-menu shortcuts, and installs per-user
  so it needs no administrator. Uninstalling deliberately leaves your data
  behind (`deleteAppDataOnUninstall: false`).
- **`Rhythm-<version>-portable.exe`** — one self-extracting file, nothing
  installed. Slower to start, because it unpacks itself on every launch. Your
  plan still lives in `%APPDATA%/Rhythm`, not next to the exe, so the two
  builds share one set of data.

`npm run desktop:pack` skips the installers and just writes
`desktop/release/win-unpacked/` — faster when you only want to test the packaged
app. The build is unsigned, so SmartScreen will warn on first run
("More info" → "Run anyway").

Three things in the code exist only because of packaging, and they are easy to
undo by accident:

- The planner build ships as an **extra resource** (`resources/dist`), not inside
  `app.asar`. `DIST` in `main.js` switches on `app.isPackaged` to find it.
- The two PowerShell sidecars are **unpacked**. `powershell.exe` is an outside
  process and cannot read a path inside `app.asar` — `sidecar()` in `poller.js`
  rewrites `app.asar` to `app.asar.unpacked`.
- The face model and `@mediapipe/tasks-vision` are unpacked for the same class
  of reason: the presence window fetches its wasm and model as real files.

Verify a build the same way the source is verified — the smoke test takes a
binary:

```bash
RHYTHM_SMOKE_BIN=desktop/release/win-unpacked/Rhythm.exe node desktop/smoke.mjs
```

## Bubbles

A bubble (what a focus mode became) is the set of things that may be in front
of you during a round, made by dropping them onto the board on the Bubbles
page: a program or its shortcut, a link, one of the windows open now — or a
typed site or keyword.

- **What an item lets through** (`src/bubble.js`). An *app* is known by its
  program's file name, so a window that merely mentions it is not it, and an
  app that updates itself into a new folder is still the same app. A *site*
  allows that domain and everything under it, nothing beside it. A browser put
  in as an app means that browser with any site. *Words* are the old keywords,
  matched the old way (`title + process + domain`), so focus modes saved before
  bubbles keep working exactly as they did — they load as word items.
- **Judging** is immediate for apps. Browser windows still get the settling
  seconds, because a page wears the wrong title and address while it loads.
  Store apps are seen through ApplicationFrameHost to the app inside it.
- **The wall** covers each screen's work area while a bubble runs (Bubble
  settings → Cover the screens). It is a normal window, not always-on-top: the
  bubble's things sit above it, everything else is minimized behind it. The
  main screen's wall is the dock — tap an app to bring it forward (or start it),
  a site to open it.
- **The bubble browser** (`persist:bubble` session) refuses a page outside the
  bubble before it is fetched (`webRequest`, main frames only; sign-in hosts are
  let through). It can load the extensions installed in Brave, straight from
  Brave's folder; ones whose background half needs Chrome APIs Electron lacks
  are reported as only partly working.
- **Brave** is held to the bubble by `brave-extension/`. Rhythm serves the
  running bubble on `127.0.0.1:47615` (47616, 47617 if taken), read-only; the
  extension long-polls it and turns it into `declarativeNetRequest` rules that
  swap an outside page for its own "not in this bubble" page. When it is
  listening, a Brave window on an outside site is left to the extension for a
  few seconds instead of being minimized whole.

## Notes

- Under a bubble, any window not in it is minimized the moment it comes to the
  front and you are put back on the last allowed window; allowed windows are
  simply open. There is no distraction list, grace period, nudge or "work or
  distraction?" question. A round without a bubble blocks nothing. Rhythm
  itself, the Windows shell, Task Manager and a blank browser tab are never
  blocked.
- **Always allowed** (Bubble settings → Lists) is inside every bubble, matched
  as keywords. It never makes a round without a bubble block anything.
- A round can carry a `projectId` (picked on the focus page or carried from
  the task); it rides into the history entry and the `round-ended` event, and
  the planner tallies the minutes on that project.
- Blocking minimizes the window. Nothing is closed, nothing is killed, no data
  is lost.
- The overlay and the planner are moved back onto a screen that exists whenever
  a monitor is unplugged or the displays change (`src/fit.js`).
- Chair detection pauses the round when it cannot see you — worth knowing if a
  round ever looks like it stopped counting.
- Chair detection also matters when packaging: the camera window loads its
  model over `file://`, which is why the model and MediaPipe stay unpacked.
