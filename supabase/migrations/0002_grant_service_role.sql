-- Grants for the seeding role.
--
-- 0001 stated grants explicitly rather than relying on Supabase's automatic
-- exposure of new tables, which is the safer default — but it named only anon
-- and authenticated. service_role bypasses RLS, yet still needs ordinary table
-- privileges, so seeding failed with "permission denied for table rooms".
--
-- Granted narrowly rather than with `all`, for the same reason 0001 was:
-- the write surface should be legible in one place.
--
--   rooms      insert a room, and repoint active_schedule_id
--   schedules  append a new snapshot; update and delete are refused by the
--              immutability trigger regardless of any grant
--   favorites  read only; nothing seeds favourites

grant usage on schema public to service_role;

grant select, insert, update on public.rooms     to service_role;
grant select, insert         on public.schedules to service_role;
grant select                 on public.favorites to service_role;
