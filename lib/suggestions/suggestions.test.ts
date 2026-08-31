import { describe, expect, it } from 'vitest';
import { parseSoundCloudTrackUrl } from './suggestions';

describe('parseSoundCloudTrackUrl', () => {
  it('accepts a track link and normalises it', () => {
    expect(parseSoundCloudTrackUrl('https://soundcloud.com/shhmody/soul-1')).toBe(
      'https://soundcloud.com/shhmody/soul-1',
    );
  });

  it('accepts the shapes people actually paste', () => {
    const expected = 'https://soundcloud.com/shhmody/soul-1';
    expect(parseSoundCloudTrackUrl('  soundcloud.com/shhmody/soul-1  ')).toBe(expected);
    expect(parseSoundCloudTrackUrl('http://www.soundcloud.com/shhmody/soul-1')).toBe(expected);
    expect(parseSoundCloudTrackUrl('https://m.soundcloud.com/shhmody/soul-1')).toBe(expected);
    // Shared from inside a set, which is how most links arrive.
    expect(parseSoundCloudTrackUrl('https://soundcloud.com/shhmody/soul-1?in=a/sets/b')).toBe(
      expected,
    );
  });

  // A curator cannot drop any of these into the set, so they are refused at
  // the point of asking rather than discovered later.
  it('rejects things that are not a track', () => {
    expect(parseSoundCloudTrackUrl('https://soundcloud.com/tonioalucema/sets/clipfm')).toBeNull();
    expect(parseSoundCloudTrackUrl('https://soundcloud.com/shhmody')).toBeNull();
    expect(parseSoundCloudTrackUrl('https://open.spotify.com/track/abc')).toBeNull();
    expect(parseSoundCloudTrackUrl('https://youtube.com/watch?v=abc')).toBeNull();
    expect(parseSoundCloudTrackUrl('not a url at all')).toBeNull();
    expect(parseSoundCloudTrackUrl('')).toBeNull();
    expect(parseSoundCloudTrackUrl('   ')).toBeNull();
  });

  it('rejects a lookalike host', () => {
    expect(parseSoundCloudTrackUrl('https://soundcloud.com.evil.example/a/b')).toBeNull();
    expect(parseSoundCloudTrackUrl('https://notsoundcloud.com/a/b')).toBeNull();
  });
});
