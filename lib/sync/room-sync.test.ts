import { describe, expect, it, vi } from 'vitest';
import type { LoadOutcome, PlayerState, RoomPlayer } from '../player/types';
import { FIXTURE_TRACKS } from '../fixtures/tracks';
import { positionAt } from '../schedule';
import {
  DRIFT_CHECK_INTERVAL_MS,
  MAX_SEEK_LATENCY_MS,
  MAX_STALL_RECOVERY_ATTEMPTS,
  MAX_TRANSITION_LEAD_MS,
  SEEK_COMPENSATION_MARGIN_MS,
} from '../config/sync';
import {
  compensatedSeekTarget,
  createRoomSync,
  nextSeekLatency,
  nextTransitionLead,
  shouldCorrect,
} from './room-sync';

const CRAWFISH = FIXTURE_TRACKS[0]!;
const WILL_HE = FIXTURE_TRACKS[1]!;
const EPOCH = 1_700_000_000_000;

describe('shouldCorrect', () => {
  const base = { driftMs: 5_000, playerState: 'playing' as PlayerState, msSinceSeek: 60_000 };

  it('corrects a large drift in either direction', () => {
    expect(shouldCorrect(base)).toBe(true);
    expect(shouldCorrect({ ...base, driftMs: -5_000 })).toBe(true);
  });

  it('leaves small drift alone, since the correction is more audible', () => {
    expect(shouldCorrect({ ...base, driftMs: 900 })).toBe(false);
    expect(shouldCorrect({ ...base, driftMs: -900 })).toBe(false);
  });

  it('does not correct exactly at the threshold', () => {
    expect(shouldCorrect({ ...base, driftMs: 1_500 })).toBe(false);
    expect(shouldCorrect({ ...base, driftMs: 1_501 })).toBe(true);
  });

  // A reading taken while buffering says nothing about drift, and seeking on
  // it turns a stall into a seek/stall loop.
  it('refuses to correct unless the player is actually playing', () => {
    for (const playerState of ['idle', 'loading', 'ready', 'stalled', 'unavailable'] as const) {
      expect(shouldCorrect({ ...base, playerState })).toBe(false);
    }
  });

  it('refuses to correct on a missing position reading', () => {
    expect(shouldCorrect({ ...base, driftMs: Number.NaN })).toBe(false);
  });

  it('waits for a previous seek to land before judging the next one', () => {
    expect(shouldCorrect({ ...base, msSinceSeek: 0 })).toBe(false);
    expect(shouldCorrect({ ...base, msSinceSeek: 1_499 })).toBe(false);
    expect(shouldCorrect({ ...base, msSinceSeek: 1_501 })).toBe(true);
  });
});

describe('nextSeekLatency', () => {
  // The feedback loop: what we would observe is `estimate - trueLatency`.
  it('converges on the true latency', () => {
    const TRUE_LATENCY = 750;
    let estimate = 0;
    for (let i = 0; i < 25; i++) {
      estimate = nextSeekLatency(estimate, estimate - TRUE_LATENCY);
    }
    expect(estimate).toBeCloseTo(TRUE_LATENCY, 0);
  });

  // The mistake this formulation exists to avoid. Sampling `-drift` would work
  // exactly once: as soon as compensation landed on target, drift would read
  // zero and the estimate would decay away with it, undoing itself.
  it('holds once converged rather than decaying back to zero', () => {
    let estimate = 750;
    for (let i = 0; i < 25; i++) estimate = nextSeekLatency(estimate, 0);
    expect(estimate).toBe(750);
  });

  it('comes back down when seeks start landing early', () => {
    expect(nextSeekLatency(1_000, 400)).toBeLessThan(1_000);
  });

  it('refuses to go negative — a seek cannot land before it was asked for', () => {
    expect(nextSeekLatency(0, 5_000)).toBe(0);
  });

  it('is capped, because a huge reading is something else broken', () => {
    expect(nextSeekLatency(0, -1_000_000)).toBe(MAX_SEEK_LATENCY_MS);
  });

  it('ignores a missing reading rather than treating it as zero drift', () => {
    expect(nextSeekLatency(750, Number.NaN)).toBe(750);
  });
});

describe('nextTransitionLead', () => {
  it('follows how long transitions are actually taking', () => {
    let lead = 0;
    for (let i = 0; i < 25; i++) lead = nextTransitionLead(lead, 900);
    expect(lead).toBeCloseTo(900, 0);
  });

  it('is capped — anything longer than that is a stall, not a handover', () => {
    expect(nextTransitionLead(0, 60_000)).toBe(MAX_TRANSITION_LEAD_MS);
  });

  it('ignores impossible observations', () => {
    expect(nextTransitionLead(900, -50)).toBe(900);
    expect(nextTransitionLead(900, Number.NaN)).toBe(900);
  });
});

