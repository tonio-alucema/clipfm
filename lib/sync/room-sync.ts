/**
 * The sync loop. Wires the schedule to a player.
 *
 * Deliberately free of React so the decisions can be tested directly. Nothing
 * here reads a clock except through the injected `serverNow`.
 *
 * Two timers, doing different jobs:
 *
 * - a drift poll, which corrects slow divergence within a track
 * - a boundary timer, armed for the exact moment the next track starts
 *
 * The boundary timer is not an optimisation. A track change is not an event —
 * it is a discontinuity in a function — so with only a 5s poll every client
 * would notice the change up to 5s late and sit in silence until it did.
 */

import {
  DRIFT_CHECK_INTERVAL_MS,
  DRIFT_CORRECTION_THRESHOLD_MS,
  JOIN_CORRECTION_THRESHOLD_MS,
  MAX_TIMER_MS,
  POST_SEEK_CHECK_MS,
  SEEK_SETTLE_MS,
  STALL_RECOVERY_DELAY_MS,
} from '../config/sync';
import type { PlayerState, RoomPlayer } from '../player/types';
import { msUntilBoundary, positionAt, type SchedulePosition, type Track } from '../schedule';

export type SyncSnapshot = {
  position: SchedulePosition | null;
  playerState: PlayerState;
  /** Where the schedule says we should be, within the current track. */
  targetMs: number | null;
  /** Where the player says it actually is. */
  actualMs: number | null;
  /** actual - target. Positive means running ahead. */
  driftMs: number | null;
  corrections: number;
  loadedTrackIndex: number | null;
  tunedIn: boolean;
  unavailable: boolean;
};

export const INITIAL_SNAPSHOT: SyncSnapshot = {
  position: null,
  playerState: 'idle',
  targetMs: null,
  actualMs: null,
  driftMs: null,
  corrections: 0,
  loadedTrackIndex: null,
  tunedIn: false,
  unavailable: false,
};

export type CorrectionInput = {
  driftMs: number;
  playerState: PlayerState;
  /** Time since the last seek, so a correction is not judged mid-seek. */
  msSinceSeek: number;
  thresholdMs?: number;
  settleMs?: number;
};

/**
 * Whether a drift reading justifies re-seeking.
 *
 * Refusing to correct is the safe default. A correction is audible, and
 * correcting on a bad reading — one taken while buffering, or moments after a
 * previous seek that has not landed — produces a seek/stall loop that is far
 * worse than the drift it was trying to fix.
 */
export function shouldCorrect({
  driftMs,
  playerState,
  msSinceSeek,
  thresholdMs = DRIFT_CORRECTION_THRESHOLD_MS,
  settleMs = SEEK_SETTLE_MS,
}: CorrectionInput): boolean {
  if (!Number.isFinite(driftMs)) return false;
  if (playerState !== 'playing') return false;
  if (msSinceSeek < settleMs) return false;
  return Math.abs(driftMs) > thresholdMs;
}

export type RoomSyncOptions = {
  player: RoomPlayer;
  tracks: readonly Track[];
  epochMs: number;
  serverNow: () => number;
  onChange: (snapshot: SyncSnapshot) => void;
  /** Injected for tests; defaults to the monotonic clock. */
  perfNow?: () => number;
};

export type RoomSync = {
  /** Call from a user gesture. Autoplay is blocked without one. */
  tuneIn: () => Promise<void>;
  stop: () => void;
  getSnapshot: () => SyncSnapshot;
};

