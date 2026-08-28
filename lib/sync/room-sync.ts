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
  MAX_STALL_RECOVERY_ATTEMPTS,
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
  /**
   * We stopped trying to recover. Something is holding the audio that retrying
   * will not release — most likely this room open in another tab.
   */
  contended: boolean;
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
  contended: false,
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
  /**
   * Join the room live. Call from a user gesture — autoplay is blocked
   * without one.
   */
  tuneIn: () => Promise<void>;
  /**
   * Leave the room. Deliberately not "pause": the schedule keeps running while
   * you are out, so tuning back in rejoins wherever the room has got to, not
   * where you left it. There is no resuming a broadcast.
   */
  tuneOut: () => void;
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
  let recoveryAttempts = 0;

  function emit(patch: Partial<SyncSnapshot>): void {
    snapshot = { ...snapshot, ...patch };
    onChange(snapshot);
  }

  const unsubscribePlayer = player.onStateChange((playerState) => {
    if (stopped) return;
    emit({ playerState });

    if (playerState === 'stalled' && snapshot.tunedIn) attemptRecovery();

    if (playerState !== 'playing' || !awaitingFirstPlay) return;

    awaitingFirstPlay = false;
    const current = positionAt(tracks, epochMs, serverNow());
    if (current.kind !== 'playing' || current.trackIndex !== snapshot.loadedTrackIndex) return;
    player.seekTo(current.offsetMs);
    lastSeekAtPerf = perfNow();
    emit({ position: current, targetMs: current.offsetMs });
  });

  /**
   * Retry a stall on a backoff, and stop entirely once the budget is spent.
   * Every path that notices a stall goes through here — a second entry point
   * would silently spend an unbounded number of attempts.
   */
  function attemptRecovery(): void {
    if (stopped || recoveryTimer !== null) return;
    if (recoveryAttempts >= MAX_STALL_RECOVERY_ATTEMPTS) {
      emit({ contended: true });
      return;
    }
    const backoffMs = STALL_RECOVERY_DELAY_MS * 2 ** recoveryAttempts;
    recoveryAttempts += 1;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      void transition();
    }, backoffMs);
  }

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
    const changedTrack = snapshot.loadedTrackIndex !== position.trackIndex;
    try {
      if (changedTrack) {
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

      if (player.getState() === 'playing') {
        player.seekTo(current.offsetMs);
        lastSeekAtPerf = perfNow();
      } else if (snapshot.tunedIn) {
        // Seeking a track that has not started is dropped, so wait for
        // playback and let the state change above place the needle. A track
        // change already started itself; calling play() on top of that only
        // produces pause/play churn.
        awaitingFirstPlay = true;
        if (!changedTrack) player.play();
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
      attemptRecovery();
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

    // Surviving a whole poll interval still playing means the audio is really
    // ours. Anything earlier is indistinguishable from winning one round of a
    // fight we are about to lose again.
    if (playerState === 'playing') {
      recoveryAttempts = 0;
      if (snapshot.contended) emit({ contended: false });
    }

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
    tuneIn() {
      if (stopped) return Promise.resolve();

      // Synchronous, before any await. Mobile browsers only unlock playback
      // from inside the gesture that asked for it, and an awaited load in
      // between means the tap no longer counts. This may sound the wrong
      // track for a moment; the transition below corrects it immediately.
      player.play();
      emit({ tunedIn: true });

      const positioned = transition();
      if (driftTimer === null) {
        driftTimer = setInterval(() => {
          void checkDrift();
        }, DRIFT_CHECK_INTERVAL_MS);
      }
      return positioned;
    },
    tuneOut() {
      if (stopped) return;
      player.pause();
      if (driftTimer !== null) clearInterval(driftTimer);
      if (boundaryTimer !== null) clearTimeout(boundaryTimer);
      if (postSeekTimer !== null) clearTimeout(postSeekTimer);
      if (recoveryTimer !== null) clearTimeout(recoveryTimer);
      driftTimer = null;
      boundaryTimer = null;
      postSeekTimer = null;
      recoveryTimer = null;
      recoveryAttempts = 0;
      emit({ tunedIn: false, driftMs: null, actualMs: null, contended: false });
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
