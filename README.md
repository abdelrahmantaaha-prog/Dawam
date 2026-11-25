# Dawam · دوام

**A daily planner built around the five prayers.**

Dawam divides the day into the blocks between prayers instead of hours, and the
day runs from Fajr to the next Fajr. It is local-first: your planner lives on
your device, works offline, and needs no account. Sync between devices and the
AI features are optional.

The name comes from the hadith "the deeds most loved by Allah are the most
constant, even if small."

## Features

- **Plan and Now.** Plan lays the day out block by block. Now shows one thing
  at a time: the next task, prayer, habit or subtask, with timed tasks surfacing
  when their window opens.
- **Slot the day.** One press gives every remaining task a start and end time,
  sized from durations you have set before, then an AI estimate, then a simple
  rule.
- **Tasks**: subtasks, multi-day tasks, durations, tags, quick add with natural
  language (`call the dentist tomorrow 3pm #calls %Health`), recurring tasks
  (daily, weekly, monthly), a backlog and an overdue list.
- **Habits and projects**: streaks, habit stacking, two-minute versions, and
  projects with a numeric target that work out today's share from the sittings
  left before the deadline.
- **Points**: rewards for what you finish, penalties for habits you are trying
  to break.
- **Focus** (Windows app): focus rounds started from a planned task, allow-list
  focus modes, break blackouts and an always-on-top overlay. The Brave
  extension keeps the browser to the sites a round allows.
- **The Now lock** (optional): if nothing gets finished for fifteen minutes,
  the app locks until you finish something. On Android it uses lock task mode.
- **Calendars and Trello**, read-only: events become time the planner won't
  schedule over, and Trello cards with due dates show up on their day.
- **Tera**, an optional assistant with a voice that speaks Egyptian Arabic and
  English. She runs on Claude with your own Anthropic key, can do anything you
  can do by hand, and every change she makes comes with Undo. On Android she can
  check in on you while the app is closed.
- **Brain dump and dictation**: messy notes sorted into tasks, using Gemini
  with Groq as a fallback.
- **Arabic and English**, light and dark themes, notes, boards, and automatic
  backups.

## Platforms

| Build | How to get it |
| --- | --- |
| **Web / PWA** | Deploy `dist/` to any static host over HTTPS, then *Install app* or *Add to Home Screen* |
| **Windows** | The Electron app in [`desktop/`](desktop/README.md), which adds the focus suite |
| **Android** | The Capacitor app in `android/`, which adds reminders that fire while the app is closed, a home-screen widget, the lock, and Tera's check-ins. CI builds the APK |
| **Brave extension** | [`brave-extension/`](brave-extension/README.md), works with the Windows app |

## Getting started

```bash
npm install
npm run dev          # dev server
npm run build        # production build in dist/
npm test             # unit tests (vitest)
```

Windows app:

```bash
npm run desktop:install   # once, installs Electron into desktop/
npm run desktop           # build the planner and launch the app
npm run desktop:dist      # build an installer
```

Android (needs JDK 17 and the Android SDK):

```bash
npm run android:sync      # build and copy into the Android project
npm run android:apk       # build a debug APK
```

Or run **Actions → Build Android APK** on GitHub. To get APKs that install over
each other, add the `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` repository secrets. Without them
each build has a new debug signature, so you have to uninstall first, which
erases the planner's data on that phone. Export a backup before reinstalling.

## Your data

- Everything is stored in the browser's `localStorage` on your device. Clearing
  site data clears the planner.
- **Automatic backups** are on by default: a snapshot every hour, one file per
  day, the last 14 kept and restorable from Settings. On Windows they go to
  `Documents\Dawam backups`, on Android to the app's private storage, and in
  the browser to IndexedDB.
- **Settings → Backup** exports and imports a `.json` file.
- The PIN is a soft lock, not encryption.
- Nothing is sent anywhere unless you use the AI features (your text goes to
  the provider you configured), connect a calendar or Trello, or turn on sync.

## Optional configuration

**AI keys** are entered in the app's settings and stay on that device: a
Gemini key (free at [aistudio.google.com](https://aistudio.google.com/apikey)),
an optional Groq key as fallback, and an Anthropic key for Tera.

**Sync between devices** needs a deployment of `api/` (one Express function on
Vercel) with Postgres:

| Variable | What |
| --- | --- |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth client, callback `https://<your-app>/api/auth/callback/google` |
| `DATABASE_URL` | Postgres connection string (e.g. Neon) |

Without these, sync reports itself unavailable and the app works locally as
usual. Phones without a session cookie sign in with a device code made on a
signed-in device.

Build-time variables: `VITE_API_BASE` (where the Android app sends sync calls),
and `VITE_BROKER_URL` / `VITE_BROKER_TOKEN` to use a self-hosted AI key broker
before the keys in settings.

## Project layout

```
src/              the app (React): App.jsx, core.jsx, views, sync, focus, Tera
shared/           data model and merge, used by the app and the server
api/              sync server and calendar relay (Vercel)
desktop/          Windows app (Electron) with the focus suite
brave-extension/  keeps Brave to the current focus round
android/          Capacitor app, with native reminders, widget, lock and Tera
tests/            vitest suites
docs/             design notes
```

[`docs/DESIGN.md`](docs/DESIGN.md) covers how things work and why: the day
from Fajr to Fajr, slotting, multi-day and recurring tasks, project pace, the
lock, the sync merge, Android sync, Tera's tools, and notes for contributors.
[`CHANGELOG.md`](CHANGELOG.md) has the release history.

## Name

Dawam was called Rhythm until version 3.11. Storage keys, the `rhythm://`
scheme, the Android package `app.rhythm.planner` and a few other identifiers
keep the old name on purpose, so existing installs keep their data.

## License

[MIT](LICENSE): free to use, copy, change and redistribute, including commercially.
