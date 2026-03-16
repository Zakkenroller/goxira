# Goxira — AI Go Tutor

A Go tutor with rank assessment, adaptive problems, live play, and game analysis. Powered by KataGo (engine) and Claude (teaching narrative).

**Live at**: [goxira.netlify.app](https://goxira.netlify.app)

---

## Features

- **Rank assessment** — conversational onboarding that places you from 30 kyu to dan level
- **Adaptive tsumego** — ~4,000 canon problems served by difficulty, with AI-generated hints and explanations grounded in verified tactical facts
- **Live play vs Goxira** — KataGo-strength opponent that scales to your rank; teaching pauses and live commentary
- **Game review** — upload any SGF or replay a saved game; KataGo winrate chart with key moment annotations and Claude-generated summary
- **Profile & rank history** — track your progress over time

---

## Self-Hosting

Goxira runs on three services you can swap or replace:

| Layer | Default | Replaceable with |
|---|---|---|
| Frontend hosting | Netlify | Any static host |
| Database + Auth | Supabase | Any Postgres + auth provider |
| KataGo engine | Hetzner VPS | Any server running KataGo |

### Step 1 — Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. In **SQL Editor → New Query**, run `supabase-schema.sql`
3. Manually create the `tsumego_problems` table and load your problem data (see below)
4. From **Settings → API**, copy your **Project URL** and **anon public key**
5. *(Optional)* Enable Google OAuth under **Authentication → Providers → Google**; set redirect URL to `https://YOUR_SITE/home.html`

### Step 2 — KataGo Service

The KataGo wrapper runs on a separate VPS to keep the GPL license isolated.

```bash
# On your VPS (Ubuntu 22.04 recommended, 2GB RAM minimum)
cd katago-service
bash setup.sh        # installs KataGo binary + model
npm start
```

Set a bearer token for the service (`KATAGO_TOKEN` env var) and note the VPS URL.

See `katago-service/setup.sh` and `katago-service/analysis.cfg` for configuration.

### Step 3 — Netlify

1. Fork this repo and connect it to [netlify.com](https://netlify.com)
2. Build settings auto-detect from `netlify.toml` (publish: `.`, functions: `functions/`)
3. Add environment variables under **Site settings → Environment variables**:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (`sk-ant-...`) |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Your Supabase `service_role` key |
| `KATAGO_SERVICE_URL` | Your KataGo VPS URL (e.g. `https://katago.yourdomain.com`) |
| `KATAGO_TOKEN` | Bearer token for the KataGo service |

### Step 4 — Frontend Config

In each HTML page, update the config block with your Supabase credentials:

```javascript
window.GOTUTOR_CONFIG = {
  supabaseUrl:     'https://YOUR_PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR_ANON_KEY',
};
```

> Use the **anon key** here (browser-safe), not the service_role key.

### Step 5 — Test

1. Visit your Netlify URL
2. Sign up and complete the assessment
3. Solve a problem — you should see KataGo-grounded feedback
4. Play a game — Goxira should move immediately (KataGo) with live commentary

---

## tsumego_problems Table

The problem library is not included in `supabase-schema.sql` because the ~4,000 problem records live in the database, not the repo. The table schema is:

```sql
create table public.tsumego_problems (
  id          uuid primary key default uuid_generate_v4(),
  source      text not null,          -- e.g. 'gokibitz', 'cho-elementary'
  difficulty  integer not null,       -- 0 (easiest) to ~2900 (hardest)
  board_size  integer not null,       -- 9, 13, or 19
  to_play     text not null,          -- 'B' or 'W'
  stones      jsonb not null,         -- {"col,row": "B"|"W", ...}
  solution_col integer not null,
  solution_row integer not null
);

-- Public read access (no auth needed to fetch problems)
alter table public.tsumego_problems enable row level security;
create policy "Problems: public read" on public.tsumego_problems
  for select using (true);
```

To load your own problems, import a JSONL or CSV matching this schema into Supabase.

---

## File Structure

```
goxira/
├── index.html              ← Landing page
├── auth.html               ← Sign in / sign up
├── assess.html             ← Conversational rank assessment
├── home.html               ← Dashboard
├── problems.html           ← Adaptive tsumego problems
├── play.html               ← Live play vs Goxira
├── review.html             ← Game replay + KataGo analysis
├── profile.html            ← Rank history + account
├── styles.css              ← Shared styles
├── board.js                ← SVG Go board renderer (touch + mouse)
├── supabase-client.js      ← Auth + DB helpers
├── api.js                  ← Netlify function wrappers
├── functions/
│   ├── assess.js           ← Assessment conversation
│   ├── problem.js          ← Problem fetch + AI enrichment
│   ├── evaluate-move.js    ← Tsumego feedback (rules engine + KataGo)
│   ├── analyze-move.js     ← Move commentary (coordinate only; no verdict)
│   ├── game-hint.js        ← Live game commentary (KataGo-grounded)
│   ├── game-summary.js     ← Post-game summary (KataGo winrate curve)
│   ├── katago-move.js      ← Move generation via KataGo
│   └── claude-move.js      ← Move generation fallback (Claude only)
├── katago-service/
│   ├── server.js           ← HTTP wrapper for KataGo binary
│   ├── analysis.cfg        ← KataGo configuration
│   ├── setup.sh            ← VPS install script
│   └── package.json
├── supabase-schema.sql     ← Run once in Supabase SQL editor
└── netlify.toml            ← Netlify build config
```

---

## Troubleshooting

**KataGo moves are slow or timing out**
Check that the KataGo service VPS is running (`npm start` in `katago-service/`). The service has a 10-second timeout per request. Claude is the automatic fallback if KataGo is unavailable — the app will keep working, just without engine strength.

**"Permission denied" on problem fetch**
The `tsumego_problems` table needs a public read RLS policy (see schema above). Without it, unauthenticated fetches in `problem.js` will fail.

**Supabase auth redirect not working**
In Supabase → Authentication → URL Configuration, add your Netlify URL to Redirect URLs: `https://your-site.netlify.app/**`

**Google OAuth not working**
The redirect URL in Google Cloud Console must match exactly what's in Supabase. Use `https://YOUR_PROJECT.supabase.co/auth/v1/callback`.

**Board doesn't render**
`board.js` must load before any script that calls `Board.create()`. Check script order in the HTML.

---

## License

MIT. KataGo itself is GPL-3.0 — kept architecturally separate in `katago-service/` for this reason.
