-- Repeticiones de partidas terminadas (GAME_STORE=supabase).
-- Solo las usa el servidor con la service role key: sin políticas públicas.
create table if not exists public.replays (
  id text primary key,
  summary jsonb not null,
  data jsonb not null,
  user_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists replays_user_ids_idx on public.replays using gin (user_ids);
alter table public.replays enable row level security;
