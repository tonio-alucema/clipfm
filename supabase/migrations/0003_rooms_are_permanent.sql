-- Say what actually happens when you delete a room.
--
-- schedules.room_id cascaded on delete, which reads as "delete a room and its
-- schedules go with it". That has never been true: the immutability trigger
-- refuses the cascaded deletes, so the whole statement fails and the room
-- survives. The cascade was decoration on a rule it could not carry out.
--
-- The rule itself is the one worth keeping. A schedule is a record of what a
-- room played, and clients computed positions from it; deleting one rewrites
-- history that people actually listened to. So a room that has ever been
-- scheduled is permanent, and the foreign key now says so directly rather than
-- promising a cascade the trigger will veto.
--
-- The practical difference is the error. Before: "schedules are append-only",
-- from a trigger, while attempting something the schema advertised as fine.
-- After: a foreign key violation naming the schedules that depend on the room,
-- which is the actual reason.
--
-- To retire a room, point rooms.active_schedule_id at nothing and leave it.
-- Deletion is not the tool.

alter table public.schedules
  drop constraint schedules_room_id_fkey;

alter table public.schedules
  add constraint schedules_room_id_fkey
  foreign key (room_id) references public.rooms (id) on delete restrict;
