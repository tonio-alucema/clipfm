/**
 * Favouriting a track.
 *
 * The durable half of step 6. The visual burst everyone sees is broadcast and
 * never written — see the room channel — because writing a row per tap would
 * exhaust the free tier and add latency to the one interaction that has to
 * feel instant.
 *
 * A favourite is a fact, not an event: "this listener likes this track". The
 * unique constraint in the schema says so, and tapping twice is the same fact
 * stated twice. So a duplicate is success, not failure.
 */

import { getSupabase } from '../db/client';

export type FavoriteOutcome =
  /** The row landed. */
  | 'saved'
  /** Already favourited. Indistinguishable from success to a listener. */
  | 'already'
  /** Offline, unconfigured, or rejected. The burst still happened. */
  | 'failed';

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

export function outcomeForError(error: { code?: string | undefined } | null): FavoriteOutcome {
  if (error === null) return 'saved';
  return error.code === UNIQUE_VIOLATION ? 'already' : 'failed';
}

export type FavoriteRequest = {
  roomId: string;
  trackUrl: string;
  listenerId: string;
};

/**
 * Never throws. A favourite that fails to persist must not break the room or
 * swallow the burst the listener already saw — the interaction is optimistic
 * by design, and the row is a bonus.
 */
export async function favoriteTrack(request: FavoriteRequest): Promise<FavoriteOutcome> {
  const supabase = getSupabase();
  if (supabase === null) return 'failed';

  const { error } = await supabase.from('favorites').insert({
    room_id: request.roomId,
    track_url: request.trackUrl,
    listener_id: request.listenerId,
  });

  return outcomeForError(error);
}

/** Which tracks this listener has already favourited in this room. */
export async function fetchMyFavorites(
  roomId: string,
  listenerId: string,
): Promise<Set<string>> {
  const supabase = getSupabase();
  const mine = new Set<string>();
  if (supabase === null) return mine;

  const { data, error } = await supabase
    .from('favorites')
    .select('track_url')
    .eq('room_id', roomId)
    .eq('listener_id', listenerId);
  if (error !== null || data === null) return mine;

  for (const row of data as Array<Record<string, unknown>>) {
    const url = row['track_url'];
    if (typeof url === 'string') mine.add(url);
  }
  return mine;
}

/** How many times each track in this room has been favourited. */
export async function fetchFavoriteCounts(roomId: string): Promise<Map<string, number>> {
  const supabase = getSupabase();
  const counts = new Map<string, number>();
  if (supabase === null) return counts;

  const { data, error } = await supabase
    .from('favorites')
    .select('track_url')
    .eq('room_id', roomId);
  if (error !== null || data === null) return counts;

  for (const row of data as Array<Record<string, unknown>>) {
    const url = row['track_url'];
    if (typeof url !== 'string') continue;
    counts.set(url, (counts.get(url) ?? 0) + 1);
  }
  return counts;
}
