/**
 * Requesting a track.
 *
 * Deliberately not a queue. Nothing here reaches a schedule on its own — a
 * suggestion is a message to whoever curates the set, and stays inert until
 * someone acts on it. That keeps the schedule what it is: a frozen snapshot
 * nobody can change by wanting something.
 */

import { getSupabase } from '../db/client';

export type SuggestionOutcome =
  | 'saved'
  /** This listener already asked for this track. */
  | 'already'
  | 'invalid'
  | 'failed';

const UNIQUE_VIOLATION = '23505';

/**
 * A SoundCloud track URL, or null.
 *
 * Deliberately strict. A set, a playlist, a profile, or somebody's Spotify
 * link are all things a curator cannot drop into the set, so they are rejected
 * here rather than discovered later.
 */
export function parseSoundCloudTrackUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  let url: URL;
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'soundcloud.com' && host !== 'm.soundcloud.com') return null;

  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  // A track is /user/track. One segment is a profile; three usually means
  // /user/sets/name, which is a playlist rather than something playable.
  if (segments.length !== 2) return null;
  if (segments[1] === 'sets' || segments[0] === 'sets') return null;

  return `https://soundcloud.com/${segments[0]}/${segments[1]}`;
}

export type SuggestRequest = {
  roomId: string;
  listenerId: string;
  input: string;
};

/** Never throws. */
export async function suggestTrack(request: SuggestRequest): Promise<SuggestionOutcome> {
  const trackUrl = parseSoundCloudTrackUrl(request.input);
  if (trackUrl === null) return 'invalid';

  const supabase = getSupabase();
  if (supabase === null) return 'failed';

  const { error } = await supabase.from('suggestions').insert({
    room_id: request.roomId,
    track_url: trackUrl,
    listener_id: request.listenerId,
  });

  if (error === null) return 'saved';
  return error.code === UNIQUE_VIOLATION ? 'already' : 'failed';
}
