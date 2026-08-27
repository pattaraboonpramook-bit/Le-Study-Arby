-- ─────────────────────────────────────────────────────────────────────────────
-- Recall — Supabase schema
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- It creates the tables + row-level security so each user only ever sees their
-- own data. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- NOTES ------------------------------------------------------------------------
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'Untitled note',
  source_type text not null default 'paste',   -- 'record' | 'paste' | 'youtube'
  source_ref  text,                             -- e.g. the YouTube URL
  transcript  text default '',                  -- raw captured text
  notes_md    text default '',                  -- AI-generated study notes (markdown)
  flashcards  jsonb not null default '[]'::jsonb,
  quiz        jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists notes_user_updated_idx
  on public.notes (user_id, updated_at desc);

-- CHAT MESSAGES (chat-with-your-notes history) --------------------------------
create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid not null references public.notes(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_note_idx
  on public.chat_messages (note_id, created_at asc);

-- keep notes.updated_at fresh on any update
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notes_touch_updated_at on public.notes;
create trigger notes_touch_updated_at
  before update on public.notes
  for each row execute function public.touch_updated_at();

-- ROW-LEVEL SECURITY -----------------------------------------------------------
alter table public.notes         enable row level security;
alter table public.chat_messages enable row level security;

-- notes: owner-only access
drop policy if exists "notes_select_own" on public.notes;
create policy "notes_select_own" on public.notes
  for select using (auth.uid() = user_id);

drop policy if exists "notes_insert_own" on public.notes;
create policy "notes_insert_own" on public.notes
  for insert with check (auth.uid() = user_id);

drop policy if exists "notes_update_own" on public.notes;
create policy "notes_update_own" on public.notes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "notes_delete_own" on public.notes;
create policy "notes_delete_own" on public.notes
  for delete using (auth.uid() = user_id);

-- chat_messages: owner-only access
drop policy if exists "chat_select_own" on public.chat_messages;
create policy "chat_select_own" on public.chat_messages
  for select using (auth.uid() = user_id);

drop policy if exists "chat_insert_own" on public.chat_messages;
create policy "chat_insert_own" on public.chat_messages
  for insert with check (auth.uid() = user_id);

drop policy if exists "chat_delete_own" on public.chat_messages;
create policy "chat_delete_own" on public.chat_messages
  for delete using (auth.uid() = user_id);
