-- Down migration for 0004_votes_and_suggestions.

drop policy if exists anyone_may_suggest on public.suggestions;
drop policy if exists suggestions_are_public_to_read on public.suggestions;
drop table if exists public.suggestions;

drop policy if exists anyone_may_change_a_vote on public.votes;
revoke update on public.votes from anon, authenticated;
revoke update on public.votes from service_role;

alter table public.votes drop column if exists direction;
alter index votes_room_track_idx rename to favorites_room_track_idx;
alter table public.votes rename constraint votes_room_id_track_url_listener_id_key
  to favorites_room_id_track_url_listener_id_key;
alter table public.votes rename to favorites;
