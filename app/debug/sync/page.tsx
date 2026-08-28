'use client';

/**
 * Step 3 harness — the phase's real deliverable.
 *
 * Shows target position, actual position, and drift, so several browsers can
 * be put side by side and compared.
 *
 * Query overrides:
 *   ?epoch=<ms>  absolute epoch. Use this for multi-tab tests — every tab must
 *                be given the same value or the comparison is meaningless.
 *   ?at=<ms>     position into the playlist at load. Convenient for reaching a
 *                boundary quickly, but SOLO ONLY: each tab would derive a
 *                different epoch from its own load time.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DRIFT_PASS_BAR_MS, CLOCK_RESYNC_INTERVAL_MS } from '@/lib/config/sync';
import { FIXTURE_EPOCH_MS, FIXTURE_TRACKS } from '@/lib/fixtures/tracks';
import { createSoundCloudPlayer } from '@/lib/player/soundcloud';
import type { RoomPlayer } from '@/lib/player/types';
import { widgetIframeSrc } from '@/lib/player/widget-api';
import { positionAt, totalDurationMs } from '@/lib/schedule';
import { createRoomSync, INITIAL_SNAPSHOT, type SyncSnapshot } from '@/lib/sync/room-sync';
import {
  measureServerClock,
  serverNowFrom,
  type ClockOffset,
} from '@/lib/time/server-clock';

/** How often the readout refreshes. Unrelated to how often drift is corrected. */
const DISPLAY_POLL_MS = 500;

const ms = (value: number | null) =>
  value === null || !Number.isFinite(value) ? '—' : `${Math.round(value)} ms`;

