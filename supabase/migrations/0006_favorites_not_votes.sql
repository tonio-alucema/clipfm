-- Back to favourites: one direction, and nothing to rewrite.
--
-- 0004 split approval into a signed vote so that a thumbs down could tell the
-- curator what to pull. In a room this small that signal was never worth its
-- cost. The group is a handful of people who know each other, distaste is
-- already handled by tuning out, and what the curator actually wanted was the
-- positive signal: more of whatever people favourite.
--
-- Dropping the direction also removes the only reason UPDATE existed. A
-- favourite is a fact that is only ever asserted, so the unique constraint by
-- itself makes a second tap idempotent and nothing needs to rewrite a row that
-- is already there. That closes the hole 0004 opened and documented: with no
-- auth, an update policy of `using (true)` could not tell a listener changing
-- their own vote from anyone rewriting everybody's.
--
-- Dropping the column is safe here because every row in the table is +1.
-- Nobody ever voted a track down, so no expressed opinion is being quietly
-- reinterpreted as approval. Checked before writing this, not assumed.

-- The reason for UPDATE goes first, then the privilege behind it.
drop policy if exists anyone_may_change_a_vote on public.votes;

revoke update on public.votes from anon, authenticated;
revoke update on public.votes from service_role;

alter table public.votes drop column direction;

-- And back to the name that is true again. The read and insert policies were
-- never renamed in 0004, so they already read correctly against this name.
alter table public.votes rename to favorites;

alter table public.favorites rename constraint votes_room_id_track_url_listener_id_key
  to favorites_room_id_track_url_listener_id_key;

alter index votes_room_track_idx rename to favorites_room_track_idx;
