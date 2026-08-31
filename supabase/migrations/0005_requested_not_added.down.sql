-- Down migration for 0005_requested_not_added.

alter table public.suggestions drop constraint suggestions_status_check;

update public.suggestions set status = 'added' where status = 'requested';

alter table public.suggestions
  add constraint suggestions_status_check
  check (status in ('new', 'added', 'declined'));
