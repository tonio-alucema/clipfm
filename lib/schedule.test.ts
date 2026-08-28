import { describe, expect, it } from 'vitest';
import {
  msUntilBoundary,
  positionAt,
  totalDurationMs,
  type Track,
} from './schedule';

const track = (id: string, durationMs: number): Track => ({
  url: `https://soundcloud.com/test/${id}`,
  title: id,
  artist: 'test',
  artwork: null,
  durationMs,
});

const A = track('a', 100_000);
const B = track('b', 200_000);
const C = track('c', 50_000);

/** A: [0, 100k)  B: [100k, 300k)  C: [300k, 350k)  — one revolution = 350k */
const PLAYLIST = [A, B, C];
const TOTAL = 350_000;
const EPOCH = 1_700_000_000_000;

/** Position `ms` into the current revolution. */
const at = (ms: number) => positionAt(PLAYLIST, EPOCH, EPOCH + ms);

describe('totalDurationMs', () => {
  it('sums the playlist', () => {
    expect(totalDurationMs(PLAYLIST)).toBe(TOTAL);
  });

  it('is zero for an empty playlist', () => {
    expect(totalDurationMs([])).toBe(0);
  });
});

describe('positionAt', () => {
  it('returns the first track at t=0', () => {
    expect(at(0)).toEqual({ kind: 'playing', trackIndex: 0, offsetMs: 0, track: A });
  });

  it('returns an offset mid-track', () => {
    expect(at(30_000)).toEqual({ kind: 'playing', trackIndex: 0, offsetMs: 30_000, track: A });
    expect(at(150_000)).toEqual({ kind: 'playing', trackIndex: 1, offsetMs: 50_000, track: B });
  });

  it('lands on the next track exactly at a boundary, not the previous one', () => {
    expect(at(99_999)).toEqual({ kind: 'playing', trackIndex: 0, offsetMs: 99_999, track: A });
    expect(at(100_000)).toEqual({ kind: 'playing', trackIndex: 1, offsetMs: 0, track: B });
    expect(at(300_000)).toEqual({ kind: 'playing', trackIndex: 2, offsetMs: 0, track: C });
  });

  it('holds the last track through its final millisecond', () => {
    expect(at(TOTAL - 1)).toEqual({ kind: 'playing', trackIndex: 2, offsetMs: 49_999, track: C });
  });

  it('wraps around past the end of the playlist', () => {
    expect(at(TOTAL)).toEqual({ kind: 'playing', trackIndex: 0, offsetMs: 0, track: A });
    expect(at(TOTAL + 30_000)).toEqual({ kind: 'playing', trackIndex: 0, offsetMs: 30_000, track: A });
  });

  it('is stable after a thousand revolutions', () => {
    expect(at(TOTAL * 1_000 + 150_000)).toEqual({
      kind: 'playing',
      trackIndex: 1,
      offsetMs: 50_000,
      track: B,
    });
  });

  // JS `%` keeps the sign of the dividend. A future epoch, or a client whose
  // clock runs behind the server's, must not produce a negative seek target.
  it('handles a now that precedes the epoch', () => {
    expect(at(-1_000)).toEqual({ kind: 'playing', trackIndex: 2, offsetMs: 49_000, track: C });
    expect(at(-TOTAL)).toEqual({ kind: 'playing', trackIndex: 0, offsetMs: 0, track: A });
    expect(at(-TOTAL * 3 - 1_000)).toEqual({
      kind: 'playing',
      trackIndex: 2,
      offsetMs: 49_000,
      track: C,
    });
  });

  it('reports empty rather than throwing on an empty playlist', () => {
    expect(positionAt([], EPOCH, EPOCH + 5_000)).toEqual({ kind: 'empty' });
  });

  it('reports empty when no track has a usable duration', () => {
    expect(positionAt([track('z', 0)], EPOCH, EPOCH)).toEqual({ kind: 'empty' });
    expect(positionAt([track('z', -5)], EPOCH, EPOCH)).toEqual({ kind: 'empty' });
    expect(positionAt([track('z', Number.NaN)], EPOCH, EPOCH)).toEqual({ kind: 'empty' });
  });

  it('skips unusable tracks without shifting the reported index', () => {
    const withGap = [track('gap', 0), A, track('bad', Number.NaN), B];
    expect(positionAt(withGap, EPOCH, EPOCH)).toEqual({
      kind: 'playing',
      trackIndex: 1,
      offsetMs: 0,
      track: A,
    });
    expect(positionAt(withGap, EPOCH, EPOCH + 100_000)).toEqual({
      kind: 'playing',
      trackIndex: 3,
      offsetMs: 0,
      track: B,
    });
  });

  it('loops a single-track playlist', () => {
    expect(positionAt([A], EPOCH, EPOCH + 150_000)).toEqual({
      kind: 'playing',
      trackIndex: 0,
      offsetMs: 50_000,
      track: A,
    });
  });
});

describe('msUntilBoundary', () => {
  const until = (ms: number) => msUntilBoundary(PLAYLIST, EPOCH, EPOCH + ms);

  it('counts down to the end of the current track', () => {
    expect(until(0)).toBe(100_000);
    expect(until(30_000)).toBe(70_000);
    expect(until(TOTAL - 1)).toBe(1);
  });

  it('reports a full track at a boundary, never zero', () => {
    expect(until(100_000)).toBe(200_000);
    expect(until(TOTAL)).toBe(100_000);
  });

  it('is null when there is nothing to play', () => {
    expect(msUntilBoundary([], EPOCH, EPOCH)).toBeNull();
  });
});
