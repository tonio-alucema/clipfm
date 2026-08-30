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
  BOUNDARY_CORRECTION_THRESHOLD_MS,
  DRIFT_CORRECTION_THRESHOLD_MS,
  JOIN_CORRECTION_THRESHOLD_MS,
  MAX_SEEK_LATENCY_MS,
  MAX_STALL_RECOVERY_ATTEMPTS,
  MAX_TIMER_MS,
  MAX_TRANSITION_LEAD_MS,
  MIN_TRANSITION_LEAD_MS,
  SEEK_COMPENSATION_MARGIN_MS,
  SEEK_LATENCY_SMOOTHING,
  POST_SEEK_CHECK_MS,
  SEEK_SETTLE_MS,
  STALL_RECOVERY_DELAY_MS,
} from '../config/sync';
import type { PlayerState, RoomPlayer } from '../player/types';
import { msUntilBoundary, positionAt, type SchedulePosition, type Track } from '../schedule';
import { normalizeTrackUrl } from '../track-url';

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
  /** How late seeks are currently landing, in ms. Learned, not configured. */
  seekLatencyMs: number;
  /** How early transitions are being started, in ms. Also learned. */
  transitionLeadMs: number;
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
  seekLatencyMs: 0,
  transitionLeadMs: MIN_TRANSITION_LEAD_MS,
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

/**
 * Update the running estimate of how late a seek lands.
 *
 * The sample is `current - drift`, not `-drift`. After a seek, drift equals
 * the shortfall between what we aimed for and what actually happened:
 * `drift = estimate - latency`, so `latency = estimate - drift`. Using
 * `-drift` would work exactly once — as soon as compensation started landing
 * on target, drift would read zero and the estimate would decay back to zero
 * along with it, undoing itself.
 */
export function nextSeekLatency(
  currentMs: number,
  driftMs: number,
  smoothing = SEEK_LATENCY_SMOOTHING,
): number {
  if (!Number.isFinite(driftMs)) return currentMs;
  const sample = currentMs - driftMs;
  const blended = currentMs + (sample - currentMs) * smoothing;
  if (!Number.isFinite(blended)) return currentMs;
  return Math.min(Math.max(blended, 0), MAX_SEEK_LATENCY_MS);
}

/**
 * Where to actually aim, given how late seeks have been landing.
 *
 * Never aims into the last moments of a track: overshooting the end lands
 * nowhere, and a transition that close is the boundary timer's job anyway.
 */
export function compensatedSeekTarget(
  targetMs: number,
  latencyMs: number,
  durationMs: number,
): number {
  const aimed = targetMs + Math.max(0, latencyMs);
  const ceiling = Math.max(0, durationMs - SEEK_COMPENSATION_MARGIN_MS);
  return Math.max(0, Math.min(aimed, Math.max(ceiling, targetMs)));
}

/**
 * How early to start the next transition.
 *
 * Learned the same way as seek latency, and for the same reason: measured from
 * what actually happened rather than from a proxy. Timing the code around the
 * skip measures the wrong thing — it includes confirmation work the listener
 * never hears, so it over-estimates and hands over early. The drift observed
 * after a handover is the honest number: positive means the new track started
 * ahead of the schedule, so lead by that much less next time.
 */
