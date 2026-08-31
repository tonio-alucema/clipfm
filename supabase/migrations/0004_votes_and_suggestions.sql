-- Votes with a direction, and a place to put requests.
--
-- `favorites` only ever recorded approval, so its name and its shape both
-- assumed it. A thumbs down is the same kind of fact pointing the other way,
-- and calling a table that holds both `favorites` would be actively
-- misleading — so it is renamed rather than extended in place.
--
-- A listener may change their mind, which needs UPDATE. Worth being explicit
-- about what that means here: there is no auth, so listener_id is a value the
-- browser invents. RLS cannot tell a listener updating their own vote from
-- anyone updating anybody's. That was harmless when the only signal was
-- approval; it matters now that thumbs down is meant to inform whether a track
-- gets pulled. The exposure is accepted for a private room among people who
-- know each other, and is the first thing auth should close.

alter table public.favorites rename to votes;

alter table public.votes rename constraint favorites_room_id_track_url_listener_id_key
  to votes_room_id_track_url_listener_id_key;

alter index favorites_room_track_idx rename to votes_room_track_idx;

-- 1 for up, -1 for down. A number rather than an enum because the useful
-- question is almost always "what do they add up to".
alter table public.votes
  add column direction smallint not null default 1
  check (direction in (1, -1));

-- Changing your mind is an update, not a second row.
create policy anyone_may_change_a_vote
  on public.votes for update to anon, authenticated
  using (true) with check (true);

grant update on public.votes to anon, authenticated;

-- Requests ------------------------------------------------------------------
--
-- A listener suggesting a track. Deliberately not a queue: nothing here
-- reaches a schedule on its own. A suggestion is a message to whoever curates
-- the set, and stays inert until someone acts on it.

create table public.suggestions (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms (id) on delete restrict,
  track_url    text not null,
  listener_id  uuid not null,
  -- 'new' until a curator does something with it. Two people wanting the same
  -- track is signal, so uniqueness is per listener, not per track.
  status       text not null default 'new' check (status in ('new', 'added', 'declined')),
  created_at   timestamptz not null default now(),
  unique (room_id, track_url, listener_id)
);

create index suggestions_room_status_idx on public.suggestions (room_id, status, created_at desc);

alter table public.suggestions enable row level security;

create policy suggestions_are_public_to_read
  on public.suggestions for select to anon, authenticated using (true);

create policy anyone_may_suggest
  on public.suggestions for insert to anon, authenticated with check (true);

-- No update or delete for anon: acting on a suggestion is a curator's job, and
-- the curator has the service role.
grant usage on schema public to anon, authenticated;
grant select, insert on public.suggestions to anon, authenticated;
grant select, insert, update on public.suggestions to service_role;
grant update on public.votes to service_role;