describe('compensatedSeekTarget', () => {
  it('aims ahead by however late seeks have been landing', () => {
    expect(compensatedSeekTarget(30_000, 750, 200_000)).toBe(30_750);
  });

  it('changes nothing when seeks land instantly', () => {
    expect(compensatedSeekTarget(30_000, 0, 200_000)).toBe(30_000);
  });

  // Overshooting the end of a track lands nowhere, and a transition that close
  // is the boundary timer's job.
  it('never aims into the last moments of a track', () => {
    const duration = 100_000;
    expect(compensatedSeekTarget(99_000, 2_000, duration)).toBe(
      duration - SEEK_COMPENSATION_MARGIN_MS,
    );
  });

  it('never aims backwards, even past the margin', () => {
    expect(compensatedSeekTarget(99_900, 2_000, 100_000)).toBe(99_900);
  });

  it('never aims before the start', () => {
    expect(compensatedSeekTarget(0, 0, 100_000)).toBe(0);
  });
});

/** Records what the sync loop asked the player to do. */
function fakePlayer(overrides: Partial<RoomPlayer> = {}) {
  const calls = {
    loaded: [] as string[],
    seeks: [] as number[],
    plays: 0,
    sequence: [] as string[],
  };
  const listeners = new Set<(next: PlayerState) => void>();
  let state: PlayerState = 'ready';

  const setState = (next: PlayerState) => {
    state = next;
    for (const listener of listeners) listener(next);
  };

  // Mirrors the real adapter: whatever was last loaded is what it reports.
  let loadedUrl: string | null = null;

  const player: RoomPlayer = {
    load: (url) => {
      calls.loaded.push(url);
      loadedUrl = url;
      return Promise.resolve('ready' as LoadOutcome);
    },
    getLoadedUrl: () => loadedUrl,
    // Mirrors the real widget: playback begins, and the state change is what
    // tells the sync loop it is finally safe to seek.
    play: () => {
      calls.plays += 1;
      calls.sequence.push('play');
      setState('playing');
    },
    pause: () => setState('ready'),
    seekTo: (ms) => {
      calls.seeks.push(ms);
      calls.sequence.push('seek');
    },
    getPosition: () => Promise.resolve(0),
    getState: () => state,
    onStateChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy: () => {},
    ...overrides,
  };
  return { player, calls, setState };
}

