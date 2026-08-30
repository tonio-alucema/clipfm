import type { Track } from '../schedule';

/**
 * Fallback playlist, used only when Supabase is not configured.
 *
 * Durations were read from the widget and every track was verified to actually
 * play inside the set — the check at /seed, not the metadata. A track that
 * reports streamable and embeddable can still be silently skipped past, and
 * one that will not play breaks the room for everyone in it.
 *
 * Verified 2026-08-30.
 */
export const FIXTURE_SET_URL = 'https://soundcloud.com/tonioalucema/sets/clipfm';

export const FIXTURE_TRACKS: Track[] = [
  {
    url: 'https://soundcloud.com/shhmody/soul-1',
    title: 'soul [spotify & apple music]',
    artist: 'shhmody',
    artwork: 'https://i1.sndcdn.com/artworks-000466472796-i4v5bs-large.jpg',
    durationMs: 165_636,
  },
  {
    url: 'https://soundcloud.com/alison_synths/golden-dust-re-upload',
    title: 'Golden Dust',
    artist: 'A.L.I.S.O.N',
    artwork: 'https://i1.sndcdn.com/artworks-000466728207-bm3geq-large.jpg',
    durationMs: 272_546,
  },
];

/**
 * A fixed epoch, not a computed one. Every client must agree on it or nothing
 * lines up, so it is a literal rather than anything derived from a clock at
 * load time.
 */
export const FIXTURE_EPOCH_MS = Date.UTC(2026, 0, 1);
