# Rhythm Desktop — the planner and the focus suite in one app

This is Rhythm on Windows: the same planner you use in the browser, in its own
window, plus everything **Anchor** used to be — the always-on-top overlay, the
drift watch, force-return, the break blackout, chair detection, hard blocks and
free times. Anchor is not a separate app any more; this is where it lives.

The point of putting them together is the seam between them:

- A focus round can be started **from a task you actually planned**. The task's
  own slot sizes the round, or — when it has no slot — whatever past rounds
  taught Rhythm the task takes.
- "Focus this" anywhere in the planner (a task, a habit) now starts a real
  round with the overlay and the drift watch, instead of the plain countdown
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
| `src/poller.js` + `src/active-window.ps1` | Foreground-window polling through a PowerShell sidecar, so there are no native modules to build |
| `src/enforcer.ps1` | Minimize-the-offender / refocus-your-work window commands for force-return |
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

## Notes

- Distraction matching is substring-based on `title + process name + address-bar
  domain`, case-insensitive, so browser tabs are covered with no extension.
- Force-return minimizes the distracting window. Nothing is closed, nothing is
  killed, no data is lost.
- Chair detection pauses the round when it cannot see you — worth knowing if a
  round ever looks like it stopped counting.
- Chair detection also matters when packaging: the camera window loads its
  model over `file://`, which is why the model and MediaPipe stay unpacked.
