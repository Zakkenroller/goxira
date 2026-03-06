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
  source      text not null check (source in ('live_play', 'sgf_upload')),
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
