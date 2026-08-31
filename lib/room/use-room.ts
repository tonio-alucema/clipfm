'use client';

/**
 * The room, assembled.
 *
 * Everything Phase 0 built, wired together in one place: the server clock, the
 * live schedule, the player and sync loop, presence, hearts, and favourites.
 * The page below this is only responsible for what it looks like.
 *
 * Order matters and is not incidental. The clock must settle before the
 * schedule can be positioned, the schedule must resolve before the player can
 * be pointed at a set, and presence must not announce an arrival time until
 * there is a server clock to measure it against.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchActiveSchedule, type LiveSchedule } from '../db/schedules';
import { suggestTrack, type SuggestionOutcome } from '../suggestions/suggestions';
import {
  castVote,
  fetchMyVotes,
  fetchVoteTallies,
  type TrackVotes,
  type VoteDirection,
} from '../votes/votes';
import {
  loadListener,
  normalizeNickname,
  saveListener,
  type Listener,
} from '../identity';
import { createSoundCloudPlayer, type SoundCloudPlayer } from '../player/soundcloud';
import type { PlayerState } from '../player/types';
import { useRoomChannel } from '../presence/use-room-channel';
import type { HeartBurstEvent } from '../presence/use-room-channel';
import type { PresentListener } from '../presence/presence';
import { positionAt, type Track } from '../schedule';
import { createRoomSync, INITIAL_SNAPSHOT, type SyncSnapshot } from '../sync/room-sync';
import { measureServerClock, serverNowFrom, type ClockOffset } from '../time/server-clock';

/** Drives the progress readout. Not the drift check, which is far slower. */
const POSITION_POLL_MS = 500;

export type RoomPhase =
  /** Measuring the clock and reading the schedule. */
  | 'connecting'
  /** There is a schedule and something to play. */
  | 'ready'
  /** The room exists but has nothing scheduled. */
  | 'empty'
  | 'error';

