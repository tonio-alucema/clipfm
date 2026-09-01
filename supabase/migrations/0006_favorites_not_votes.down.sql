-- Restores the signed vote.
--
-- Honest limitation: this puts the column back, not the values that were in
-- it. Every row is restored as +1 by the default. That is lossless only
-- because there were no -1 rows when 0006 ran — if that ever stops being true,
-- dump the directions before going down.

alter index favorites_room_track_idx rename to votes_room_track_idx;

alter table public.favorites rename constraint favorites_room_id_track_url_listener_id_key
  to votes_room_id_track_url_listener_id_key;

alter table public.favorites rename to votes;

alter table public.votes
  add column direction smallint not null default 1
  check (direction in (1, -1));

create policy anyone_may_change_a_vote
  on public.votes for update to anon, authenticated
  using (true) with check (true);

grant update on public.votes to anon, authenticated;
grant update on public.votes to service_role;
