-- "Added" claimed something that never happened.
--
-- Marking a suggestion did not put the track in the playlist, and could not:
-- SoundCloud has no public API we are permitted to use, so a track joins the
-- set by hand. The status only ever recorded a decision, and calling that
-- decision "added" described an outcome rather than the choice.
--
-- "Requested" says what is true: someone asked, the curator wants it, and it
-- is waiting to be added by hand.

alter table public.suggestions drop constraint suggestions_status_check;

update public.suggestions set status = 'requested' where status = 'added';

alter table public.suggestions
  add constraint suggestions_status_check
  check (status in ('new', 'requested', 'declined'));
