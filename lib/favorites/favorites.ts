/**
 * Favoriting a track.
 *
 * A favorite is a fact, not an event — "this listener liked this track" — so
 * it is one row per listener per track, asserted once and never rewritten. The
 * visual burst is broadcast separately and never written; see the room channel.
 *
 * There is deliberately no update and no delete. The unique constraint alone
 * makes a second tap idempotent, which is why the insert is plain rather than
 * an upsert, and it means no privilege exists that would let one listener
 * alter another's row. The trade is that a favorite cannot be taken back.
 * That is the intended shape: the curator reads this to find more of what the
 * room likes, and an un-heart would be a different, noisier signal.
 */

import { getSupabase } from '../db/client';

export type FavoriteOutcome = 'saved' | 'unchanged' | 'failed';

const UNIQUE_VIOLATION = '23505';

/**
 * A repeat tap collides with the unique constraint, and that is success, not
 * failure — the listener's favorite is already recorded. Only a genuinely
 * unexpected error counts as failed.
 */
export function outcomeForError(error: { code?: string | undefined } | null): FavoriteOutcome {
  if (error === null) return 'saved';
  return error.code === UNIQUE_VIOLATION ? 'unchanged' : 'failed';
}

export type FavoriteRequest = {
  roomId: string;
  trackUrl: string;
  listenerId: string;
};

/**
 * Never throws. A favorite that fails to persist must not break the room or
 * retract the burst the listener already saw.
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

/** How many listeners have favorited each track in the room. */
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

/** Which tracks this listener has favorited, so the button can show it. */
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
