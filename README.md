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

## Cross-device sync (optional)

Off by default. When enabled, your planner is copied to a **Supabase project
you own**, and your other devices pull from it. Conflicts resolve per item by
most-recent edit — right for one person on a few devices, not for teams.

One-time setup (~10 minutes):

1. Create a free project at supabase.com. Note the **Project URL** and **anon
   public key** (Settings → API in the Supabase dashboard).
2. In the Supabase **SQL Editor**, run:

   ```sql
   create table if not exists kv (
     user_id uuid not null default auth.uid(),
     key text not null,
     value text not null,
     updated_at timestamptz not null default now(),
     primary key (user_id, key)
   );
   alter table kv enable row level security;
   create policy "own rows" on kv
     for all using (auth.uid() = user_id)
     with check (auth.uid() = user_id);
   ```

3. (Recommended) In **Authentication → Providers → Email**, turn OFF "Confirm
   email" — otherwise account creation requires clicking a confirmation link
   before sign-in works.
4. In Rhythm: **Settings → Sync** → paste the URL and anon key → **Create
   account** with an email + password → it syncs immediately, seeding the
   account with this device's data.
5. On your other device: same URL/key → **Sign in** with the same account →
   everything pulls down.

### Google sign-in (optional, ~10 minutes once)

Email + password works with zero extra setup. To sign in with your Google
account instead:

1. In **Google Cloud Console** (console.cloud.google.com) → APIs & Services →
   Credentials → **Create OAuth client ID** (type: Web application). If asked,
   configure the consent screen first (External, just app name + your email;
   "Testing" status is fine for personal use — add yourself as a test user).
2. Under **Authorized redirect URIs**, add your Supabase callback:
   `https://<your-project>.supabase.co/auth/v1/callback`
3. Copy the client ID and secret into **Supabase → Authentication → Providers
   → Google** and enable it.
4. In **Supabase → Authentication → URL Configuration**, set the Site URL to
   your deployed app URL (and add it to the redirect allowlist).
5. In Rhythm → Settings → Sync → **Continue with Google**. The app redirects
   to Google and back, then syncs.

Note: use the same account method consistently — an email/password account and
a Google account with the same address are separate users in Supabase, with
separate data.

Afterwards it's automatic: local edits push a couple of seconds after you make
them, and the app pulls on launch, on returning to it, and on regaining
network. "Sync now" in Settings forces a round trip.

What sync changes about the privacy story: your data now lives in your Supabase
project as plain JSON, protected by your account and row-level security — no
longer device-only. The anon key is designed to be public; RLS is what keeps
rows private. Deletes don't propagate (old weeks pruned locally linger
remotely, harmlessly). Device clocks decide conflicts; for one person this is
fine.

## Project layout

```
src/core.jsx        pure logic: i18n (tx), dates, prayer math, sky, blocks,
                    project pace, habits, settings migration
src/storage.js      async localStorage adapter (get/set/delete/list)
src/components.jsx  scene, flame glyph, habit line, block row, sidebar, editors
src/views.jsx       Habits, Projects, Settings, PIN screen
src/App.jsx         the main component: state, handlers, wizard, gate, routing
src/styles.css      the full stylesheet (extracted from the artifact)
tests/core.test.js  unit tests for the pure functions
scripts/gen-icons.mjs  PWA icon generator (pngjs)
```

Notes for future work:
- The translator is `tx(en, ar)` — renamed from `t` specifically so `.map((t) => …)`
  callbacks can never shadow it again. Keep it that way.
- All stored weeks are preloaded into the session cache at startup, so
  cross-week features (tasks under a Project, overdue) are complete.
- `npm test` covers pace math, streaks, and block resolution (including the
  overnight-Isha window). Extend it when touching `core.jsx`.

## Google Calendar (read-only, optional)

Show your Google Calendar events inside the Plan day, each in its prayer
period, with all-day events pinned at the top. **Read-only** — Rhythm never
writes to or changes your calendar.

Setup (builds on the Google sign-in above):

1. In **Google Cloud Console → APIs & Services → Library**, enable the
   **Google Calendar API** for the project you used for sign-in.
2. In **OAuth consent screen → Scopes**, add
   `.../auth/calendar.readonly` (a "sensitive" scope). For personal/newsroom
   use, keep the app in **Testing** and add your users as test users — no
   Google verification review needed. Public distribution would require that
   review.
3. In the app: **Settings → Sync → Connect Google Calendar**. This re-runs
   Google sign-in requesting calendar access, then **Load my calendars** and
   tick the ones you want shown. Events appear on the Plan day.

How it works and its limits:
- The Google access token comes from your Supabase Google sign-in and is
  **short-lived (~1 hour)**; Supabase doesn't refresh provider tokens, so the
  calendar section will occasionally ask you to **Reconnect**. Everything else
  in the app is unaffected when it lapses — the events just stop showing until
  you reconnect.
- The token is stored only on this device and is never synced.
- Events are fetched per viewed day from the calendars you ticked, expanded
  from recurrences, and placed in the prayer block their start time falls in.

