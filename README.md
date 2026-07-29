# Testing
A test repo for a ton of things

Added a line to test `fetch`

## Draft Time Poll

A tiny static web app for the league to pick a fantasy draft time. It shows a table
of candidate dates/times (Aug 16 – Sep 8, 2026 — 6:00 PM on weekdays, 3:00 PM and
6:00 PM on weekends) with one column per league member. Everyone marks the slots
that don't work for them, and the app highlights which times are still open to
everyone.

Files: `index.html`, `style.css`, `app.js`, `supabase-config.js`.

### Try it locally (no setup required)

Open `index.html` in a browser (or serve the folder with e.g. `python3 -m http.server`).
Without a Supabase project configured, the app automatically saves answers to your
browser's `localStorage` only — good enough to try the UI, but not shared with anyone else.
You'll see a yellow banner reminding you of this.

### Enable shared, real-time results (Supabase)

1. In your Supabase account, create a new project (or use an existing one) and wait
   for it to finish provisioning.
2. Open the **SQL Editor** and run:

   ```sql
   create table if not exists responses (
     name text primary key,
     unavailable text[] not null default '{}',
     done boolean not null default false,
     updated_at timestamptz not null default now()
   );

   alter table responses enable row level security;

   create policy "Anyone can read responses"
     on responses for select
     using (true);

   create policy "Only roster names can insert their own row"
     on responses for insert
     with check (name in (
       'Steven','Shiv','Harry','Oliver','Henry','Miles',
       'James','Zach','Max','Will','Graham','David'
     ));

   create policy "Only roster names can update their own row"
     on responses for update
     using (name in (
       'Steven','Shiv','Harry','Oliver','Henry','Miles',
       'James','Zach','Max','Will','Graham','David'
     ))
     with check (name in (
       'Steven','Shiv','Harry','Oliver','Henry','Miles',
       'James','Zach','Max','Will','Graham','David'
     ));

   alter publication supabase_realtime add table responses;
   ```

   This keeps results readable by anyone with the link, while only allowing inserts/updates
   to rows whose name matches one of the 12 known roster names — fine for a small trusted
   league; tighten further (e.g. with Supabase Auth) if you want stronger protection. The
   last line turns on Supabase Realtime for the table so everyone's browser gets pushed
   updates instantly; if you ever see the UI not refreshing live, check **Database →
   Replication** in the dashboard and confirm the `responses` table is enabled there.
3. Open **Project Settings → API** and copy the **Project URL** and **anon public** key
   into `supabase-config.js` in this repo, replacing the placeholder values.
4. Host the folder anywhere that serves static files (GitHub Pages, Netlify, Vercel, etc.)
   and share the link with the league. Everyone picks their name from the "Who are you?"
   dropdown and taps cells in their own column to mark times that don't work — results
   update live for everyone.

### Deployment

The live site is served by GitHub Pages from the `gh-pages` branch at
<https://stevenrachesky.github.io/Testing/>. The workflow in
`.github/workflows/deploy-pages.yml` republishes it automatically whenever any of the
four app files change on `master` (or the working feature branch), so there's no
manual copy step — just push.
