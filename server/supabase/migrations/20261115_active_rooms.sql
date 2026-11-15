-- Salas en curso de Gundam Assemble Web (GAME_STORE=supabase).
-- Solo las usa el servidor con la service role key: sin políticas públicas.
create table if not exists public.active_rooms (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.active_rooms enable row level security;
