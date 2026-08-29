'use client';

/**
 * Sync harness.
 *
 * Reads the live schedule from Supabase when the project is configured, and
 * falls back to the frozen fixture otherwise — the readout says which, because
 * "sync works from live data, not constants" is only demonstrated if you can
 * see which one you are looking at.
 *
 * Query overrides:
 *   ?room=<slug>  which room to read. Defaults to "main".
 *   ?epoch=<ms>   absolute epoch. Use for multi-device tests — every device
 *                 must be given the same value or the comparison is meaningless.
 *   ?at=<ms>      position into the playlist at load. SOLO ONLY: each device
 *                 would derive a different epoch from its own load time.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CLOCK_RESYNC_INTERVAL_MS, DRIFT_PASS_BAR_MS } from '@/lib/config/sync';
import { fetchActiveSchedule } from '@/lib/db/schedules';
import { FIXTURE_EPOCH_MS, FIXTURE_SET_URL, FIXTURE_TRACKS } from '@/lib/fixtures/tracks';
import { createSoundCloudPlayer, type SoundCloudPlayer } from '@/lib/player/soundcloud';
import { widgetIframeSrc } from '@/lib/player/widget-api';
import { positionAt, totalDurationMs, type Track } from '@/lib/schedule';
import { createRoomSync, INITIAL_SNAPSHOT, type SyncSnapshot } from '@/lib/sync/room-sync';
import { measureServerClock, serverNowFrom, type ClockOffset } from '@/lib/time/server-clock';

/** How often the readout refreshes. Unrelated to how often drift is corrected. */
const DISPLAY_POLL_MS = 500;

type ResolvedSchedule = {
  source: 'live' | 'fixture';
  label: string;
  setUrl: string;
  tracks: Track[];
  epochMs: number;
};

const ms = (value: number | null) =>
  value === null || !Number.isFinite(value) ? '—' : `${Math.round(value)} ms`;

