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

**No backend is connected right now.** The Supabase backend (and the Google
Calendar integration that depended on its Google sign-in) were removed; the app
is fully local again. Export a backup from Settings to move data between
devices in the meantime.

The sync *engine* is still here and still tested — only the transport is gone.
`src/sync.js` keeps the per-key last-write-wins merge, the dirty queue and the
scheduling; it takes an injected `transport`:

```js
{ list()       -> [{ key, value, updated_at }]
  upsert(rows) -> void }
```

`createSync({ getTransport })` returning `null` means "no backend", and every
sync is a clean no-op. Wiring a new backend is one function — see
`getTransport` in `src/App.jsx`.

**Cadence.** Automatic sync runs at most **twice a day** (`AUTO_EVERY_MS`,
12 hours). A static PWA has no background scheduler, so "twice a day" means the
first app launch or foreground return past each 12-hour mark. **Settings →
Sync → "Sync now"** always runs immediately and resets that clock.

When a backend is connected, conflicts resolve per item by most-recent edit —
right for one person on a few devices, not for teams. Deletes don't propagate
(old weeks pruned locally linger remotely, harmlessly), and device clocks
decide conflicts.

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

Ordering is manual and drag-only: tasks reorder by dragging their grip in the
Plan timeline (which also moves them between prayer blocks); subtasks reorder by
dragging their text **inside the task's editor** — deliberately not in the
timeline, which stays a calm read/check surface. `tasksFor` sorts by `order`
alone, never by start time, so Plan and Now can't drift apart.

