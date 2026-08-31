-- Down migration for 0003_rooms_are_permanent.
--
-- Restores the cascade. Note that this restores a promise the immutability
-- trigger will still refuse to honour — the cascade was always dead.

alter table public.schedules
  drop constraint schedules_room_id_fkey;

alter table public.schedules
  add constraint schedules_room_id_fkey
  foreign key (room_id) references public.rooms (id) on delete cascade;