export default function SyncHarness() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<SoundCloudPlayer | null>(null);
  const syncRef = useRef<ReturnType<typeof createRoomSync> | null>(null);
  const clockRef = useRef<ClockOffset | null>(null);

  const [clock, setClock] = useState<ClockOffset | null>(null);
  const [schedule, setSchedule] = useState<ResolvedSchedule | null>(null);
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(INITIAL_SNAPSHOT);
  const [liveTargetMs, setLiveTargetMs] = useState<number | null>(null);
  const [liveActualMs, setLiveActualMs] = useState<number | null>(null);
  const [liveTrack, setLiveTrack] = useState('—');
  const [widgetTrack, setWidgetTrack] = useState('—');
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const serverNow = useCallback(() => {
    const offset = clockRef.current;
    // Before the first measurement there is no answer we are entitled to give.
    return offset === null ? Number.NaN : serverNowFrom(offset, performance.now());
  }, []);

  // Clock first, then the schedule. Both must settle before sync can start.
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
      const live = await fetchActiveSchedule(params.get('room') ?? 'main').catch(() => null);
      if (cancelled) return;

      const base: ResolvedSchedule =
        live !== null && live.tracks.length > 0
          ? {
              source: 'live',
              label: `${live.roomName} — schedule ${live.scheduleId.slice(0, 8)}`,
              setUrl: live.setUrl,
              tracks: live.tracks,
              epochMs: live.epochMs,
            }
          : {
              source: 'fixture',
              label: 'frozen fixture (Supabase not configured or room empty)',
              setUrl: FIXTURE_SET_URL,
              tracks: FIXTURE_TRACKS,
              epochMs: FIXTURE_EPOCH_MS,
            };

      const epochParam = params.get('epoch');
      const atParam = params.get('at');
      const epochMs =
        epochParam !== null && Number.isFinite(Number(epochParam))
          ? Number(epochParam)
          : atParam !== null && Number.isFinite(Number(atParam))
            ? serverNowFrom(offset, performance.now()) - Number(atParam)
            : base.epochMs;

      setSchedule({ ...base, epochMs });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // A single reading at mount goes stale across a sleep, a network change, or
  // an NTP correction.
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

  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe === null || schedule === null) return;

    let cancelled = false;
    let player: SoundCloudPlayer | null = null;
    let sync: ReturnType<typeof createRoomSync> | null = null;

    void createSoundCloudPlayer(iframe, {
      setUrl: schedule.setUrl,
      onWidgetEvent: (name) => {
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
          tracks: schedule.tracks,
          epochMs: schedule.epochMs,
          serverNow,
          onChange: setSnapshot,
        });
        syncRef.current = sync;
        // Debug handles. Harness only.
        Object.assign(window, { __player: created, __sync: sync });
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

  // Readout only. Never corrects anything.
  useEffect(() => {
    if (schedule === null) return;
    const timer = setInterval(() => {
      const now = serverNow();
      if (!Number.isFinite(now)) return;
      const position = positionAt(schedule.tracks, schedule.epochMs, now);
      setLiveTargetMs(position.kind === 'playing' ? position.offsetMs : null);
      setLiveTrack(
        position.kind === 'playing'
          ? `#${position.trackIndex} ${position.track.artist} — ${position.track.title}`
          : '—',
      );
      const loaded = playerRef.current?.getLoadedSound() ?? null;
      setWidgetTrack(loaded === null ? '—' : `${loaded.artist} — ${loaded.title}`);
      void playerRef.current?.getPosition().then((actual) => {
        setLiveActualMs(Number.isFinite(actual) ? actual : null);
      });
    }, DISPLAY_POLL_MS);
    return () => clearInterval(timer);
  }, [schedule, serverNow]);

  const liveDriftMs =
    liveTargetMs === null || liveActualMs === null ? null : liveActualMs - liveTargetMs;
  const withinBar = liveDriftMs !== null && Math.abs(liveDriftMs) <= DRIFT_PASS_BAR_MS;

  return (
    <main>
      <h1>Sync harness</h1>

      {error !== null && <p role="alert">{error}</p>}

      <p>
        {snapshot.tunedIn ? (
          <button type="button" onClick={() => syncRef.current?.tuneOut()}>
            Tune out
          </button>
        ) : (
          <button type="button" onClick={() => void syncRef.current?.tuneIn()}>
            Tune in
          </button>
        )}{' '}
        {snapshot.tunedIn ? 'tuned in' : 'not tuned in'} — player:{' '}
        <strong>{snapshot.playerState}</strong>
        {snapshot.unavailable && ' — TRACK NOT IN SET'}
        {snapshot.contended && ' — AUDIO HELD ELSEWHERE (gave up retrying)'}
      </p>
      <p>
        <small>
          The room plays whether or not you are listening. Tuning back in rejoins wherever it
          has got to — it does not resume where you left.
        </small>
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
        {/* Learned, not configured. On cellular this settles near 750ms; on
            wifi it stays near zero. */}
        <li>seek lands late by: {ms(snapshot.seekLatencyMs)}</li>
      </ul>

      <h2>Schedule</h2>
      <ul>
        {/* The whole point of step 4: this must say "live". */}
        <li>
          source: <strong>{schedule?.source ?? 'resolving…'}</strong>{' '}
          {schedule === null ? '' : `— ${schedule.label}`}
        </li>
        <li>schedule says: {liveTrack}</li>
        {/* What the widget actually holds. Showing the schedule's track here
            once hid a bug where the right position was seeked on the wrong
            song and the drift number looked perfect. */}
        <li>widget holds: {widgetTrack}</li>
        <li>epoch: {schedule?.epochMs ?? '—'}</li>
        <li>
          revolution: {schedule === null ? '—' : `${totalDurationMs(schedule.tracks)} ms`} over{' '}
          {schedule?.tracks.length ?? 0} track(s)
        </li>
      </ul>

      <h2>Clock</h2>
      <ul>
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

      {schedule !== null && (
        <iframe
          ref={iframeRef}
          title="SoundCloud player"
          src={widgetIframeSrc(schedule.setUrl)}
          allow="autoplay"
          width="100%"
          height="120"
        />
      )}
    </main>
  );
}
