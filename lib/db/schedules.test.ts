import { describe, expect, it } from 'vitest';
import { parseEpochMs, parseScheduleTrack, parseScheduleTracks } from './schedules';

const entry = (overrides: Record<string, unknown> = {}) => ({
  url: 'https://soundcloud.com/elvissonymusic/crawfish-2',
  title: 'Crawfish',
  artist: 'Elvis Presley',
  artwork: 'https://i1.sndcdn.com/artworks-9JrulV6oTbaj-0-t500x500.jpg',
  durationMs: 112_287,
  ...overrides,
});

describe('parseScheduleTrack', () => {
  it('reads a well-formed snapshot entry', () => {
    expect(parseScheduleTrack(entry())).toEqual({
      url: 'https://soundcloud.com/elvissonymusic/crawfish-2',
      title: 'Crawfish',
      artist: 'Elvis Presley',
      artwork: 'https://i1.sndcdn.com/artworks-9JrulV6oTbaj-0-t500x500.jpg',
      durationMs: 112_287,
    });
  });

  it('rejects an entry that cannot occupy time on the schedule', () => {
    expect(parseScheduleTrack(null)).toBeNull();
    expect(parseScheduleTrack('a track')).toBeNull();
    expect(parseScheduleTrack(entry({ url: undefined }))).toBeNull();
    expect(parseScheduleTrack(entry({ durationMs: 0 }))).toBeNull();
    expect(parseScheduleTrack(entry({ durationMs: -1 }))).toBeNull();
    expect(parseScheduleTrack(entry({ durationMs: '112287' }))).toBeNull();
  });

  it('keeps a track that is merely missing cosmetic fields', () => {
    const parsed = parseScheduleTrack(entry({ title: undefined, artist: undefined, artwork: undefined }));
    expect(parsed?.title).toBe('Unknown track');
    expect(parsed?.artist).toBe('Unknown artist');
    expect(parsed?.artwork).toBeNull();
  });
});

describe('parseScheduleTracks', () => {
  it('drops unusable entries rather than failing the whole room', () => {
    expect(parseScheduleTracks([entry(), null, entry({ durationMs: 0 })])).toHaveLength(1);
  });

  it('returns nothing for a row that is not an array at all', () => {
    expect(parseScheduleTracks({})).toEqual([]);
    expect(parseScheduleTracks(null)).toEqual([]);
  });
});

describe('parseEpochMs', () => {
  it('accepts the timestamptz Postgres returns', () => {
    expect(parseEpochMs('2026-01-01T00:00:00.000Z')).toBe(Date.UTC(2026, 0, 1));
    expect(parseEpochMs('2026-01-01T00:00:00+00:00')).toBe(Date.UTC(2026, 0, 1));
  });

  it('rejects anything it cannot turn into an instant', () => {
    expect(parseEpochMs('whenever')).toBeNull();
    expect(parseEpochMs(null)).toBeNull();
    expect(parseEpochMs(undefined)).toBeNull();
  });
});