export default function SyncHarness() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<RoomPlayer | null>(null);
  const syncRef = useRef<ReturnType<typeof createRoomSync> | null>(null);
  const clockRef = useRef<ClockOffset | null>(null);

  const [clock, setClock] = useState<ClockOffset | null>(null);
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(INITIAL_SNAPSHOT);
  const [epochMs, setEpochMs] = useState<number | null>(null);
  const [liveTargetMs, setLiveTargetMs] = useState<number | null>(null);
  const [liveActualMs, setLiveActualMs] = useState<number | null>(null);
  const [liveTrack, setLiveTrack] = useState<string>('—');
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const serverNow = useCallback(() => {
    const offset = clockRef.current;
    // Before the first measurement there is no answer we are entitled to give.
    return offset === null ? Number.NaN : serverNowFrom(offset, performance.now());
  }, []);

  // Measure the clock, then resolve the epoch. Both must settle before the
  // sync loop can be built.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const offset = await measureServerClock();
      if (cancelled) return;
      if (offset === null) {
        setError('Could not reach /api/time. Sync cannot start without a server clock.');
        return;
      }
      clockRef.current = offset;
      setClock(offset);

      const params = new URLSearchParams(window.location.search);
      const epochParam = Number(params.get('epoch'));
      const atParam = Number(params.get('at'));
      if (Number.isFinite(epochParam) && params.get('epoch') !== null) {
        setEpochMs(epochParam);
      } else if (Number.isFinite(atParam) && params.get('at') !== null) {
        setEpochMs(serverNowFrom(offset, performance.now()) - atParam);
      } else {
        setEpochMs(FIXTURE_EPOCH_MS);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Re-measure periodically and whenever the tab comes back. A single reading
  // at mount goes stale across a sleep, a network change, or an NTP correction.
  useEffect(() => {
    const resync = () => {
      void measureServerClock().then((offset) => {
        if (offset !== null) {
          clockRef.current = offset;
          setClock(offset);
        }
      });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') resync();
    };
    const timer = setInterval(resync, CLOCK_RESYNC_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Build the player and the sync loop once the epoch is known.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe === null || epochMs === null) return;

    let cancelled = false;
    let player: RoomPlayer | null = null;
    let sync: ReturnType<typeof createRoomSync> | null = null;

    void createSoundCloudPlayer(iframe, {
      onWidgetEvent: (name) => {
        // playProgress fires constantly and would bury everything else.
        if (name === 'playProgress' || name === 'loadProgress') return;
        setLog((previous) => [name, ...previous].slice(0, 25));
      },
    })
      .then((created) => {
        if (cancelled) {
          created.destroy();
          return;
        }
        player = created;
        playerRef.current = created;
        sync = createRoomSync({
          player: created,
          tracks: FIXTURE_TRACKS,
          epochMs,
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
  }, [epochMs, serverNow]);

  // Readout only. Never corrects anything.
  useEffect(() => {
    if (epochMs === null) return;
    const timer = setInterval(() => {
      const now = serverNow();
      if (!Number.isFinite(now)) return;
      const position = positionAt(FIXTURE_TRACKS, epochMs, now);
      setLiveTargetMs(position.kind === 'playing' ? position.offsetMs : null);
      setLiveTrack(
        position.kind === 'playing'
          ? `#${position.trackIndex} ${position.track.artist} — ${position.track.title}`
          : '—',
      );
      void playerRef.current?.getPosition().then((actual) => {
        setLiveActualMs(Number.isFinite(actual) ? actual : null);
      });
    }, DISPLAY_POLL_MS);
    return () => clearInterval(timer);
  }, [epochMs, serverNow]);

  const liveDriftMs =
    liveTargetMs === null || liveActualMs === null ? null : liveActualMs - liveTargetMs;
  const withinBar = liveDriftMs !== null && Math.abs(liveDriftMs) <= DRIFT_PASS_BAR_MS;
  const track = snapshot.position?.kind === 'playing' ? snapshot.position.track : null;

  return (
    <main>
      <h1>Sync harness</h1>

      {error !== null && <p role="alert">{error}</p>}

      <p>
        <button type="button" onClick={() => void syncRef.current?.tuneIn()}>
          Tune in
        </button>{' '}
        {snapshot.tunedIn ? 'tuned in' : 'not tuned in'} — player:{' '}
        <strong>{snapshot.playerState}</strong>
        {snapshot.unavailable && ' — TRACK UNAVAILABLE'}
      </p>

      <h2>Drift</h2>
      <p>
        <strong style={{ fontSize: '2rem' }}>{ms(liveDriftMs)}</strong>{' '}
        {liveDriftMs === null ? '' : withinBar ? `within ±${DRIFT_PASS_BAR_MS}ms` : 'OUT OF BAND'}
      </p>
      <ul>
        <li>target: {ms(liveTargetMs)}</li>
        <li>actual: {ms(liveActualMs)}</li>
        <li>corrections so far: {snapshot.corrections}</li>
        <li>drift at last check: {ms(snapshot.driftMs)}</li>
      </ul>

      <h2>Schedule</h2>
      <ul>
        {/* Computed straight from the schedule, so tabs can be compared
            before anyone tunes in. */}
        <li>schedule says: {liveTrack}</li>
        <li>player loaded: {track === null ? '—' : `${track.artist} — ${track.title}`}</li>
        <li>epoch: {epochMs ?? '—'}</li>
        <li>revolution: {totalDurationMs(FIXTURE_TRACKS)} ms</li>
      </ul>

      <h2>Clock</h2>
      <ul>
        <li>server offset measured: {clock === null ? 'not yet' : 'yes'}</li>
        <li>round trip: {clock === null ? '—' : ms(clock.rttMs)}</li>
        <li>serverNow: {Number.isFinite(serverNow()) ? Math.round(serverNow()) : '—'}</li>
      </ul>

      <h2>Widget events</h2>
      <ol>
        {log.map((line, index) => (
          <li key={`${line}-${index}`}>
            <code>{line}</code>
          </li>
        ))}
      </ol>

      <iframe
        ref={iframeRef}
        title="SoundCloud player"
        src={widgetIframeSrc(FIXTURE_TRACKS[0]?.url ?? '')}
        allow="autoplay"
        width="100%"
        height="120"
      />
    </main>
  );
}
