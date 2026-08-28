import type { Track } from '../schedule';

/**
 * Fixture playlist for the pre-Supabase steps.
 *
 * Durations were harvested once through the widget's `getCurrentSound()` on
 * 2026-08-27 and frozen here, exactly as the step 4 seed script will freeze
 * them into a schedule snapshot. They are never fetched at runtime.
 *
 * Both tracks reported `embeddable_by: "all"` and `streamable: true`, which is
 * the check that matters — oEmbed resolving proves the track exists, not that
 * it will play off-platform.
 */
/**
 * The widget is pointed at this set once and never reloaded; track changes are
 * `skip(index)` within it. Every track in a schedule must be a member.
 */
export const FIXTURE_SET_URL = 'https://soundcloud.com/tonioalucema/sets/tonio-sandbox';

export const FIXTURE_TRACKS: Track[] = [
  {
    url: 'https://soundcloud.com/elvissonymusic/crawfish-2',
    title: 'Crawfish',
    artist: 'Elvis Presley',
    artwork: 'https://i1.sndcdn.com/artworks-9JrulV6oTbaj-0-t500x500.jpg',
    durationMs: 112_287,
  },
  {
    url: 'https://soundcloud.com/onetwotrails/willhe',
    title: 'Joji - Will He (DRKTMS & TRAILS Remix)',
    artist: 'TRAILS',
    artwork: 'https://i1.sndcdn.com/artworks-000354120795-ldsvag-t500x500.jpg',
    durationMs: 180_596,
  },
];

/**
 * A fixed epoch, not a computed one. Every tab must agree on it or the whole
 * test is meaningless, so it is a literal rather than anything derived from a
 * clock at load time.
 */
export const FIXTURE_EPOCH_MS = Date.UTC(2026, 0, 1);
