'use client';

/**
 * Seed harvester.
 *
 * Durations only exist inside the widget, which only exists in a browser — so
 * this half of seeding is a page, not a Node script. It writes nothing. It
 * produces the JSON that `scripts/seed.mjs` then writes with the service role
 * key, which never leaves a local machine.
 *
 * Tracks that refuse off-platform embedding are excluded here, loudly, rather
 * than discovered at 2am in a live room.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FIXTURE_SET_URL } from '@/lib/fixtures/tracks';
import { createSoundCloudPlayer, type SoundCloudPlayer } from '@/lib/player/soundcloud';
import type { WidgetSound } from '@/lib/player/sounds';
import { widgetIframeSrc } from '@/lib/player/widget-api';

const formatDuration = (ms: number) => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export default function SeedHarvester() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [setUrl] = useState<string>(FIXTURE_SET_URL);
  const [sounds, setSounds] = useState<WidgetSound[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState('loading the set…');

  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe === null) return;

    let cancelled = false;
    let player: SoundCloudPlayer | null = null;

    void createSoundCloudPlayer(iframe, { setUrl })
      .then((created) => {
        if (cancelled) {
          created.destroy();
          return;
        }
        player = created;
        const found = [...created.getSounds()];
        setSounds(found);
        setChosen(new Set(found.filter((s) => s.embeddable).map((s) => s.index)));
        setStatus(`${found.length} tracks read`);
      })
      .catch((cause: unknown) => {
        setStatus(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
      player?.destroy();
    };
  }, [setUrl]);

  const toggle = useCallback((index: number) => {
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const selected = sounds.filter((s) => chosen.has(s.index));
  const totalMs = selected.reduce((sum, s) => sum + s.durationMs, 0);
  const blocked = sounds.filter((s) => !s.embeddable);

  const payload = JSON.stringify(
    {
      setUrl,
      tracks: selected.map((s) => ({
        url: s.url,
        title: s.title,
        artist: s.artist,
        artwork: s.artwork,
        durationMs: s.durationMs,
      })),
    },
    null,
    2,
  );

  return (
    <main>
      <h1>Seed harvester</h1>
      <p>
        <code>{setUrl}</code> — {status}
      </p>

      {blocked.length > 0 && (
        <p role="alert">
          <strong>{blocked.length} track(s) refuse off-platform embedding</strong> and are
          excluded: {blocked.map((s) => s.title).join(', ')}
        </p>
      )}

      <h2>
        Tracks — {selected.length} chosen, one revolution {formatDuration(totalMs)}
      </h2>
      <ol start={0}>
        {sounds.map((sound) => (
          <li key={sound.index}>
            <label>
              <input
                type="checkbox"
                checked={chosen.has(sound.index)}
                disabled={!sound.embeddable}
                onChange={() => toggle(sound.index)}
              />{' '}
              {sound.artist} — {sound.title} ({formatDuration(sound.durationMs)})
              {!sound.embeddable && ' — NOT EMBEDDABLE'}
            </label>
          </li>
        ))}
      </ol>

      <h2>Snapshot</h2>
      <p>
        Save this as <code>seed.json</code>, then run{' '}
        <code>node --env-file=.env.local scripts/seed.mjs seed.json</code>.
      </p>
      <textarea readOnly rows={20} cols={100} value={payload} />

      <iframe
        ref={iframeRef}
        title="SoundCloud player"
        src={widgetIframeSrc(setUrl)}
        allow="autoplay"
        width="100%"
        height="120"
      />
    </main>
  );
}
