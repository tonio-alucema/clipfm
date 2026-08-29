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
import {
  favoriteTrack,
  fetchFavoriteCounts,
  fetchMyFavorites,
} from '../favorites/favorites';
import {
  deterministicUuid,
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
  const [track, setTrack] = useState<Track | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [mine, setMine] = useState<Set<string>>(new Set());

  const serverNow = useCallback(() => {
    const offset = clockRef.current;
    return offset === null ? Number.NaN : serverNowFrom(offset, performance.now());
  }, []);

  // Identity, clock, schedule.
  useEffect(() => {
    let cancelled = false;

    // ?as= gives a browser a second identity. Not a product feature — it is
    // the only way to have more than one listener per browser, since presence
    // is keyed on an id that lives in localStorage.
    const actAs = new URLSearchParams(window.location.search).get('as');
    const loaded: Listener =
      actAs === null || actAs.length === 0
        ? loadListener()
        : { id: deterministicUuid(`debug:${actAs}`), nickname: actAs };
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

      const [allCounts, myFavorites] = await Promise.all([
        fetchFavoriteCounts(live.roomId),
        fetchMyFavorites(live.roomId, loaded.id),
      ]);
      if (cancelled) return;
      setCounts(allCounts);
      setMine(myFavorites);
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
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
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

  const throwHeart = useCallback(() => {
    if (track === null || schedule === null || listener === null) return;

    // The burst first, always. The row is a consequence of the gesture, never
    // a precondition for it.
    sendHeart(track.url);
    if (mine.has(track.url)) return;

    void favoriteTrack({
      roomId: schedule.roomId,
      trackUrl: track.url,
      listenerId: listener.id,
    }).then((outcome) => {
      if (outcome === 'failed') return;
      setMine((previous) => new Set(previous).add(track.url));
      if (outcome === 'saved') {
        setCounts((previous) => new Map(previous).set(track.url, (previous.get(track.url) ?? 0) + 1));
      }
    });
  }, [listener, mine, schedule, sendHeart, track]);

  const setNickname = useCallback(
    (raw: string) => {
      const nickname = normalizeNickname(raw);
      if (listener === null || nickname.length === 0 || nickname === listener.nickname) return;
      const updated = { ...listener, nickname };
      setListener(updated);
      if (!raw.startsWith('debug:')) saveListener(updated);
      announceNickname(nickname);
    },
    [announceNickname, listener],
  );

  return {
    phase,
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

    favoriteCount: track === null ? 0 : (counts.get(track.url) ?? 0),
    hasFavorited: track !== null && mine.has(track.url),

    iframeRef,
    tuneIn: useCallback(() => void syncRef.current?.tuneIn(), []),
    tuneOut: useCallback(() => syncRef.current?.tuneOut(), []),
    throwHeart,
    setNickname,
  };
}
