-- Down migration for 0001_init.
--
-- Written at the same time as the up migration, per the working agreements.
-- Dropping schedules requires removing the immutability trigger first, since
-- it would otherwise refuse the row deletions a cascade implies.

drop policy if exists anyone_may_favorite            on public.favorites;
drop policy if exists favorites_are_public_to_read   on public.favorites;
drop policy if exists schedules_are_public_to_read   on public.schedules;
drop policy if exists rooms_are_public_to_read       on public.rooms;

drop trigger if exists schedules_are_immutable on public.schedules;
drop function if exists public.forbid_schedule_mutation();

alter table if exists public.rooms
  drop constraint if exists rooms_active_schedule_id_fkey;

drop table if exists public.favorites;
drop table if exists public.schedules;
drop table if exists public.rooms;
