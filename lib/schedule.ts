/**
 * The schedule is the source of truth.
 *
 * A schedule is a frozen ordered array of tracks plus an epoch. Playback
 * position is a pure function of time: no state, no events, no coordination.
 * Every client evaluating this function with the same clock gets the same
 * answer, which is the entire synchronisation mechanism.
 *
 * Nothing here reads a clock. `nowMs` is always passed in — callers supply
 * `serverNow()`, never `Date.now()`.
 */

export type Track = {
  url: string;
  title: string;
  artist: string;
  artwork: string | null;
  durationMs: number;
};

export type SchedulePosition =
  | { kind: 'playing'; trackIndex: number; offsetMs: number; track: Track }
  | { kind: 'empty' };

/**
 * A track only occupies time if it has a positive duration. Corrupt or
 * zero-duration entries are skipped rather than throwing: a bad row in a
 * schedule snapshot should not take down the room.
 */
function playableDurationMs(track: Track): number {
  const { durationMs } = track;
  return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
}

/** Length of one full revolution of the playlist. */
export function totalDurationMs(tracks: readonly Track[]): number {
  let total = 0;
  for (const track of tracks) total += playableDurationMs(track);
  return total;
}

/**
 * True modulo. JS `%` is a remainder and keeps the sign of the dividend, so a
 * future epoch or a slow client clock would otherwise produce a negative
 * elapsed time and a negative seek target.
 */
function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * Where the playlist is at `nowMs`, treating it as looping forever since
 * `epochMs`.
 */
export function positionAt(
  tracks: readonly Track[],
  epochMs: number,
  nowMs: number,
): SchedulePosition {
  const total = totalDurationMs(tracks);
  if (total <= 0) return { kind: 'empty' };

  const elapsedMs = mod(nowMs - epochMs, total);

  let accMs = 0;
  for (const [trackIndex, track] of tracks.entries()) {
    const durationMs = playableDurationMs(track);
    if (elapsedMs < accMs + durationMs) {
      return { kind: 'playing', trackIndex, offsetMs: elapsedMs - accMs, track };
    }
    accMs += durationMs;
  }

  // Unreachable for integer durations, since elapsedMs < total. Guards against
  // float drift between the reduce above and the walk here.
  return lastPlayable(tracks);
}

function lastPlayable(tracks: readonly Track[]): SchedulePosition {
  for (let i = tracks.length - 1; i >= 0; i--) {
    const track = tracks[i];
    if (track === undefined) continue;
    const durationMs = playableDurationMs(track);
    if (durationMs > 0) {
      return { kind: 'playing', trackIndex: i, offsetMs: durationMs - 1, track };
    }
  }
  return { kind: 'empty' };
}

/**
 * Milliseconds until the current track gives way to the next one.
 *
 * A boundary is not an event — nothing fires when a track ends. The sync loop
 * uses this to arm a timer for the transition instead of discovering it late
 * on the next drift poll.
 */
export function msUntilBoundary(
  tracks: readonly Track[],
  epochMs: number,
  nowMs: number,
): number | null {
  const position = positionAt(tracks, epochMs, nowMs);
  if (position.kind === 'empty') return null;
  return playableDurationMs(position.track) - position.offsetMs;
}