describe('createRoomSync', () => {
  it('joins mid-track: loads the right track and seeks to the right offset', async () => {
    const { player, calls } = fakePlayer();
    // 40s into the second track.
    const now = EPOCH + CRAWFISH.durationMs + 40_000;

    const sync = createRoomSync({
      player,
      tracks: FIXTURE_TRACKS,
      epochMs: EPOCH,
      serverNow: () => now,
      onChange: () => {},
      perfNow: () => 0,
    });

    await sync.tuneIn();
    sync.stop();

    expect(calls.loaded).toEqual([WILL_HE.url]);
    expect(calls.seeks).toEqual([40_000]);
    expect(calls.plays).toBe(1);
  });

  // The widget silently drops a seek on a track that has never played, so a
  // join that seeks first lands at zero and plays the wrong part of the song.
  it('plays before seeking on a fresh track', async () => {
    const { player, calls } = fakePlayer();
    const sync = createRoomSync({
      player,
      tracks: FIXTURE_TRACKS,
      epochMs: EPOCH,
      serverNow: () => EPOCH + 30_000,
      onChange: () => {},
      perfNow: () => 0,
    });

    await sync.tuneIn();
    sync.stop();

    expect(calls.sequence).toEqual(['play', 'seek']);
    expect(calls.seeks).toEqual([30_000]);
  });

  // At a boundary the skip starts the new track itself. If the player is
  // already playing by the time load() returns, the loop must seek at once
  // rather than waiting for a state change that has already happened —
  // otherwise the opening of the new track is audible before it is corrected.
  it('seeks immediately when a track change is already playing', async () => {
    const base = fakePlayer();
    const { calls, setState } = base;
    const player = {
      ...base.player,
      load: (url: string) => {
        calls.loaded.push(url);
        setState('playing'); // as skip() does
        return Promise.resolve('ready' as LoadOutcome);
      },
    };

    const sync = createRoomSync({
      player,
      tracks: FIXTURE_TRACKS,
      epochMs: EPOCH,
      serverNow: () => EPOCH + CRAWFISH.durationMs + 1_200,
      onChange: () => {},
      perfNow: () => 0,
    });

    await sync.tuneIn();
    sync.stop();

    expect(calls.loaded).toEqual([WILL_HE.url]);
    expect(calls.seeks).toEqual([1_200]);
    // No second play(): the skip already started it. tuneIn's own unlocking
    // play() is the only one.
    expect(calls.plays).toBe(1);
  });

  it('starts at the top of the playlist at the epoch itself', async () => {
    const { player, calls } = fakePlayer();
    const sync = createRoomSync({
      player,
      tracks: FIXTURE_TRACKS,
      epochMs: EPOCH,
      serverNow: () => EPOCH,
      onChange: () => {},
      perfNow: () => 0,
    });

    await sync.tuneIn();
    sync.stop();

    expect(calls.loaded).toEqual([CRAWFISH.url]);
    expect(calls.seeks).toEqual([0]);
  });

  it('reports an unavailable track instead of retrying it', async () => {
    const load = vi.fn(() => Promise.resolve('unavailable' as LoadOutcome));
    const { player } = fakePlayer({ load });
    const sync = createRoomSync({
      player,
      tracks: FIXTURE_TRACKS,
      epochMs: EPOCH,
      serverNow: () => EPOCH,
      onChange: () => {},
      perfNow: () => 0,
    });

    await sync.tuneIn();
    const snapshot = sync.getSnapshot();
    sync.stop();

    expect(load).toHaveBeenCalledTimes(1);
    expect(snapshot.unavailable).toBe(true);
    expect(snapshot.loadedTrackIndex).toBe(0);
  });

  // shouldCorrect refuses to seek on a reading taken mid-stall, which is
  // right. On its own it would also mean a stalled client sits frozen while
  // drift grows without bound, so the loop has to treat a stall as its own
  // recoverable condition.
  it('recovers from a stall instead of watching drift grow', async () => {
    vi.useFakeTimers();
    try {
      const { player, calls, setState } = fakePlayer();
      const sync = createRoomSync({
        player,
        tracks: FIXTURE_TRACKS,
        epochMs: EPOCH,
        serverNow: () => EPOCH + 30_000,
        onChange: () => {},
        perfNow: () => 0,
      });

      await sync.tuneIn();
      const playsBefore = calls.plays;

      setState('stalled');
      await vi.advanceTimersByTimeAsync(DRIFT_CHECK_INTERVAL_MS + 50);
      sync.stop();

      expect(calls.plays).toBeGreaterThan(playsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops listening on tune out without stopping the schedule', async () => {
    const { player, calls, setState } = fakePlayer();
    let now = EPOCH + 30_000;
    const sync = createRoomSync({
      player,
      tracks: FIXTURE_TRACKS,
      epochMs: EPOCH,
      serverNow: () => now,
      onChange: () => {},
      perfNow: () => 0,
    });

    await sync.tuneIn();
    sync.tuneOut();
    expect(sync.getSnapshot().tunedIn).toBe(false);

    // Time passes while tuned out. Tuning back in rejoins the room live
    // rather than resuming where the listener left.
    now = EPOCH + 90_000;
    setState('ready');
    await sync.tuneIn();
    sync.stop();

    expect(calls.seeks.at(-1)).toBe(90_000);
  });

  // The widget only lets one instance play per browser, so a second tab of the
  // same room preempts the first. Retrying forever turns that into a fight in
  // which each tab steals the audio back: measured 28 corrections in a window
  // that should have needed none.
  it('gives up rather than fighting whatever holds the audio', async () => {
    vi.useFakeTimers();
    try {
      const base = fakePlayer();
      const { calls, setState } = base;
      // Playback is taken away the instant it is asked for, so the player
      // never reaches 'playing' and the attempt budget is never refunded.
      const player = { ...base.player, play: () => void (calls.plays += 1) };

      const sync = createRoomSync({
        player,
        tracks: FIXTURE_TRACKS,
        epochMs: EPOCH,
        serverNow: () => EPOCH + 30_000,
        onChange: () => {},
        perfNow: () => 0,
      });

      await sync.tuneIn();
      const playsAfterJoin = calls.plays;

      setState('stalled');
      await vi.advanceTimersByTimeAsync(DRIFT_CHECK_INTERVAL_MS * 10);
      sync.stop();

      expect(sync.getSnapshot().contended).toBe(true);
      expect(calls.plays - playsAfterJoin).toBeLessThanOrEqual(MAX_STALL_RECOVERY_ATTEMPTS);
    } finally {
      vi.useRealTimers();
    }
  });

  // End to end: a reading that says we are behind should both teach the loop
  // how late seeks land AND have the resulting correction already aim ahead.
  it('corrects using the latency it just learned', async () => {
    vi.useFakeTimers();
    try {
      let perf = 0;
      const base = fakePlayer();
      const { calls } = base;
      // Playing 5s behind where the schedule says we should be.
      const player = { ...base.player, getPosition: () => Promise.resolve(25_000) };

      const sync = createRoomSync({
        player,
        tracks: FIXTURE_TRACKS,
        epochMs: EPOCH,
        serverNow: () => EPOCH + 30_000,
        onChange: () => {},
        perfNow: () => perf,
      });

      await sync.tuneIn();
      perf = 100_000; // long enough after the join seek for a settled reading
      await vi.advanceTimersByTimeAsync(DRIFT_CHECK_INTERVAL_MS + 50);
      const snapshot = sync.getSnapshot();
      sync.stop();

      expect(snapshot.seekLatencyMs).toBeGreaterThan(0);
      // The correction aims past the target by exactly what it just learned.
      expect(calls.seeks.at(-1)).toBe(30_000 + snapshot.seekLatencyMs);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The seam. A boundary hands over to a track that should begin at zero, so
   * seeking into it is both unnecessary and audible — it was the second of
   * three pauses reported at a track change. A join is different and must
   * still seek; the tests above cover that.
   */
  it('hands over at a boundary without seeking', async () => {
    vi.useFakeTimers();
    try {
      let perf = 0;
      let now = EPOCH + 30_000; // mid first track
      const base = fakePlayer();
      const { calls } = base;
      // A player that is where the schedule says it should be — i.e. the lead
      // was right. Otherwise the post-transition check correctly fires a
      // correction and we would be testing desync, not the handover.
      const player = {
        ...base.player,
        getPosition: () => {
          const at = positionAt(FIXTURE_TRACKS, EPOCH, now);
          return Promise.resolve(at.kind === 'playing' ? at.offsetMs : 0);
        },
      };

      const sync = createRoomSync({
        player,
        tracks: FIXTURE_TRACKS,
        epochMs: EPOCH,
        serverNow: () => now,
        onChange: () => {},
        perfNow: () => perf,
      });

      await sync.tuneIn();
      expect(calls.loaded).toEqual([CRAWFISH.url]);
      const seeksAfterJoining = calls.seeks.length;
      expect(seeksAfterJoining).toBeGreaterThan(0); // a join does seek

      // Cross into the next track.
      now = EPOCH + CRAWFISH.durationMs + 400;
      perf = 100_000;
      await vi.advanceTimersByTimeAsync(DRIFT_CHECK_INTERVAL_MS + 50);
      sync.stop();

      expect(calls.loaded).toEqual([CRAWFISH.url, WILL_HE.url]);
      expect(calls.seeks.length).toBe(seeksAfterJoining);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * A set player advances by itself when a track ends, so the loop can find
   * itself on a song the schedule never named — observed live, playing a track
   * that had been added to the set after the schedule was frozen. Seeking
   * cannot fix being on the wrong song; it has to go and fetch the right one.
   */
  it('recovers when the player wanders onto a track nobody asked for', async () => {
    vi.useFakeTimers();
    try {
      let perf = 0;
      const base = fakePlayer();
      const { calls } = base;
      let wandered = false;
      const player = {
        ...base.player,
        // Reports something entirely outside the schedule, as a set advance does.
        getLoadedUrl: () => (wandered ? 'https://soundcloud.com/someone/test-pilot' : base.player.getLoadedUrl()),
      };

      const sync = createRoomSync({
        player,
        tracks: FIXTURE_TRACKS,
        epochMs: EPOCH,
        serverNow: () => EPOCH + 30_000,
        onChange: () => {},
        perfNow: () => perf,
      });

      await sync.tuneIn();
      const loadsAfterJoining = calls.loaded.length;

      wandered = true;
      perf = 100_000;
      await vi.advanceTimersByTimeAsync(DRIFT_CHECK_INTERVAL_MS + 50);
      sync.stop();

      // It went back for the track the schedule actually names.
      expect(calls.loaded.length).toBeGreaterThan(loadsAfterJoining);
      expect(calls.loaded.at(-1)).toBe(CRAWFISH.url);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing at all with an empty playlist', async () => {
    const { player, calls } = fakePlayer();
    const sync = createRoomSync({
      player,
      tracks: [],
      epochMs: EPOCH,
      serverNow: () => EPOCH,
      onChange: () => {},
      perfNow: () => 0,
    });

    await sync.tuneIn();
    sync.stop();

    expect(calls.loaded).toEqual([]);
    expect(calls.seeks).toEqual([]);
  });
});
