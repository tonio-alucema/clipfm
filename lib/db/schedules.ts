/**
 * Reading a live schedule.
 *
 * A schedule row is a frozen snapshot written by the seed script. Nothing here
 * writes, and nothing here trusts the shape of what comes back: a malformed
 * row degrades to fewer tracks or none, which the scheduler already handles as
 * a state rather than a crash.
 */

import type { Track } from '../schedule';
import { getSupabase } from './client';

export type LiveSchedule = {
  scheduleId: string;
  roomSlug: string;
  roomName: string;
  /** The set the player loads once and skips within. */
  setUrl: string;
  epochMs: number;
  tracks: Track[];
};

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Parses one entry of the `tracks` jsonb array, or null if unusable. */
export function parseScheduleTrack(raw: unknown): Track | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as Record<string, unknown>;

  const url = readString(entry, 'url');
  const durationMs = entry['durationMs'];
  if (url === null || typeof durationMs !== 'number' || !Number.isFinite(durationMs)) {
    return null;
  }
  // A zero-duration track occupies no time and would silently shift the
  // playlist; the scheduler skips it, but it should not be in a snapshot.
  if (durationMs <= 0) return null;

  return {
    url,
    title: readString(entry, 'title') ?? 'Unknown track',
    artist: readString(entry, 'artist') ?? 'Unknown artist',
    artwork: readString(entry, 'artwork'),
    durationMs,
  };
}

export function parseScheduleTracks(raw: unknown): Track[] {
  if (!Array.isArray(raw)) return [];
  const tracks: Track[] = [];
  for (const entry of raw) {
    const track = parseScheduleTrack(entry);
    if (track !== null) tracks.push(track);
  }
  return tracks;
}

/** Epoch arrives as a timestamptz string; the scheduler wants milliseconds. */
export function parseEpochMs(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export async function fetchActiveSchedule(roomSlug: string): Promise<LiveSchedule | null> {
  const supabase = getSupabase();
  if (supabase === null) return null;

  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('slug, name, active_schedule_id')
    .eq('slug', roomSlug)
    .maybeSingle();

  if (roomError !== null || room === null) return null;
  const activeScheduleId = (room as Record<string, unknown>)['active_schedule_id'];
  if (typeof activeScheduleId !== 'string') return null;

  const { data: schedule, error: scheduleError } = await supabase
    .from('schedules')
    .select('id, epoch, set_url, tracks')
    .eq('id', activeScheduleId)
    .maybeSingle();

  if (scheduleError !== null || schedule === null) return null;
  const row = schedule as Record<string, unknown>;

  const epochMs = parseEpochMs(row['epoch']);
  const setUrl = readString(row, 'set_url');
  if (epochMs === null || setUrl === null) return null;

  return {
    scheduleId: activeScheduleId,
    roomSlug: readString(room as Record<string, unknown>, 'slug') ?? roomSlug,
    roomName: readString(room as Record<string, unknown>, 'name') ?? roomSlug,
    setUrl,
    epochMs,
    tracks: parseScheduleTracks(row['tracks']),
  };
}
