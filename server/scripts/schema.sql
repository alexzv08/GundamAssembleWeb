-- =====================================================================
-- GUNDAM ASSEMBLE — Esquema completo para Supabase (PostgreSQL)
-- Pegar en el SQL Editor de Supabase y ejecutar de arriba a abajo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. EXTENSIONES
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. ENUMS
-- ---------------------------------------------------------------------
create type match_type     as enum ('ranked', 'casual', 'vs_ai');
create type match_status   as enum ('in_progress', 'finished', 'aborted');
create type end_reason     as enum ('victory', 'concede', 'disconnect', 'draw', 'aborted');
create type result_type    as enum ('decisive', 'draw', 'no_contest');
create type player_outcome as enum ('win', 'loss', 'draw');

-- =====================================================================
-- 2. CATÁLOGO (estático, crece con expansiones)
-- =====================================================================

-- 2.1 Sets / expansiones
create table sets (
    id          uuid primary key default gen_random_uuid(),
    code        text not null unique,       -- 'DM01', 'EXP01', etc.
    name        text not null,
    released_at date,
    created_at  timestamptz not null default now()
);

-- 2.2 Units
create table units (
    id          uuid primary key default gen_random_uuid(),
    set_id      uuid not null references sets(id) on delete restrict,
    code        text not null unique,       -- cardId del JSON: 'DM01-U01'
    name        text not null,
    pilot       text,                       -- piloto de la unidad
    faction     text,
    cost        integer not null check (cost >= 0),   -- TL (coste de timeline)
    movement    integer not null check (movement >= 0),
    attack      integer not null check (attack >= 0), -- fuerza máx de armas
    defense     integer not null check (defense >= 0),
    range       integer not null check (range >= 0),  -- rango máx de armas
    hp          integer not null check (hp >= 0),
    vp          integer not null default 0,           -- VP al ser derrotada
    role        text,                                 -- 'Mobile Suit', etc.
    abilities   jsonb not null default '{}'::jsonb,   -- armas + habilidades completas
    created_at  timestamptz not null default now()
);
create index idx_units_set     on units(set_id);
create index idx_units_faction on units(faction);
create index idx_units_cost    on units(cost);

-- 2.3 Commands (cartas de táctica)
create table commands (
    id          uuid primary key default gen_random_uuid(),
    set_id      uuid not null references sets(id) on delete restrict,
    code        text not null unique,       -- cardId del JSON: 'T03', 'T-10', etc.
    name        text not null,
    faction     text,
    cost        integer not null default 0 check (cost >= 0),
    timing      text,                       -- 'command' | 'response'
    effect      jsonb not null default '{}'::jsonb,   -- effectData + texto
    created_at  timestamptz not null default now()
);
create index idx_commands_set     on commands(set_id);
create index idx_commands_faction on commands(faction);

-- =====================================================================
-- 3. USUARIOS
-- =====================================================================

-- 3.1 Profiles
create table profiles (
    id          uuid primary key references auth.users(id) on delete cascade,
    username    text not null unique
                check (char_length(username) between 3 and 32),
    avatar_url  text,
    created_at  timestamptz not null default now()
);

-- 3.2 Rating / ELO — solo escribe el servidor
create table player_ratings (
    user_id      uuid primary key references profiles(id) on delete cascade,
    elo          integer not null default 1200,
    games_played integer not null default 0 check (games_played >= 0),
    updated_at   timestamptz not null default now()
);

-- 3.3 Histórico de ELO
create table elo_history (
    id          bigint generated always as identity primary key,
    user_id     uuid not null references profiles(id) on delete cascade,
    elo         integer not null,
    match_id    uuid,        -- FK añadida tras crear matches
    created_at  timestamptz not null default now()
);
create index idx_elo_history_user on elo_history(user_id, created_at);

-- =====================================================================
-- 4. COLECCIÓN
-- =====================================================================

