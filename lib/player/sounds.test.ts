import { describe, expect, it } from 'vitest';
import {
  indexSoundsByUrl,
  normalizeTrackUrl,
  parseWidgetSound,
  parseWidgetSounds,
} from './sounds';

const sound = (overrides: Record<string, unknown> = {}) => ({
  permalink_url: 'https://soundcloud.com/elvissonymusic/crawfish-2',
  title: 'Crawfish',
  duration: 112_287,
  artwork_url: 'https://i1.sndcdn.com/artworks-9JrulV6oTbaj-0-t500x500.jpg',
  embeddable_by: 'all',
  user: { username: 'Elvis Presley' },
  ...overrides,
});

describe('normalizeTrackUrl', () => {
  it('ignores differences that do not identify a track', () => {
    const canonical = 'soundcloud.com/onetwotrails/willhe';
    expect(normalizeTrackUrl('https://soundcloud.com/onetwotrails/willhe')).toBe(canonical);
    expect(normalizeTrackUrl('http://www.soundcloud.com/onetwotrails/willhe/')).toBe(canonical);
    expect(normalizeTrackUrl('  https://SoundCloud.com/OneTwoTrails/WillHe  ')).toBe(canonical);
  });

  // The URL as shared from a set carries the playlist it was opened in.
  it('drops playlist context so a set link matches the bare track', () => {
    expect(normalizeTrackUrl('https://soundcloud.com/onetwotrails/willhe?in=tonioalucema/sets/tonio-sandbox')).toBe(
      'soundcloud.com/onetwotrails/willhe',
    );
  });
});

describe('parseWidgetSound', () => {
  it('reads the fields a schedule needs', () => {
    expect(parseWidgetSound(sound(), 23)).toEqual({
      index: 23,
      url: 'https://soundcloud.com/elvissonymusic/crawfish-2',
      title: 'Crawfish',
      artist: 'Elvis Presley',
      artwork: 'https://i1.sndcdn.com/artworks-9JrulV6oTbaj-0-t500x500.jpg',
      durationMs: 112_287,
      embeddable: true,
    });
  });

  it('rejects entries with nothing usable to play', () => {
    expect(parseWidgetSound(null, 0)).toBeNull();
    expect(parseWidgetSound({}, 0)).toBeNull();
    expect(parseWidgetSound(sound({ permalink_url: undefined }), 0)).toBeNull();
    expect(parseWidgetSound(sound({ duration: 0 }), 0)).toBeNull();
    expect(parseWidgetSound(sound({ duration: 'long' }), 0)).toBeNull();
  });

  it('treats a missing embeddable_by as unrestricted, not as denied', () => {
    expect(parseWidgetSound(sound({ embeddable_by: undefined }), 0)?.embeddable).toBe(true);
    expect(parseWidgetSound(sound({ embeddable_by: 'me' }), 0)?.embeddable).toBe(false);
  });

  it('falls back rather than dropping a track missing cosmetic fields', () => {
    const parsed = parseWidgetSound(sound({ title: undefined, user: {} }), 0);
    expect(parsed?.title).toBe('Unknown track');
    expect(parsed?.artist).toBe('Unknown artist');
  });
});

describe('parseWidgetSounds', () => {
  // Index must be the position in the set, since that is what skip() takes.
  it('keeps set positions even when entries are dropped', () => {
    const parsed = parseWidgetSounds([sound(), null, sound({ permalink_url: 'https://soundcloud.com/a/b' })]);
    expect(parsed.map((s) => s.index)).toEqual([0, 2]);
  });
});

describe('indexSoundsByUrl', () => {
  it('maps a stored track url to its position in the set', () => {
    const sounds = parseWidgetSounds([
      sound({ permalink_url: 'https://soundcloud.com/a/one' }),
      sound({ permalink_url: 'https://soundcloud.com/b/two' }),
    ]);
    const byUrl = indexSoundsByUrl(sounds);
    expect(byUrl.get('soundcloud.com/b/two')).toBe(1);
    expect(byUrl.get('soundcloud.com/nope')).toBeUndefined();
  });

  it('keeps the first position when a set lists a track twice', () => {
    const sounds = parseWidgetSounds([sound(), sound()]);
    expect(indexSoundsByUrl(sounds).get('soundcloud.com/elvissonymusic/crawfish-2')).toBe(0);
  });
});
