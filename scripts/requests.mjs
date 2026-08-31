#!/usr/bin/env node
/**
 * Incoming track requests.
 *
 *   node --env-file=.env.local scripts/requests.mjs                 # what is waiting
 *   node --env-file=.env.local scripts/requests.mjs --all           # including handled
 *   node --env-file=.env.local scripts/requests.mjs --add <url>     # mark as added
 *   node --env-file=.env.local scripts/requests.mjs --decline <url> # mark as declined
 *
 * A local script rather than a page, for the same reason seeding is: acting on
 * a request needs the service role key, and that key never goes near app code
 * or Vercel. A deployed curator view could list requests — they are publicly
 * readable — but could not do anything about one, which is not a curator view.
 *
 * Titles come from the public oEmbed endpoint, so the list reads as music
 * rather than as a column of URLs.
 */

import { createClient } from '@supabase/supabase-js';

const argv = process.argv.slice(2);
const flags = new Map();
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg.startsWith('--')) {
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) flags.set(arg.slice(2), argv[++i]);
    else flags.set(arg.slice(2), true);
  } else positional.push(arg);
}

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) die('NEXT_PUBLIC_SUPABASE_URL is not set. Is .env.local present?');
if (!serviceRoleKey) die('SUPABASE_SERVICE_ROLE_KEY is not set. It belongs in .env.local only.');

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const roomSlug = flags.get('room') ?? 'main';

const { data: room, error: roomError } = await supabase
  .from('rooms')
  .select('id, name')
  .eq('slug', roomSlug)
  .maybeSingle();
if (roomError) die(`Could not read rooms: ${roomError.message}`);
if (!room) die(`No room with slug "${roomSlug}".`);

/** Mark one track's requests handled. All of them: it is one decision. */
async function setStatus(trackUrl, status) {
  const { data, error } = await supabase
    .from('suggestions')
    .update({ status })
    .eq('room_id', room.id)
    .eq('track_url', trackUrl)
    .select('id');
  if (error) die(`Could not update: ${error.message}`);
  if (!data || data.length === 0) die(`No request for ${trackUrl} in "${roomSlug}".`);
  console.log(`\n  ${status}: ${trackUrl}  (${data.length} request(s))\n`);
}

if (flags.has('add') || flags.has('decline')) {
  const status = flags.has('add') ? 'added' : 'declined';
  const trackUrl = flags.get(status === 'added' ? 'add' : 'decline');
  if (typeof trackUrl !== 'string') die(`--${status === 'added' ? 'add' : 'decline'} needs a track url.`);
  await setStatus(trackUrl, status);
  process.exit(0);
}

const wanted = flags.has('all') ? ['new', 'added', 'declined'] : ['new'];
const { data: rows, error } = await supabase
  .from('suggestions')
  .select('track_url, listener_id, status, created_at')
  .eq('room_id', room.id)
  .in('status', wanted)
  .order('created_at', { ascending: true });
if (error) die(`Could not read suggestions: ${error.message}`);

if (!rows || rows.length === 0) {
  console.log(`\n  Nothing ${flags.has('all') ? 'at all' : 'waiting'} in "${roomSlug}".\n`);
  process.exit(0);
}

// Group by track: several people wanting the same thing is one decision with
// more weight behind it, not several decisions.
const byTrack = new Map();
for (const row of rows) {
  const existing = byTrack.get(row.track_url) ?? {
    listeners: new Set(),
    status: row.status,
    first: row.created_at,
  };
  existing.listeners.add(row.listener_id);
  byTrack.set(row.track_url, existing);
}

async function describe(trackUrl) {
  try {
    const response = await fetch(
      `https://soundcloud.com/oembed?url=${encodeURIComponent(trackUrl)}&format=json`,
    );
    if (!response.ok) return null;
    const body = await response.json();
    const artist = body.author_name ?? null;
    // oEmbed titles arrive as "Track by Artist", so printing both duplicates
    // the artist. The author field is the reliable half.
    let title = body.title ?? null;
    if (title && artist && title.toLowerCase().endsWith(` by ${artist.toLowerCase()}`)) {
      title = title.slice(0, -(` by ${artist}`.length)).trim();
    }
    return { title, artist };
  } catch {
    return null;
  }
}

const entries = [...byTrack.entries()];
const described = await Promise.all(entries.map(([trackUrl]) => describe(trackUrl)));

console.log(`\n  ${room.name} — ${entries.length} track(s) requested\n`);
entries.forEach(([trackUrl, info], index) => {
  const meta = described[index];
  const asked = info.listeners.size;
  const heading = meta
    ? `${meta.artist ?? 'unknown'} — ${meta.title ?? trackUrl}`
    : `${trackUrl}  (could not read metadata — the track may be gone)`;
  console.log(`  ${heading}`);
  console.log(`    ${trackUrl}`);
  console.log(
    `    ${asked} listener${asked === 1 ? '' : 's'} · ${info.status} · first asked ${new Date(info.first).toLocaleString()}`,
  );
  console.log('');
});

console.log(`  To act on one:
    node --env-file=.env.local scripts/requests.mjs --add <url>
    node --env-file=.env.local scripts/requests.mjs --decline <url>

  "Added" does not add it. SoundCloud has no public API we are allowed to
  use, so a track joins the playlist by hand: add it to the set in
  SoundCloud, re-run /seed to verify it actually plays, and re-seed. Marking
  it added records that you did.
`);
