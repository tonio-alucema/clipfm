#!/usr/bin/env node
/**
 * Writes a schedule snapshot to Supabase.
 *
 *   node --env-file=.env.local scripts/seed.mjs seed.json [--room main] [--name "The Room"]
 *
 * The other half of seeding is /seed in the browser, which harvests durations
 * from the widget. This half only writes what that produced.
 *
 * Uses the service role key, which is why this is a local script and not a
 * route: the key must never reach app code or Vercel.
 *
 * Schedules are append-only. This always inserts a new row and repoints
 * rooms.active_schedule_id; it never edits one. The database enforces that
 * independently, so a mistake here fails loudly rather than quietly corrupting
 * what everyone is listening to.
 */

import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const argv = process.argv.slice(2);
const flags = new Map();
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg.startsWith('--')) flags.set(arg.slice(2), argv[++i]);
  else positional.push(arg);
}

const [file] = positional;
const roomSlug = flags.get('room') ?? 'main';
const roomName = flags.get('name') ?? 'The Room';
const epochIso = flags.get('epoch') ?? new Date().toISOString();

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!file) die('Usage: node --env-file=.env.local scripts/seed.mjs <seed.json> [--room slug] [--name "Name"]');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) die('NEXT_PUBLIC_SUPABASE_URL is not set. Is .env.local present?');
if (!serviceRoleKey) die('SUPABASE_SERVICE_ROLE_KEY is not set. It belongs in .env.local only.');

const snapshot = JSON.parse(await readFile(file, 'utf8'));
if (typeof snapshot.setUrl !== 'string' || !snapshot.setUrl) die(`${file} has no setUrl`);
if (!Array.isArray(snapshot.tracks) || snapshot.tracks.length === 0) die(`${file} has no tracks`);

for (const [i, track] of snapshot.tracks.entries()) {
  if (typeof track.url !== 'string' || !track.url) die(`track ${i} has no url`);
  if (typeof track.durationMs !== 'number' || track.durationMs <= 0) {
    die(`track ${i} (${track.title ?? 'untitled'}) has no usable duration — re-harvest from /seed`);
  }
}

const totalMs = snapshot.tracks.reduce((sum, t) => sum + t.durationMs, 0);
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const { data: existing, error: lookupError } = await supabase
  .from('rooms')
  .select('id')
  .eq('slug', roomSlug)
  .maybeSingle();
if (lookupError) die(`Could not read rooms: ${lookupError.message}`);

let roomId = existing?.id;
if (!roomId) {
  const { data, error } = await supabase
    .from('rooms')
    .insert({ slug: roomSlug, name: roomName })
    .select('id')
    .single();
  if (error) die(`Could not create room: ${error.message}`);
  roomId = data.id;
  console.log(`  created room "${roomSlug}"`);
}

const { data: schedule, error: scheduleError } = await supabase
  .from('schedules')
  .insert({
    room_id: roomId,
    epoch: epochIso,
    set_url: snapshot.setUrl,
    tracks: snapshot.tracks,
  })
  .select('id')
  .single();
if (scheduleError) die(`Could not insert schedule: ${scheduleError.message}`);

const { error: repointError } = await supabase
  .from('rooms')
  .update({ active_schedule_id: schedule.id })
  .eq('id', roomId);
if (repointError) die(`Schedule ${schedule.id} was written but the room still points at the old one: ${repointError.message}`);

const minutes = Math.floor(totalMs / 60000);
const seconds = String(Math.round((totalMs % 60000) / 1000)).padStart(2, '0');
console.log(`
  room      ${roomSlug}
  schedule  ${schedule.id}
  epoch     ${epochIso}
  tracks    ${snapshot.tracks.length}
  revolution ${minutes}:${seconds}

  The previous schedule is untouched. To roll back, repoint
  rooms.active_schedule_id at it — never edit a schedule row.
`);
