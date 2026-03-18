-- ============================================================
-- Go Tutor — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Enable UUID extension (usually already enabled)
create extension if not exists "uuid-ossp";

-- ── Users (extends Supabase auth.users) ──────────────────────
create table public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text not null default 'Student',
  current_rank    text not null default '30 kyu',
  rank_score      integer not null default 0,
  assessment_done boolean not null default false,
  created_at      timestamptz not null default now()
);

-- ── Problem attempts ─────────────────────────────────────────
create table public.problem_attempts (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.users(id) on delete cascade,
  problem_id  text not null,
  board_size  integer not null check (board_size in (9, 13, 19)),
  topic       text,
  solved      boolean not null default false,
  hints_used  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ── Saved games (SGF) ────────────────────────────────────────
create table public.saved_games (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.users(id) on delete cascade,
  sgf_content text not null,
  board_size  integer not null check (board_size in (9, 13, 19)),
  source      text not null check (source in ('live_play', 'sgf_upload', 'ogs_import')),
  public      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ── Rank history ─────────────────────────────────────────────
create table public.rank_history (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.users(id) on delete cascade,
  rank        text not null,
  rank_score  integer not null,
  recorded_at timestamptz not null default now()
);

-- ── Row Level Security ────────────────────────────────────────
-- Users can only see/modify their own data

alter table public.users enable row level security;
alter table public.problem_attempts enable row level security;
alter table public.saved_games enable row level security;
alter table public.rank_history enable row level security;

-- Users table
create policy "Users: read own" on public.users
  for select using (auth.uid() = id);
create policy "Users: insert own" on public.users
  for insert with check (auth.uid() = id);
create policy "Users: update own" on public.users
  for update using (auth.uid() = id);

-- Problem attempts
create policy "Attempts: all own" on public.problem_attempts
  for all using (auth.uid() = user_id);

-- Saved games
create policy "Games: all own" on public.saved_games
  for all using (auth.uid() = user_id);
create policy "Games: public read" on public.saved_games
  for select using (public = true);

-- Rank history
create policy "Rank: all own" on public.rank_history
  for all using (auth.uid() = user_id);

-- ── Trigger: auto-create user profile on signup ───────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Tsumego Problems (canon problem library, ~4,000 problems) ────────────
-- This table must be seeded separately from the schema.
-- The problem data is not included here because it is large (~4,000 rows)
-- and sourced from published collections (Gokyo Shumyo, Cho Elementary, etc.)
--
-- To self-host with problems:
--   1. Run this schema file to create all tables.
--   2. Obtain or export the tsumego_problems dataset (ask the maintainers or
--      see the project wiki for the canonical CSV/JSON dump).
--   3. Import via: Supabase Dashboard → Table Editor → tsumego_problems → Import,
--      or with psql: \copy public.tsumego_problems FROM 'problems.csv' CSV HEADER;
--
-- Without this table seeded, the /problems.html page will error on load.

create table public.tsumego_problems (
  id           uuid primary key default uuid_generate_v4(),
  source       text not null,         -- e.g. 'gokyo_shumyo', 'cho_elementary'
  difficulty   integer not null check (difficulty in (1, 2, 3)),
  board_size   integer not null check (board_size in (9, 13, 19)),
  to_play      text not null check (to_play in ('B', 'W')),
  stones       jsonb not null,        -- { "col,row": "B"|"W", ... }
  solution_col integer not null,
  solution_row integer not null,
  category     text not null default 'life_death'
               check (category in ('life_death', 'tesuji', 'shape'))
               -- 'life_death': classic tsumego (live/kill)
               -- 'tesuji':     tactical exploitation patterns (snapback, squeeze, etc.)
               -- 'shape':      stone efficiency and good/bad shape drills
);

alter table public.tsumego_problems enable row level security;

-- Problems are read-only for authenticated users (no user-owned rows)
create policy "Problems: read for authenticated" on public.tsumego_problems
  for select using (auth.role() = 'authenticated');

-- ── Spaced Repetition Schedule ────────────────────────────────────────────
-- One row per (user, problem). Tracks SM-2 state for adaptive review scheduling.
-- When a problem is first attempted, a row is inserted here.
-- After each review, ease_factor, interval, and next_review_date are updated.
create table public.problem_schedule (
  id                   uuid primary key default uuid_generate_v4(),
  user_id              uuid not null references public.users(id) on delete cascade,
  problem_id           text not null,          -- matches problem_attempts.problem_id format: 'db_<uuid>'
  ease_factor          numeric(4,2) not null default 2.5,  -- SM-2: starts at 2.5, min 1.3
  interval_days        integer not null default 1,         -- days until next review
  consecutive_correct  integer not null default 0,
  next_review_date     date not null default current_date,
  last_reviewed_at     timestamptz not null default now(),
  unique (user_id, problem_id)
);

alter table public.problem_schedule enable row level security;
create policy "Schedule: all own" on public.problem_schedule
  for all using (auth.uid() = user_id);

-- ── Opening Patterns (Joseki / Fuseki dictionary) ─────────────────────────
-- Stores navigable SGF sequences for the interactive opening explorer.
-- Each row is a named pattern (joseki variation or fuseki line).
-- The sgf_tree column is the raw SGF string for that line/variation.
-- position_hash is a stable key derived from the move sequence (for lookups).
create table public.opening_patterns (
  id             uuid primary key default uuid_generate_v4(),
  name           text not null,            -- e.g. 'San-San Invasion', 'Chinese Opening'
  category       text not null            -- 'joseki' | 'fuseki'
               check (category in ('joseki', 'fuseki')),
  corner         text,                     -- 'corner', 'side', 'whole-board', null for fuseki
  difficulty     integer not null default 1 check (difficulty in (1, 2, 3)),
  moves          jsonb not null,           -- ordered array of moves: [{"color":"B","x":3,"y":3}, ...]
  position_hash  text not null,            -- SHA-like fingerprint of moves sequence for fast lookup
  description    text,                     -- brief human-readable description
  result         text,                     -- outcome summary: 'equal', 'territory', 'influence'
  tags           text[] default '{}',      -- e.g. ['star-point', '3-3', 'invasion']
  created_at     timestamptz not null default now()
);

alter table public.opening_patterns enable row level security;
-- Opening patterns are public read — no user data
create policy "Openings: public read" on public.opening_patterns
  for select using (true);
