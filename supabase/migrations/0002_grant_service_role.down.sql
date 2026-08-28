-- Down migration for 0002_grant_service_role.
--
-- Leaves `usage on schema public` in place: it predates this migration as a
-- Supabase default, and revoking it would break more than this migration added.

revoke select                 on public.favorites from service_role;
revoke select, insert         on public.schedules from service_role;
revoke select, insert, update on public.rooms     from service_role;
