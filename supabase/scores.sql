-- Globale Bestenliste für "You cannot survive"
-- In Supabase: SQL Editor -> New query -> einfügen -> Run

create table if not exists public.scores (
  id          bigint generated always as identity primary key,
  name        text    not null check (char_length(name) between 1 and 16),
  kills       integer not null check (kills between 0 and 5000),
  time        integer not null check (time between 0 and 86400),
  created_at  timestamptz not null default now()
);

create index if not exists scores_rank_idx on public.scores (kills desc, time desc);

alter table public.scores enable row level security;

-- Jeder darf die Bestenliste lesen
create policy "scores are readable by everyone"
  on public.scores for select
  to anon
  using (true);

-- Jeder darf neue Einträge anlegen (aber nicht ändern oder löschen)
create policy "anyone can submit a score"
  on public.scores for insert
  to anon
  with check (true);
