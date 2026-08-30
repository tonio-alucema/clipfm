/**
 * Comparing track URLs.
 *
 * Neutral ground: both the player and the sync loop need to ask "is this the
 * same track?", and the answer must not depend on which of them is asking.
 * A permalink shared out of a set carries the playlist it was opened in, and
 * casing and trailing slashes vary by where the link came from.
 */
export function normalizeTrackUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}
