/**
 * Reading the widget's view of a loaded set.
 *
 * `getSounds()` returns the whole set in one keyless call — titles, artists,
 * durations, permalinks, and embeddability. Kept pure and separate so the
 * parsing can be tested without a browser.
 */

export { normalizeTrackUrl } from '../track-url';

export type WidgetSound = {
  index: number;
  url: string;
  title: string;
  artist: string;
  artwork: string | null;
  durationMs: number;
  embeddable: boolean;
};


import { normalizeTrackUrl } from '../track-url';

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Parses one `getSounds()` entry, returning null for anything unusable. */
export function parseWidgetSound(raw: unknown, index: number): WidgetSound | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const sound = raw as Record<string, unknown>;

  const url = readString(sound, 'permalink_url');
  const durationMs = sound['duration'];
  if (url === null || typeof durationMs !== 'number' || durationMs <= 0) return null;

  const user = (sound['user'] ?? {}) as Record<string, unknown>;

  return {
    index,
    url,
    title: readString(sound, 'title') ?? 'Unknown track',
    artist: readString(user, 'username') ?? 'Unknown artist',
    artwork: readString(sound, 'artwork_url'),
    durationMs,
    // Absent means unrestricted; only an explicit narrower value excludes it.
    embeddable: (readString(sound, 'embeddable_by') ?? 'all') === 'all',
  };
}

export function parseWidgetSounds(raw: readonly unknown[]): WidgetSound[] {
  const parsed: WidgetSound[] = [];
  raw.forEach((entry, index) => {
    const sound = parseWidgetSound(entry, index);
    if (sound !== null) parsed.push(sound);
  });
  return parsed;
}

/** Maps normalised track URL to its position in the set. */
export function indexSoundsByUrl(sounds: readonly WidgetSound[]): Map<string, number> {
  const byUrl = new Map<string, number>();
  for (const sound of sounds) {
    const key = normalizeTrackUrl(sound.url);
    if (!byUrl.has(key)) byUrl.set(key, sound.index);
  }
  return byUrl;
}
