'use client';

/**
 * Step 2 harness. Load one track, seek to 30s, watch what the widget does.
 *
 * Deliberately unstyled — the phase's first real deliverable is sync, and any
 * time spent here on appearance is time not spent on that.
 *
 * `?url=<soundcloud track url>` swaps the track, so an embed-refusing or
 * geo-blocked track can be tried without a rebuild.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FIXTURE_TRACKS } from '@/lib/fixtures/tracks';
import { createSoundCloudPlayer } from '@/lib/player/soundcloud';
import type { PlayerState, RoomPlayer } from '@/lib/player/types';
import { widgetIframeSrc } from '@/lib/player/widget-api';

const SEEK_TARGET_MS = 30_000;
const POSITION_POLL_MS = 250;
const MAX_LOG_LINES = 40;

export default function PlayerHarness() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<RoomPlayer | null>(null);

  const [trackUrl, setTrackUrl] = useState<string>(FIXTURE_TRACKS[0]?.url ?? '');
  const [state, setState] = useState<PlayerState>('idle');
  const [positionMs, setPositionMs] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const append = useCallback((line: string) => {
    setLog((previous) => [line, ...previous].slice(0, MAX_LOG_LINES));
  }, []);

  // Read the override before the player is built, so the iframe src is right
  // the first time.
  useEffect(() => {
    const override = new URLSearchParams(window.location.search).get('url');
    if (override) setTrackUrl(override);
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let cancelled = false;
    let player: RoomPlayer | null = null;

    createSoundCloudPlayer(iframe, {
      onWidgetEvent: (name) => append(`widget: ${name}`),
    })
      .then((created) => {
        if (cancelled) {
          created.destroy();
          return;
        }
        player = created;
        playerRef.current = created;
        // Debug handle, so the player can be driven from the console while
        // we learn the widget's behaviour. Harness only.
        (window as unknown as { __player?: RoomPlayer }).__player = created;
        setState(created.getState());
        created.onStateChange((next) => {
          setState(next);
          append(`state: ${next}`);
        });
        append('player ready');
        return created.load(trackUrl).then((outcome) => append(`load: ${outcome}`));
      })
      .catch((error: unknown) => {
        append(`error: ${error instanceof Error ? error.message : String(error)}`);
      });

    return () => {
      cancelled = true;
      player?.destroy();
      playerRef.current = null;
    };
  }, [trackUrl, append]);

  useEffect(() => {
    const timer = setInterval(() => {
      void playerRef.current?.getPosition().then((ms) => {
        setPositionMs(Number.isNaN(ms) ? null : ms);
      });
    }, POSITION_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <main>
      <h1>Player harness</h1>
      <p>
        <code>{trackUrl}</code>
      </p>

      <p>
        state: <strong>{state}</strong>
        {' — '}
        position: <strong>{positionMs === null ? 'no reading' : `${positionMs} ms`}</strong>
      </p>

      <p>
        {/* Autoplay needs a user gesture. This button is that gesture. */}
        <button type="button" onClick={() => playerRef.current?.play()}>
          Tune in
        </button>{' '}
        <button type="button" onClick={() => playerRef.current?.pause()}>
          Pause
        </button>{' '}
        <button type="button" onClick={() => playerRef.current?.seekTo(SEEK_TARGET_MS)}>
          Seek to 30s
        </button>
      </p>

      <iframe
        ref={iframeRef}
        title="SoundCloud player"
        src={widgetIframeSrc(trackUrl)}
        allow="autoplay"
        width="100%"
        height="120"
      />

      <h2>Events</h2>
      <ol>
        {log.map((line, index) => (
          <li key={`${line}-${index}`}>
            <code>{line}</code>
          </li>
        ))}
      </ol>
    </main>
  );
}