export function nextTransitionLead(
  currentMs: number,
  observedMs: number,
  smoothing = SEEK_LATENCY_SMOOTHING,
): number {
  if (!Number.isFinite(observedMs) || observedMs < 0) return currentMs;
  const blended = currentMs + (observedMs - currentMs) * smoothing;
  if (!Number.isFinite(blended)) return currentMs;
  // Floored, not just capped. A lead of zero hands over exactly as the
  // outgoing track ends, which is the one moment guaranteed to race the set
  // player's own advance.
  return Math.min(Math.max(blended, MIN_TRANSITION_LEAD_MS), MAX_TRANSITION_LEAD_MS);
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
  /**
   * Whether the pending first playback should be seeked into place. True when
   * joining mid-track; false after a track change, where the new track
   * starting at zero is exactly where the schedule wants it.
   */
  let seekWhenPlaybackStarts = true;
  let driftTimer: ReturnType<typeof setInterval> | null = null;
  let boundaryTimer: ReturnType<typeof setTimeout> | null = null;
  let postSeekTimer: ReturnType<typeof setTimeout> | null = null;
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  let recoveryAttempts = 0;
  /** How late seeks have been landing. Learned from what actually happened. */
  let seekLatencyMs = 0;
  /** How long a track change takes, so the next one can be started that early. */
  let transitionLeadMs = MIN_TRANSITION_LEAD_MS;

  /**
   * The only way this loop seeks. Compensation applied in one place so no call
   * site can quietly forget it and reintroduce the lag.
   */
  function seekTo(targetMs: number, durationMs: number): void {
    player.seekTo(compensatedSeekTarget(targetMs, seekLatencyMs, durationMs));
    lastSeekAtPerf = perfNow();
  }

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
    if (seekWhenPlaybackStarts) seekTo(current.offsetMs, current.track.durationMs);
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

    // Start early, so the new track begins at zero when the schedule says it
    // should rather than however long a transition takes afterwards.
    const lead = Math.min(
      Math.max(transitionLeadMs, MIN_TRANSITION_LEAD_MS),
      MAX_TRANSITION_LEAD_MS,
    );
    const delay = Math.min(Math.max(remaining - lead, 0), MAX_TIMER_MS);
    boundaryTimer = setTimeout(() => {
      void transition();
    }, delay);
  }

  /** Bring the player onto whatever track the schedule currently names. */
  async function transition(): Promise<void> {
    if (stopped || busy) return;

    // Joining is not the same as crossing a boundary, and the difference
    // decides everything below. A joiner arrives mid-song and must be placed
    // into it; a boundary hands over to a track that should begin at zero.
    const isJoin = snapshot.loadedTrackIndex === null;

    // The boundary timer fires early, so the schedule may still name the
    // outgoing track. Look ahead by the lead to find the one about to start.
    // A join takes no lookahead: it wants where the room is now.
    const lookaheadMs = isJoin ? 0 : transitionLeadMs;
    const position = positionAt(tracks, epochMs, serverNow() + lookaheadMs);
    if (position.kind === 'empty') {
      emit({ position });
      return;
    }

    busy = true;
    const changedTrack = snapshot.loadedTrackIndex !== position.trackIndex;
    const isBoundary = changedTrack && !isJoin;
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

      if (isBoundary) {
        // The skip started the new track at zero, which — if the lead was
        // right — is exactly where the schedule wants it. Seeking here is the
        // second interruption and a second of the wrong part of the song. The
        // post-transition check below corrects only if the lead was wrong.
        seekWhenPlaybackStarts = false;
        if (snapshot.tunedIn && player.getState() !== 'playing') awaitingFirstPlay = true;
      } else if (player.getState() === 'playing') {
        seekTo(current.offsetMs, current.track.durationMs);
      } else if (snapshot.tunedIn) {
        // Seeking a track that has not started is dropped, so wait for
        // playback and let the state change above place the needle.
        seekWhenPlaybackStarts = true;
        awaitingFirstPlay = true;
        // A track change starts itself; calling play() on top produces churn.
        if (!changedTrack) player.play();
      }

      // Nothing may be audible until someone tunes in. skip() starts playback
      // by itself, so positioning the widget would otherwise have the room
      // playing to a listener who never asked it to.
      if (!snapshot.tunedIn) player.pause();

      emit({
        position: current,
        targetMs: current.offsetMs,
        unavailable: false,
        transitionLeadMs,
      });

      // The seek above lands late by however long loading and seeking took.
      // Check once more with a tight threshold, while the transition still
      // masks a correction.
      if (postSeekTimer !== null) clearTimeout(postSeekTimer);
      postSeekTimer = setTimeout(() => {
        void checkDrift(
          isBoundary ? BOUNDARY_CORRECTION_THRESHOLD_MS : JOIN_CORRECTION_THRESHOLD_MS,
          isBoundary,
        );
      }, POST_SEEK_CHECK_MS);
    } finally {
      busy = false;
      armBoundaryTimer();
    }
  }

  async function checkDrift(
    thresholdMs = DRIFT_CORRECTION_THRESHOLD_MS,
    learnLead = false,
  ): Promise<void> {
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

    // The player can end up on a track nobody asked for — a set advances by
    // itself when one ends. No amount of seeking fixes being on the wrong
    // song, so go and fetch the right one. Forgetting what is loaded makes the
    // next transition treat this as an arrival, which is what it is.
    const loadedUrl = player.getLoadedUrl();
    if (loadedUrl !== null && normalizeTrackUrl(loadedUrl) !== normalizeTrackUrl(current.track.url)) {
      emit({ loadedTrackIndex: null });
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

    // Learn from this reading before deciding what to do about it, so a
    // correction issued now already aims with the freshest estimate. Only a
    // settled reading during real playback says anything about seek latency:
    // mid-stall or mid-seek it is measuring something else entirely.
    const settled = perfNow() - lastSeekAtPerf >= SEEK_SETTLE_MS;
    if (playerState === 'playing' && settled) {
      seekLatencyMs = nextSeekLatency(seekLatencyMs, driftMs);
    }
    // After a handover, the drift is how far the lead overshot. Same
    // self-correcting shape: aim for `lead - drift`.
    if (learnLead && playerState === 'playing') {
      transitionLeadMs = nextTransitionLead(transitionLeadMs, transitionLeadMs - driftMs);
    }

    let { corrections } = snapshot;
    if (
      shouldCorrect({ driftMs, playerState, msSinceSeek: perfNow() - lastSeekAtPerf, thresholdMs })
    ) {
      seekTo(targetMs, current.track.durationMs);
      corrections += 1;
    }

    emit({
      position: current,
      targetMs,
      actualMs: Number.isFinite(actualMs) ? actualMs : null,
      driftMs: Number.isFinite(driftMs) ? driftMs : null,
      playerState,
      corrections,
      seekLatencyMs,
    });
  }

  // Put the widget on the scheduled track immediately, before anyone taps.
  //
  // tuneIn() has to call play() synchronously — on mobile the tap is the only
  // thing that unlocks audio, and an await in between spends it. But whatever
  // the widget happens to be sitting on is what that play() starts, which was
  // the first track of the set: a second of the wrong song, then an audible
  // skip to the right one.
  //
  // Loading here is silent. Nothing plays, because nothing is tuned in yet, so
  // there is no gesture to lose and nothing to hear. By the time the tap
  // arrives the right track is already loaded and play() starts the right
  // music.
  void transition();

  return {
    tuneIn() {
      if (stopped) return Promise.resolve();
      // A fresh attempt gets a fresh budget: whatever stopped playback last
      // time may well be gone, and a listener tapping again is asking us to
      // try properly rather than remember why we gave up.
      recoveryAttempts = 0;
      if (snapshot.contended) emit({ contended: false });

      // Seek and play together, synchronously, inside the gesture.
      //
      // Mobile browsers only unlock playback from inside the tap that asked
      // for it, so no await may come first. Seeking here too means the tap
      // starts at the right place rather than wherever the needle was left —
      // and it replaces a standby loop that re-parked the paused player once
      // a second. That was free on wifi, where a seek costs 30ms, and
      // ruinous on cellular, where one costs two seconds: it issued a new
      // seek before the last had landed, so the widget never settled and
      // tuning in could not get a foothold.
      const current = positionAt(tracks, epochMs, serverNow());
      if (current.kind === 'playing' && current.trackIndex === snapshot.loadedTrackIndex) {
        seekTo(current.offsetMs, current.track.durationMs);
      }
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
      // The latency estimate is kept: tuning back in is the same network.
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
