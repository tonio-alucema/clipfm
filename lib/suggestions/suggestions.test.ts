import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseSoundCloudShortLink,
  parseSoundCloudTrackUrl,
  resolveTrackUrl,
} from './suggestions';

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

  // What SoundCloud's share button actually produces.
  it('strips the tracking a share link arrives with', () => {
    expect(
      parseSoundCloudTrackUrl(
        'https://soundcloud.com/novussanamusic/sound-of-the-sky?in=tonioalucema/sets/your-mix-dazed&si=c31f9301f96649df884338b8efe0e7ac&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing',
      ),
    ).toBe('https://soundcloud.com/novussanamusic/sound-of-the-sky');
  });

  it('rejects a lookalike host', () => {
    expect(parseSoundCloudTrackUrl('https://soundcloud.com.evil.example/a/b')).toBeNull();
    expect(parseSoundCloudTrackUrl('https://notsoundcloud.com/a/b')).toBeNull();
  });
});

describe('parseSoundCloudShortLink', () => {
  it('accepts a share link from the app', () => {
    expect(parseSoundCloudShortLink('https://on.soundcloud.com/Kx1amBgAMPQjuMLP6i')).toBe(
      'https://on.soundcloud.com/Kx1amBgAMPQjuMLP6i',
    );
    expect(parseSoundCloudShortLink('  on.soundcloud.com/Kx1amBgAMPQjuMLP6i  ')).toBe(
      'https://on.soundcloud.com/Kx1amBgAMPQjuMLP6i',
    );
  });

  // This value ends up in a URL the server fetches, so it is validated as a
  // token rather than trusted as a path.
  it('refuses anything that is not a plain token on that host', () => {
    expect(parseSoundCloudShortLink('https://on.soundcloud.com/a/b')).toBeNull();
    expect(parseSoundCloudShortLink('https://on.soundcloud.com/../../etc')).toBeNull();
    expect(parseSoundCloudShortLink('https://on.soundcloud.com/')).toBeNull();
    expect(parseSoundCloudShortLink('https://on.soundcloud.com.evil.example/abcd')).toBeNull();
    expect(parseSoundCloudShortLink('https://soundcloud.com/user/track')).toBeNull();
    expect(parseSoundCloudShortLink('https://evil.example/abcd')).toBeNull();
  });
});

describe('resolveTrackUrl', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not go near the network for a link that already names the track', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      resolveTrackUrl('https://soundcloud.com/novussanamusic/sound-of-the-sky?si=abc'),
    ).resolves.toBe('https://soundcloud.com/novussanamusic/sound-of-the-sky');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('asks the server what a share link points at', async () => {
    let calledWith = '';
    const fetchSpy = vi.fn((requested: unknown) => {
      calledWith = String(requested);
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ url: 'https://soundcloud.com/novussanamusic/sound-of-the-sky' }),
      });
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(resolveTrackUrl('https://on.soundcloud.com/Kx1amBgAMPQjuMLP6i')).resolves.toBe(
      'https://soundcloud.com/novussanamusic/sound-of-the-sky',
    );
    expect(fetchSpy).toHaveBeenCalled();
    expect(calledWith).toContain('/api/resolve-track');
  });

  // Both forms in the wild point at the same track, so both must land on the
  // same stored URL — otherwise the same song arrives twice under two links
  // and the unique constraint never fires.
  it('lands a share link and a full link on the same track', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            url: 'https://soundcloud.com/novussanamusic/sound-of-the-sky?utm_source=clipboard&si=80dad',
          }),
      }),
    );
    const fromShare = await resolveTrackUrl('https://on.soundcloud.com/Kx1amBgAMPQjuMLP6i');
    const fromFull = await resolveTrackUrl(
      'https://soundcloud.com/novussanamusic/sound-of-the-sky?in=tonioalucema/sets/your-mix-dazed&si=c31f&utm_source=clipboard',
    );
    expect(fromShare).toBe(fromFull);
  });

  it('gives up quietly when the server cannot resolve it', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
    await expect(resolveTrackUrl('https://on.soundcloud.com/Kx1amBgAMPQjuMLP6i')).resolves.toBeNull();

    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    await expect(resolveTrackUrl('https://on.soundcloud.com/Kx1amBgAMPQjuMLP6i')).resolves.toBeNull();
  });
});
