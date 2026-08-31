'use client';

/**
 * Step 5 + 6 harness — presence, avatars, and hearts.
 *
 * Deliberately has no audio. The widget only lets one instance per browser
 * make sound, which would make a multi-tab test unreadable for reasons that
 * have nothing to do with presence or reactions. What is playing is computed
 * from the schedule, which is all favouriting needs to know.
 *
 * ?room=<slug>  use a room other than "main".
 * ?as=<name>    act as a distinct, unsaved listener. Tabs in one browser share
 *               localStorage and so share an id — which is the right
 *               behaviour, since one person in two tabs should be one
 *               listener, but it makes a multi-tab test impossible without it.
 */

import { AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/avatar';
import { HeartBurst } from '@/components/heart-burst';
import { fetchActiveSchedule, type LiveSchedule } from '@/lib/db/schedules';
import { castVote, fetchVoteTallies, type TrackVotes, type VoteOutcome } from '@/lib/votes/votes';
import {
  deterministicUuid,
  loadListener,
  normalizeNickname,
  saveListener,
  type Listener,
} from '@/lib/identity';
import { jitter } from '@/lib/motion';
import { DEFAULT_ROOM_SLUG } from '@/lib/rooms';
import { useRoomChannel } from '@/lib/presence/use-room-channel';
import { positionAt, type Track } from '@/lib/schedule';
import { measureServerClock, serverNowFrom, type ClockOffset } from '@/lib/time/server-clock';

const NOW_PLAYING_POLL_MS = 1_000;

export default function RoomHarness() {
  const clockRef = useRef<ClockOffset | null>(null);
  const [clockReady, setClockReady] = useState(false);
  const [listener, setListener] = useState<Listener | null>(null);
  const [roomSlug, setRoomSlug] = useState(DEFAULT_ROOM_SLUG);
  const [draftNickname, setDraftNickname] = useState('');
  const [schedule, setSchedule] = useState<LiveSchedule | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [tallies, setTallies] = useState<Map<string, TrackVotes>>(new Map());
  const [outcome, setOutcome] = useState<VoteOutcome | null>(null);
  const [isDebugListener, setIsDebugListener] = useState(false);

  // serverNow, so arrival order agrees between clients with wrong clocks.
  const now = useCallback(() => {
    const offset = clockRef.current;
    return offset === null ? Number.NaN : serverNowFrom(offset, performance.now());
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('room') ?? DEFAULT_ROOM_SLUG;
    setRoomSlug(slug);

    const actAs = params.get('as');
    const loaded: Listener =
      actAs === null || actAs.length === 0
        ? loadListener()
        : // Not saved: a debug listener should not displace the real one. The
          // id must still be a real UUID, since listener_id is a uuid column.
          { id: deterministicUuid(`debug:${actAs}`), nickname: actAs };
    setIsDebugListener(actAs !== null && actAs.length > 0);
    setListener(loaded);
    setDraftNickname(loaded.nickname);

    let cancelled = false;
    void (async () => {
      const offset = await measureServerClock();
      if (cancelled || offset === null) return;
      clockRef.current = offset;
      setClockReady(true);

      const live = await fetchActiveSchedule(slug).catch(() => null);
      if (cancelled || live === null) return;
      setSchedule(live);
      setTallies(await fetchVoteTallies(live.roomId));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { listeners, status, hearts, sendHeart, announceNickname } = useRoomChannel({
    roomSlug,
    listener: clockReady ? listener : null,
    now,
  });

  // What the schedule says is playing. No player, no audio — favouriting only
  // needs to know which track, not to hear it.
  useEffect(() => {
    if (schedule === null) return;
    const tick = () => {
      const position = positionAt(schedule.tracks, schedule.epochMs, now());
      setTrack(position.kind === 'playing' ? position.track : null);
    };
    tick();
    const timer = setInterval(tick, NOW_PLAYING_POLL_MS);
    return () => clearInterval(timer);
  }, [schedule, now]);

  const throwHeart = useCallback(() => {
    if (track === null || schedule === null || listener === null) return;

    // Burst first. The row is a bonus; the gesture is the point.
    sendHeart(track.url);

    void castVote({
      roomId: schedule.roomId,
      trackUrl: track.url,
      listenerId: listener.id,
      direction: 1,
    }).then((result: VoteOutcome) => {
      setOutcome(result);
      if (result !== 'saved') return;
      setTallies((previous) => {
        const next = new Map(previous);
        const tally = { ...(next.get(track.url) ?? { up: 0, down: 0 }) };
        tally.up += 1;
        next.set(track.url, tally);
        return next;
      });
    });
  }, [listener, schedule, sendHeart, track]);

  const rename = useCallback(() => {
    const nickname = normalizeNickname(draftNickname);
    if (listener === null || nickname.length === 0 || nickname === listener.nickname) return;
    const updated = { ...listener, nickname };
    setListener(updated);
    if (!isDebugListener) saveListener(updated);
    announceNickname(nickname);
  }, [announceNickname, draftNickname, isDebugListener, listener]);

  return (
    <main>
      <h1>Room harness</h1>
      <p>
        room <code>{roomSlug}</code> — <strong>{status}</strong> — {listeners.length} listener(s)
      </p>

      <h2>Now playing</h2>
      <p>
        {track === null ? (
          <em>nothing — is the room seeded?</em>
        ) : (
          <>
            <strong>{track.artist}</strong> — {track.title} — liked{' '}
            {tallies.get(track.url)?.up ?? 0}×
          </>
        )}
      </p>

      {/* Bursts are positioned against this box, so they rise out of the room. */}
      <div style={{ position: 'relative', minHeight: '9rem', paddingTop: '5.5rem' }}>
        <AnimatePresence initial={false}>
          {hearts.map((heart) => (
            <HeartBurst key={heart.id} id={heart.id} origin={jitter(heart.listenerId, 0.8) + 0.1} />
          ))}
        </AnimatePresence>

        <ul
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            gap: '1.1rem',
            padding: 0,
            margin: 0,
          }}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {listeners.map((present) => (
              <Avatar
                key={present.id}
                id={present.id}
                nickname={present.nickname}
                isSelf={present.id === listener?.id}
              />
            ))}
          </AnimatePresence>
        </ul>
      </div>

      <p>
        <button type="button" onClick={throwHeart} disabled={track === null}>
          ♥ Favourite
        </button>{' '}
        {outcome === null ? null : (
          <small>
            {outcome === 'saved' && 'saved'}
            {outcome === 'unchanged' && 'already yours — burst sent anyway'}
            {outcome === 'failed' && 'not saved (the burst still happened)'}
          </small>
        )}
      </p>
      <p>
        <small>
          The heart is instant and never waits on the database. Tapping again re-throws the
          burst without writing a second row — a favourite is a fact, not an event.
        </small>
      </p>

      <h2>You</h2>
      <p>
        <input
          value={draftNickname}
          onChange={(event) => setDraftNickname(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') rename();
          }}
          aria-label="nickname"
          maxLength={24}
        />{' '}
        <button type="button" onClick={rename}>
          Rename
        </button>
      </p>
      <p>
        <small>
          Renaming keeps your place in the room — arrival order is fixed at join, not at
          rename. Presence is keyed on your id, so a second tab does not make you two
          listeners.
        </small>
      </p>
    </main>
  );
}
