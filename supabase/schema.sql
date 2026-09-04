-- ═════════════════════════════════════════════════════════════════════════════
-- Recall — Supabase schema WITH access control (auth + roles + admin approval)
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run. Security is enforced by Row-Level Security (RLS) on the SERVER,
-- so it cannot be bypassed by editing the browser code.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── PROFILES (one row per user; holds their role) ────────────────────────────
-- role: 'pending'  = signed up, NOT yet allowed to use the app
--       'member'   = approved, can use the app
--       'admin'    = can use the app AND manage other users
--       'blocked'  = access revoked
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  role       text not null default 'pending'
             check (role in ('pending', 'member', 'admin', 'blocked')),
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER helpers (run with owner privileges so they can read profiles
-- without tripping RLS recursion). These are the heart of the access control.
create or replace function public.is_approved()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role in ('member', 'admin'));
$$;

create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'admin');
$$;

-- Auto-create a profile (role 'pending') whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'pending')
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for anyone who signed up before this was installed.
insert into public.profiles (id, email, role)
  select id, email, 'pending' from auth.users on conflict (id) do nothing;

alter table public.profiles enable row level security;

-- A user can read their OWN profile (to learn their role); admins read everyone.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

-- Only admins can change roles (approve / block / promote). Nobody can self-promote.
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- ── NOTES (gated: only approved users, and only their own) ────────────────────
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'Untitled note',
  source_type text not null default 'paste',
  source_ref  text,
  transcript  text default '',
  notes_md    text default '',
  flashcards  jsonb not null default '[]'::jsonb,
  quiz        jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists notes_user_updated_idx on public.notes (user_id, updated_at desc);

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid not null references public.notes(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_note_idx on public.chat_messages (note_id, created_at asc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists notes_touch_updated_at on public.notes;
create trigger notes_touch_updated_at before update on public.notes
  for each row execute function public.touch_updated_at();

alter table public.notes         enable row level security;
alter table public.chat_messages enable row level security;

-- Every notes/chat operation requires: it's your own row AND you're approved.
drop policy if exists "notes_select" on public.notes;
create policy "notes_select" on public.notes
  for select using (auth.uid() = user_id and public.is_approved());
drop policy if exists "notes_insert" on public.notes;
create policy "notes_insert" on public.notes
  for insert with check (auth.uid() = user_id and public.is_approved());
drop policy if exists "notes_update" on public.notes;
create policy "notes_update" on public.notes
  for update using (auth.uid() = user_id and public.is_approved())
  with check (auth.uid() = user_id and public.is_approved());
drop policy if exists "notes_delete" on public.notes;
create policy "notes_delete" on public.notes
  for delete using (auth.uid() = user_id and public.is_approved());

drop policy if exists "chat_select" on public.chat_messages;
create policy "chat_select" on public.chat_messages
  for select using (auth.uid() = user_id and public.is_approved());
drop policy if exists "chat_insert" on public.chat_messages;
create policy "chat_insert" on public.chat_messages
  for insert with check (auth.uid() = user_id and public.is_approved());
drop policy if exists "chat_delete" on public.chat_messages;
create policy "chat_delete" on public.chat_messages
  for delete using (auth.uid() = user_id and public.is_approved());

-- ═════════════════════════════════════════════════════════════════════════════
-- ⚑ MAKE YOURSELF ADMIN (do this once):
--   1. Sign up in the app with YOUR email first.
--   2. Run the line below with that email, then reload the app.
--   Everyone else stays 'pending' until you approve them in the Admin panel.
--
--   update public.profiles set role = 'admin' where email = 'YOU@EXAMPLE.COM';
-- ═════════════════════════════════════════════════════════════════════════════
