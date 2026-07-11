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
  card needed. Caveat: on the free tier, Google may use prompts to improve its
  products.
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
