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

/**
 * A `on.soundcloud.com/<token>` share link, or null.
 *
 * These carry no track in them at all — the token means nothing until
 * SoundCloud is asked what it points at, which is a redirect only a server can
 * follow. The charset is deliberately narrow: this value ends up in a URL that
 * gets fetched, so it is validated as a token rather than trusted as a path.
 */
export function parseSoundCloudShortLink(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  let url: URL;
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (url.hostname.toLowerCase().replace(/^www\./, '') !== 'on.soundcloud.com') return null;

  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  const token = segments[0];
  if (segments.length !== 1 || token === undefined) return null;
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(token)) return null;

  return `https://on.soundcloud.com/${token}`;
}

/**
 * A track URL from whatever a listener pasted.
 *
 * Share links from the SoundCloud app are shortened, and resolving one means
 * following a redirect the browser is not allowed to follow — so that hop
 * happens on our server, and only for links that are already known to be
 * SoundCloud short links.
 */
export async function resolveTrackUrl(input: string): Promise<string | null> {
  const direct = parseSoundCloudTrackUrl(input);
  if (direct !== null) return direct;

  const shortLink = parseSoundCloudShortLink(input);
  if (shortLink === null) return null;

  try {
    const response = await fetch(`/api/resolve-track?url=${encodeURIComponent(shortLink)}`);
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const resolved = (body as { url?: unknown }).url;
    return typeof resolved === 'string' ? parseSoundCloudTrackUrl(resolved) : null;
  } catch {
    return null;
  }
}

export type SuggestRequest = {
  roomId: string;
  listenerId: string;
  input: string;
};

/** Never throws. */
export async function suggestTrack(request: SuggestRequest): Promise<SuggestionOutcome> {
  const trackUrl = await resolveTrackUrl(request.input);
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
