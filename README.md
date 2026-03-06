# Igo — AI Go Tutor

An AI-powered Go tutor with level assessment, adaptive problems, live play, and game replay analysis.

---

## Setup Guide (Step by Step)

### Step 1 — Create a GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Name it `igo-tutor` (or anything you like)
3. Make it **Public**
4. Click **Create repository**
5. Upload all files from this folder, OR use Git:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/igo-tutor.git
   git push -u origin main
   ```

---

### Step 2 — Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Pick a name (e.g. `igo-tutor`) and set a strong database password
3. Choose a region closest to you
4. Wait ~2 minutes for the project to spin up
5. Go to **SQL Editor** → **New Query**
6. Paste the entire contents of `supabase-schema.sql` and click **Run**
7. You should see "Success" for each statement

**Get your credentials:**
- Go to **Settings → API**
- Copy the **Project URL** (looks like `https://xxxx.supabase.co`)
- Copy the **anon public** key (long JWT string)

**Enable Google OAuth (optional):**
- Go to **Authentication → Providers → Google**
- You'll need a Google Cloud Console OAuth 2.0 client ID
- Set the redirect URL to: `https://YOUR_NETLIFY_SITE.netlify.app/home.html`

---

### Step 3 — Deploy to Netlify

1. Go to [netlify.com](https://netlify.com) → **Add new site → Import from Git**
2. Connect your GitHub account and select the `igo-tutor` repo
3. Build settings will auto-detect from `netlify.toml`:
   - **Publish directory:** `.`
   - **Functions directory:** `netlify/functions`
4. Click **Deploy site**

**Add environment variables in Netlify:**
- Go to **Site settings → Environment variables → Add variable**
- Add these three:

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (starts with `sk-ant-`) |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Your Supabase **service_role** key (from Settings → API) |

5. Go to **Deploys → Trigger deploy → Deploy site**

---

### Step 4 — Update Frontend Config

In `auth.html`, `home.html`, `assess.html` (and any other HTML files), find this block:

```javascript
window.GOTUTOR_CONFIG = {
  supabaseUrl:     'REPLACE_WITH_YOUR_SUPABASE_URL',
  supabaseAnonKey: 'REPLACE_WITH_YOUR_SUPABASE_ANON_KEY',
};
```

Replace the placeholder values with your actual Supabase **Project URL** and **anon public** key.

> ⚠️ Use the **anon key** here (safe for browsers), not the service_role key.

---

### Step 5 — Test It

1. Visit your Netlify URL (e.g. `https://igo-tutor.netlify.app`)
2. Create an account with email/password
3. You should be redirected to the assessment screen
4. Go through the assessment
5. Start solving problems!

---

## File Structure

```
igo-tutor/
├── index.html          ← Landing page
├── auth.html           ← Sign in / Sign up
├── assess.html         ← Level assessment (TODO: build in Phase 2)
├── home.html           ← Dashboard (TODO: build in Phase 2)
├── problems.html       ← Problem solving (TODO: build in Phase 3)
├── play.html           ← Live game vs Claude (TODO: build in Phase 3)
├── review.html         ← Game replay & analysis (TODO: build in Phase 4)
├── css/
│   └── styles.css      ← All shared styles
├── js/
│   ├── board.js        ← SVG Go board renderer ✅
│   ├── supabase-client.js ← Auth & DB helpers ✅
│   └── api.js          ← Netlify function wrappers ✅
├── netlify/
│   └── functions/
│       ├── _claude.js        ← Shared Claude API helper ✅
│       ├── assess.js         ← Assessment conversation ✅
│       ├── problem.js        ← Problem generation ✅
│       ├── evaluate-move.js  ← Move evaluation ✅
│       ├── analyze-move.js   ← Game replay analysis ✅
│       ├── game-summary.js   ← End-of-game summary ✅
│       └── claude-move.js    ← Claude's live game moves ✅
├── supabase-schema.sql ← Run this once in Supabase SQL editor ✅
└── netlify.toml        ← Netlify config ✅
```

## Build Phases

- ✅ **Phase 1** — Infrastructure (this drop): Board renderer, auth, all serverless functions, DB schema
- 🔲 **Phase 2** — Assessment + Dashboard: assess.html, home.html with rank display
- 🔲 **Phase 3** — Problems + Live Play: problems.html, play.html
- 🔲 **Phase 4** — Game Replay Analysis: review.html (the signature feature)
- 🔲 **Phase 5** — Polish: rank chart, streaks, problem library

---

## Troubleshooting

**"Cannot find module" in Netlify functions:**
Functions use Node.js `require()`. Make sure `_claude.js` is in the same `netlify/functions/` directory.

**Supabase auth redirect not working:**
In Supabase → Authentication → URL Configuration, add your Netlify URL to "Redirect URLs":
`https://your-site.netlify.app/**`

**Google OAuth not working:**
Make sure the redirect URL in Google Cloud Console matches exactly what's in Supabase.

**Board doesn't render:**
Make sure `board.js` loads before any script that calls `Board.create()`.
