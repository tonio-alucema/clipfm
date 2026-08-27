/**
 * Fixture tracks for the pre-Supabase steps.
 *
 * URLs only. Durations are not guessed and not fetched at runtime — they are
 * harvested once by the seed script at step 4 and frozen into a schedule
 * snapshot.
 *
 * Verified against the public oEmbed endpoint on 2026-08-27.
 */
export const FIXTURE_TRACK_URLS = [
  // Forss — Flickermood
  'https://soundcloud.com/forss/flickermood',
] as const;

export const DEFAULT_FIXTURE_TRACK_URL: string = FIXTURE_TRACK_URLS[0];
