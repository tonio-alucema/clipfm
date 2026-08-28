-- Phase 0 schema: rooms, schedules, favorites.
--
-- Three ideas the shape enforces:
--   1. A schedule is a frozen snapshot. The database refuses to mutate one.
--   2. Nothing ephemeral lives here. Presence and reactions go over Realtime.
--   3. Anonymous listeners may read everything and favourite a track. Nothing
--      else.

create extension if not exists "pgcrypto";

create table public.rooms (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  name                text not null,
  -- FK added below, once schedules exists.
  active_schedule_id  uuid,
  created_at          timestamptz not null default now()
);

create table public.schedules (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms (id) on delete cascade,

  -- The instant the playlist began its first revolution. Everything playing
  -- anywhere is derived from this plus the durations below.
  epoch       timestamptz not null,

  -- The SoundCloud set the player loads once and then skips within. Recorded
  -- per schedule because the snapshot is only meaningful against the set it
  -- was frozen from.
  set_url     text not null,

  -- Ordered array of { url, title, artist, artwork, durationMs }. Durations
  -- are frozen at seed time and never fetched at runtime.
  tracks      jsonb not null check (jsonb_typeof(tracks) = 'array'),

  created_at  timestamptz not null default now()
);

alter table public.rooms
  add constraint rooms_active_schedule_id_fkey
  foreign key (active_schedule_id) references public.schedules (id);

create index schedules_room_created_idx
  on public.schedules (room_id, created_at desc);

create table public.favorites (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms (id) on delete cascade,
  track_url    text not null,
  -- A UUID from localStorage. There is no auth in Phase 0, so this identifies
  -- a browser, not a person.
  listener_id  uuid not null,
  created_at   timestamptz not null default now(),
  -- Favouriting twice is the same fact stated twice.
  unique (room_id, track_url, listener_id)
);

create index favorites_room_track_idx on public.favorites (room_id, track_url);

-- Immutability, enforced rather than merely intended --------------------------
--
-- Editing a played schedule would retroactively change every position every
-- client has ever computed from it, and split clients that read it either side
-- of the write. Convention is not enough for an invariant this load-bearing,
-- so the database refuses.
--
-- This binds the service role too. That is deliberate: it is an invariant, not
-- a permission. To change a playlist, insert a new schedule and repoint
-- rooms.active_schedule_id. To genuinely undo one, drop this trigger in a
-- migration of its own, so the exception is recorded.

create function public.forbid_schedule_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'schedules are append-only: insert a new schedule and repoint rooms.active_schedule_id';
end;
$$;

create trigger schedules_are_immutable
  before update or delete on public.schedules
  for each row execute function public.forbid_schedule_mutation();

-- Row level security ----------------------------------------------------------
--
-- Everything is world-readable; the room is public by design. The only write
-- an anonymous listener may make is favouriting a track. Seeding runs through
-- the service role, which bypasses RLS.

alter table public.rooms     enable row level security;
alter table public.schedules enable row level security;
alter table public.favorites enable row level security;

create policy rooms_are_public_to_read
  on public.rooms for select to anon, authenticated using (true);

create policy schedules_are_public_to_read
  on public.schedules for select to anon, authenticated using (true);

create policy favorites_are_public_to_read
  on public.favorites for select to anon, authenticated using (true);

create policy anyone_may_favorite
  on public.favorites for insert to anon, authenticated with check (true);

-- No update or delete policy exists for any table, so with RLS on, none is
-- permitted. A listener cannot unfavourite in Phase 0; that is a product
-- decision to revisit, not an oversight.

-- Grants, stated rather than inherited ----------------------------------------
--
-- Supabase grants broadly to anon by default and leaves RLS to do the gating.
-- Naming the grants here instead means the write surface is visible in one
-- place, and that a policy added carelessly later still cannot update or
-- delete anything, because the privilege was never granted.

grant usage on schema public to anon, authenticated;

grant select on public.rooms      to anon, authenticated;
grant select on public.schedules  to anon, authenticated;
grant select on public.favorites  to anon, authenticated;
grant insert on public.favorites  to anon, authenticated;