export function createRoomSync(options: RoomSyncOptions): RoomSync {
  const { player, tracks, epochMs, serverNow, onChange } = options;
  const perfNow = options.perfNow ?? (() => performance.now());

  let snapshot: SyncSnapshot = INITIAL_SNAPSHOT;
  let stopped = false;
  /** A load/seek transition is in flight; drift readings are meaningless. */
  let busy = false;
  let lastSeekAtPerf = Number.NEGATIVE_INFINITY;
  /**
   * The widget drops `seekTo()` on a track that has never played. So a join
   * plays first and seeks on the first confirmed playback, recomputing the
   * target then rather than reusing a value that has since gone stale.
   */
  let awaitingFirstPlay = false;
  let driftTimer: ReturnType<typeof setInterval> | null = null;
  let boundaryTimer: ReturnType<typeof setTimeout> | null = null;
  let postSeekTimer: ReturnType<typeof setTimeout> | null = null;
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;

  function emit(patch: Partial<SyncSnapshot>): void {
    snapshot = { ...snapshot, ...patch };
    onChange(snapshot);
  }

  const unsubscribePlayer = player.onStateChange((playerState) => {
    if (stopped) return;
    emit({ playerState });

    // Recover from silence promptly rather than waiting out the drift poll.
    if (playerState === 'stalled' && snapshot.tunedIn && recoveryTimer === null) {
      recoveryTimer = setTimeout(() => {
        recoveryTimer = null;
        void transition();
      }, STALL_RECOVERY_DELAY_MS);
    }

    if (playerState !== 'playing' || !awaitingFirstPlay) return;

    awaitingFirstPlay = false;
    const current = positionAt(tracks, epochMs, serverNow());
    if (current.kind !== 'playing' || current.trackIndex !== snapshot.loadedTrackIndex) return;
    player.seekTo(current.offsetMs);
    lastSeekAtPerf = perfNow();
    emit({ position: current, targetMs: current.offsetMs });
  });

  function armBoundaryTimer(): void {
    if (boundaryTimer !== null) clearTimeout(boundaryTimer);
    boundaryTimer = null;
    if (stopped) return;

    const remaining = msUntilBoundary(tracks, epochMs, serverNow());
    if (remaining === null) return;

    const delay = Math.min(Math.max(remaining, 0), MAX_TIMER_MS);
    boundaryTimer = setTimeout(() => {
      void transition();
    }, delay);
  }

  /** Bring the player onto whatever track the schedule currently names. */
  async function transition(): Promise<void> {
    if (stopped || busy) return;

    const position = positionAt(tracks, epochMs, serverNow());
    if (position.kind === 'empty') {
      emit({ position });
      return;
    }

    busy = true;
    try {
      if (snapshot.loadedTrackIndex !== position.trackIndex) {
        const outcome = await player.load(position.track.url);
        if (stopped) return;
        // Record the index even when the track will not play, so we do not
        // retry it every poll. The clock keeps running; we rejoin at the next
        // boundary.
        emit({
          loadedTrackIndex: position.trackIndex,
          unavailable: outcome === 'unavailable',
        });
        if (outcome === 'unavailable') return;
      }

      // Recompute: the load took real time, and the schedule moved on.
      const current = positionAt(tracks, epochMs, serverNow());
      if (current.kind !== 'playing') return;

      if (snapshot.tunedIn && player.getState() !== 'playing') {
        // Seeking now would be dropped. Start playback and let the state
        // change above place the needle.
        awaitingFirstPlay = true;
        player.play();
      } else {
        player.seekTo(current.offsetMs);
        lastSeekAtPerf = perfNow();
      }

      emit({ position: current, targetMs: current.offsetMs, unavailable: false });

      // The seek above lands late by however long loading and seeking took.
      // Check once more with a tight threshold, while the transition still
      // masks a correction.
      if (postSeekTimer !== null) clearTimeout(postSeekTimer);
      postSeekTimer = setTimeout(() => {
        void checkDrift(JOIN_CORRECTION_THRESHOLD_MS);
      }, POST_SEEK_CHECK_MS);
    } finally {
      busy = false;
      armBoundaryTimer();
    }
  }

  async function checkDrift(thresholdMs = DRIFT_CORRECTION_THRESHOLD_MS): Promise<void> {
    if (stopped || busy || !snapshot.tunedIn) return;

    // A stall is not a drift problem and must not be treated as one. The
    // guard in shouldCorrect stops us seeking on a meaningless reading, but on
    // its own it would also freeze us here forever, watching drift grow.
    // Re-entering the transition restarts playback and re-places the needle.
    if (player.getState() === 'stalled') {
      emit({ playerState: 'stalled' });
      void transition();
      return;
    }

    const actualMs = await player.getPosition();
    if (stopped || busy) return;

    // Read the target as close as possible to when the position was sampled.
    const current = positionAt(tracks, epochMs, serverNow());
    if (current.kind === 'empty') return;
    if (current.trackIndex !== snapshot.loadedTrackIndex) {
      void transition();
      return;
    }

    const targetMs = current.offsetMs;
    const driftMs = actualMs - targetMs;
    const playerState = player.getState();

    let { corrections } = snapshot;
    if (
      shouldCorrect({ driftMs, playerState, msSinceSeek: perfNow() - lastSeekAtPerf, thresholdMs })
    ) {
      player.seekTo(targetMs);
      lastSeekAtPerf = perfNow();
      corrections += 1;
    }

    emit({
      position: current,
      targetMs,
      actualMs: Number.isFinite(actualMs) ? actualMs : null,
      driftMs: Number.isFinite(driftMs) ? driftMs : null,
      playerState,
      corrections,
    });
  }

  return {
    async tuneIn() {
      if (stopped) return;
      emit({ tunedIn: true });
      await transition();
      if (driftTimer === null) {
        driftTimer = setInterval(() => {
          void checkDrift();
        }, DRIFT_CHECK_INTERVAL_MS);
      }
    },
    stop() {
      stopped = true;
      if (driftTimer !== null) clearInterval(driftTimer);
      if (boundaryTimer !== null) clearTimeout(boundaryTimer);
      if (postSeekTimer !== null) clearTimeout(postSeekTimer);
      if (recoveryTimer !== null) clearTimeout(recoveryTimer);
      driftTimer = null;
      boundaryTimer = null;
      postSeekTimer = null;
      recoveryTimer = null;
      unsubscribePlayer();
    },
    getSnapshot: () => snapshot,
  };
}