export function useRoom(roomSlug: string) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<SoundCloudPlayer | null>(null);
  const syncRef = useRef<ReturnType<typeof createRoomSync> | null>(null);
  const clockRef = useRef<ClockOffset | null>(null);

  const [clockReady, setClockReady] = useState(false);
  const [listener, setListener] = useState<Listener | null>(null);
  const [schedule, setSchedule] = useState<LiveSchedule | null>(null);
  const [phase, setPhase] = useState<RoomPhase>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(INITIAL_SNAPSHOT);
  /**
   * The player exists and can be driven. Loading a set and waiting for its
   * manifest to settle takes real time, and tapping before then wastes the
   * gesture — which on mobile is the only thing that unlocks audio at all.
   */
  const [ready, setReady] = useState(false);
  const [track, setTrack] = useState<Track | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [tallies, setTallies] = useState<Map<string, TrackVotes>>(new Map());
  const [myVotes, setMyVotes] = useState<Map<string, VoteDirection>>(new Map());

  const serverNow = useCallback(() => {
    const offset = clockRef.current;
    return offset === null ? Number.NaN : serverNowFrom(offset, performance.now());
  }, []);

  // Identity, clock, schedule.
  useEffect(() => {
    let cancelled = false;

    // One listener per browser, deliberately. The harnesses under /debug take
    // an ?as= override so several identities can share a browser for testing;
    // the room does not, because a query parameter that changes who you are
    // has no business in a page real people use.
    const loaded = loadListener();
    setListener(loaded);

    void (async () => {
      const offset = await measureServerClock();
      if (cancelled) return;
      if (offset === null) {
        setError('Could not reach the clock. Without it nobody can agree on what is playing.');
        setPhase('error');
        return;
      }
      clockRef.current = offset;
      setClockReady(true);

      const live = await fetchActiveSchedule(roomSlug).catch(() => null);
      if (cancelled) return;
      if (live === null || live.tracks.length === 0) {
        setPhase('empty');
        return;
      }
      setSchedule(live);
      setPhase('ready');

      const [allTallies, mine] = await Promise.all([
        fetchVoteTallies(live.roomId),
        fetchMyVotes(live.roomId, loaded.id),
      ]);
      if (cancelled) return;
      setTallies(allTallies);
      setMyVotes(mine);
    })();

    return () => {
      cancelled = true;
    };
  }, [roomSlug]);

  // Re-measure on return: one reading at mount goes stale across a sleep or a
  // network change, and a stale clock silently desyncs the room.
  useEffect(() => {
    const resync = () => {
      void measureServerClock().then((offset) => {
        if (offset !== null) clockRef.current = offset;
      });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') resync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Player and sync, once there is a schedule and an iframe to put it in.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe === null || schedule === null) return;

    let cancelled = false;
    let player: SoundCloudPlayer | null = null;
    let sync: ReturnType<typeof createRoomSync> | null = null;

    void createSoundCloudPlayer(iframe, { setUrl: schedule.setUrl })
      .then((created) => {
        if (cancelled) {
          created.destroy();
          return;
        }
        player = created;
        playerRef.current = created;
        sync = createRoomSync({
          player: created,
          tracks: schedule.tracks,
          epochMs: schedule.epochMs,
          serverNow,
          onChange: setSnapshot,
        });
        syncRef.current = sync;
        setReady(true);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
      setReady(false);
      sync?.stop();
      player?.destroy();
      syncRef.current = null;
      playerRef.current = null;
    };
  }, [schedule, serverNow]);

  // What the schedule says, independent of what the player is doing.
  useEffect(() => {
    if (schedule === null) return;
    const tick = () => {
      const now = serverNow();
      if (!Number.isFinite(now)) return;
      const position = positionAt(schedule.tracks, schedule.epochMs, now);
      if (position.kind !== 'playing') return;
      setTrack(position.track);
      setOffsetMs(position.offsetMs);
    };
    tick();
    const timer = setInterval(tick, POSITION_POLL_MS);
    return () => clearInterval(timer);
  }, [schedule, serverNow]);

  const { listeners, hearts, sendHeart, announceNickname } = useRoomChannel({
    roomSlug,
    listener: clockReady ? listener : null,
    now: serverNow,
  });

  const vote = useCallback(
    (direction: VoteDirection) => {
      if (track === null || schedule === null || listener === null) return;

      const trackUrl = track.url;
      const previous = myVotes.get(trackUrl);
      if (previous === direction) return;

      // The burst first, always. The row is a consequence of the gesture,
      // never a precondition for it.
      if (direction === 1) sendHeart(trackUrl);

      // Optimistic: the tally moves now, and is reconciled by the write only
      // if it fails.
      setMyVotes((current) => new Map(current).set(trackUrl, direction));
      setTallies((current) => {
        const next = new Map(current);
        const tally = { ...(next.get(trackUrl) ?? { up: 0, down: 0 }) };
        if (previous === 1) tally.up -= 1;
        if (previous === -1) tally.down -= 1;
        if (direction === 1) tally.up += 1;
        else tally.down += 1;
        next.set(trackUrl, tally);
        return next;
      });

      void castVote({
        roomId: schedule.roomId,
        trackUrl,
        listenerId: listener.id,
        direction,
      }).then((outcome) => {
        if (outcome !== 'failed') return;
        // Put it back the way it was rather than leaving a number that is not
        // true.
        setMyVotes((current) => {
          const next = new Map(current);
          if (previous === undefined) next.delete(trackUrl);
          else next.set(trackUrl, previous);
          return next;
        });
      });
    },
    [listener, myVotes, schedule, sendHeart, track],
  );

  const suggest = useCallback(
    async (input: string): Promise<SuggestionOutcome> => {
      if (schedule === null || listener === null) return 'failed';
      return suggestTrack({ roomId: schedule.roomId, listenerId: listener.id, input });
    },
    [listener, schedule],
  );

  const setNickname = useCallback(
    (raw: string) => {
      const nickname = normalizeNickname(raw);
      if (listener === null || nickname.length === 0 || nickname === listener.nickname) return;
      const updated = { ...listener, nickname };
      setListener(updated);
      saveListener(updated);
      announceNickname(nickname);
    },
    [announceNickname, listener],
  );

  return {
    phase,
    ready,
    error,
    listener,
    roomName: schedule?.roomName ?? roomSlug,
    setUrl: schedule?.setUrl ?? null,

    tunedIn: snapshot.tunedIn,
    playerState: snapshot.playerState as PlayerState,
    contended: snapshot.contended,
    unavailable: snapshot.unavailable,

    track,
    offsetMs,
    listeners: listeners as PresentListener[],
    hearts: hearts as HeartBurstEvent[],

    votes: track === null ? { up: 0, down: 0 } : (tallies.get(track.url) ?? { up: 0, down: 0 }),
    myVote: track === null ? undefined : myVotes.get(track.url),
    /**
     * What this listener has voted up, newest schedule order. Titles come from
     * the schedule where it knows them; a track voted up under an older
     * schedule is still shown, by its link.
     */
    likedTracks: [...myVotes.entries()]
      .filter(([, direction]) => direction === 1)
      .map(([url]) => ({
        url,
        title: schedule?.tracks.find((candidate) => candidate.url === url)?.title ?? url,
        artist: schedule?.tracks.find((candidate) => candidate.url === url)?.artist ?? null,
      })),

    iframeRef,
    tuneIn: useCallback(() => void syncRef.current?.tuneIn(), []),
    tuneOut: useCallback(() => syncRef.current?.tuneOut(), []),
    vote,
    suggest,
    setNickname,
  };
}