create table user_units (
    user_id     uuid not null references profiles(id) on delete cascade,
    unit_id     uuid not null references units(id) on delete cascade,
    quantity    integer not null default 1 check (quantity >= 0),
    primary key (user_id, unit_id)
);

create table user_commands (
    user_id     uuid not null references profiles(id) on delete cascade,
    command_id  uuid not null references commands(id) on delete cascade,
    quantity    integer not null default 1 check (quantity >= 0),
    primary key (user_id, command_id)
);

-- =====================================================================
-- 5. ESCUADRAS
-- =====================================================================

create table squads (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references profiles(id) on delete cascade,
    name        text not null check (char_length(name) between 1 and 60),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index idx_squads_user on squads(user_id);

create table squad_units (
    squad_id    uuid not null references squads(id) on delete cascade,
    unit_id     uuid not null references units(id) on delete restrict,
    primary key (squad_id, unit_id)
);

create table squad_commands (
    squad_id    uuid not null references squads(id) on delete cascade,
    command_id  uuid not null references commands(id) on delete restrict,
    primary key (squad_id, command_id)
);

-- =====================================================================
-- 6. PARTIDAS
-- =====================================================================

-- 6.1 Match
create table matches (
    id           uuid primary key default gen_random_uuid(),
    type         match_type   not null,
    status       match_status not null default 'in_progress',
    end_reason   end_reason,
    result_type  result_type,
    map_code     text,                     -- mapa jugado: 'DemoMap', 'MyMap', etc.
    started_at   timestamptz not null default now(),
    finished_at  timestamptz,
    created_at   timestamptz not null default now(),
    constraint chk_finished_has_result check (
        (status = 'in_progress' and end_reason is null and result_type is null)
        or
        (status in ('finished','aborted') and end_reason is not null and result_type is not null)
    )
);
create index idx_matches_status on matches(status);
create index idx_matches_type   on matches(type);

-- FK diferida de elo_history -> matches
alter table elo_history
    add constraint fk_elo_history_match
    foreign key (match_id) references matches(id) on delete set null;

-- 6.2 Participantes
create table match_players (
    match_id       uuid not null references matches(id) on delete cascade,
    user_id        uuid references profiles(id) on delete set null,
    squad_id       uuid references squads(id) on delete set null,
    squad_snapshot jsonb not null default '{}'::jsonb,
    -- { "units": ["DM01-U01",...], "commands": ["T03",...] }
    seat           smallint not null,
    display_name   text,                  -- nombre en el momento de jugar
    outcome        player_outcome,
    final_score    integer,
    is_ai          boolean not null default false,
    primary key (match_id, seat),
    constraint chk_human_or_ai check (
        (is_ai = true  and user_id is null)
        or
        (is_ai = false and user_id is not null)
    )
);
create index idx_match_players_user on match_players(user_id);

-- 6.3 Event log
-- event_type usa text con CHECK explícito para poder ampliar la lista
-- con ALTER TABLE sin migrar un enum entero.
create table match_events (
    id           bigint generated always as identity primary key,
    match_id     uuid not null references matches(id) on delete cascade,
    turn_number  integer not null check (turn_number >= 0),
    sequence     integer not null check (sequence >= 0),
    seat         smallint,
    event_type   text not null check (
        event_type in (
            -- ciclo de partida
            'match_start', 'match_end',
            -- acciones del motor (deben coincidir con action.type del engine)
            'ADVANCE', 'ATTACK', 'ATTACK_GARRISON', 'DASH',
            'ENERGIZE', 'RESCUE', 'USE_ABILITY',
            'PLAY_CARD', 'PLAY_RESPONSE', 'PASS_RESPONSE',
            'END_ACTIVATION'
        )
    ),
    payload      jsonb not null default '{}'::jsonb,
    created_at   timestamptz not null default now(),
    unique (match_id, turn_number, sequence),
    constraint fk_event_player
        foreign key (match_id, seat)
        references match_players(match_id, seat) on delete cascade
);
create index idx_match_events_match on match_events(match_id, turn_number, sequence);
create index idx_match_events_type  on match_events(event_type);

-- =====================================================================
-- 7. TRIGGERS
-- =====================================================================

-- 7.1 Crear profile + rating al registrarse
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
    v_raw  text;
    v_name text;
begin
    v_raw := coalesce(
        new.raw_user_meta_data->>'user_name',
        new.raw_user_meta_data->>'full_name',
        'player_' || substr(new.id::text, 1, 8)
    );

    v_name := substr(v_raw, 1, 32);
    if char_length(v_name) < 3 then
        v_name := 'player_' || substr(new.id::text, 1, 8);
    end if;

    if exists (select 1 from public.profiles where username = v_name) then
        v_name := substr(v_name, 1, 24) || '_' || substr(new.id::text, 1, 6);
    end if;

    insert into public.profiles (id, username, avatar_url)
    values (new.id, v_name, new.raw_user_meta_data->>'avatar_url')
    on conflict (id) do nothing;

    insert into public.player_ratings (user_id)
    values (new.id)
    on conflict (user_id) do nothing;

    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- 7.2 updated_at en squads
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger trg_squads_updated
    before update on squads
    for each row execute function public.touch_updated_at();

-- =====================================================================
-- 8. ROW LEVEL SECURITY
-- =====================================================================

alter table profiles       enable row level security;
alter table player_ratings enable row level security;
alter table elo_history    enable row level security;
alter table user_units     enable row level security;
alter table user_commands  enable row level security;
alter table squads         enable row level security;
alter table squad_units    enable row level security;
alter table squad_commands enable row level security;
alter table matches        enable row level security;
alter table match_players  enable row level security;
alter table match_events   enable row level security;
alter table sets           enable row level security;
alter table units          enable row level security;
alter table commands       enable row level security;

-- Catálogo: lectura pública, escritura solo service_role
create policy "catalog_sets_read"     on sets     for select using (true);
create policy "catalog_units_read"    on units    for select using (true);
create policy "catalog_commands_read" on commands for select using (true);

-- Profiles: lectura pública, escritura solo del propio
create policy "profiles_read_all"
    on profiles for select using (true);
create policy "profiles_update_own"
    on profiles for update
    using (auth.uid() = id)
    with check (auth.uid() = id);

-- Player ratings: lectura pública, sin escritura para cliente
create policy "player_ratings_read_all"
    on player_ratings for select using (true);

-- ELO history: lectura pública, sin escritura para cliente
create policy "elo_history_read_all"
    on elo_history for select using (true);

-- Colección: solo el propio
create policy "user_units_rw_own"
    on user_units for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "user_commands_rw_own"
    on user_commands for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- Escuadras: solo el propio
create policy "squads_rw_own"
    on squads for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "squad_units_rw_own"
    on squad_units for all
    using (exists (select 1 from squads s where s.id = squad_units.squad_id and s.user_id = auth.uid()))
    with check (exists (select 1 from squads s where s.id = squad_units.squad_id and s.user_id = auth.uid()));

create policy "squad_commands_rw_own"
    on squad_commands for all
    using (exists (select 1 from squads s where s.id = squad_commands.squad_id and s.user_id = auth.uid()))
    with check (exists (select 1 from squads s where s.id = squad_commands.squad_id and s.user_id = auth.uid()));

-- Partidas: solo los participantes leen; nadie escribe desde el cliente
create or replace function public.is_match_participant(p_match_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1 from match_players mp
        where mp.match_id = p_match_id
          and mp.user_id = auth.uid()
    );
$$;

create policy "matches_read_participant"
    on matches for select
    using (public.is_match_participant(id));

create policy "match_players_read_participant"
    on match_players for select
    using (public.is_match_participant(match_id));

create policy "match_events_read_participant"
    on match_events for select
    using (public.is_match_participant(match_id));

-- =====================================================================
-- FIN DEL ESQUEMA
-- Ejecutar seed-catalog.ts después para poblar sets/units/commands.
-- =====================================================================
