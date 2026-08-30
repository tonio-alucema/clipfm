'use client';

/**
 * Seed harvester.
 *
 * Durations only exist inside the widget, and the widget only exists in a
 * browser — so this half of seeding is a page, not a Node script. It writes
 * nothing. It produces the JSON that `scripts/seed.mjs` then writes with the
 * service role key, which never leaves a local machine.
 *
 * Every track is driven before it is allowed into a snapshot. Metadata is not
 * enough: the track that broke the room reported streamable, embeddable, a
 * real duration, and played fine on its own — and was silently skipped past
 * inside the set. An unplayable track in a schedule breaks the room forever,
 * so this is the check that matters.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FIXTURE_SET_URL } from '@/lib/fixtures/tracks';
import {
  createSoundCloudPlayer,
  type PlayabilityResult,
  type SoundCloudPlayer,
} from '@/lib/player/soundcloud';
import type { WidgetSound } from '@/lib/player/sounds';
import { widgetIframeSrc } from '@/lib/player/widget-api';

type Verdict = PlayabilityResult | 'checking';

const formatDuration = (ms: number) => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export default function SeedHarvester() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<SoundCloudPlayer | null>(null);

  const [setUrl] = useState<string>(FIXTURE_SET_URL);
  const [sounds, setSounds] = useState<WidgetSound[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [verdicts, setVerdicts] = useState<Map<number, Verdict>>(new Map());
  const [verifying, setVerifying] = useState(false);
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
        playerRef.current = created;
        const found = [...created.getSounds()];
        setSounds(found);
        setChosen(new Set(found.filter((s) => s.embeddable).map((s) => s.index)));
        setStatus(`${found.length} tracks read — nothing is verified yet`);
      })
      .catch((cause: unknown) => {
        setStatus(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
      player?.destroy();
      playerRef.current = null;
    };
  }, [setUrl]);

  const verify = useCallback(async () => {
    const player = playerRef.current;
    if (player === null || verifying) return;

    const queue = sounds.filter((sound) => chosen.has(sound.index));
    setVerifying(true);
    // Silent: this plays every track in turn, and nobody needs to hear that.
    player.setVolume(0);

    try {
      for (const [done, sound] of queue.entries()) {
        setStatus(`verifying ${done + 1} of ${queue.length} — ${sound.title}`);
        setVerdicts((previous) => new Map(previous).set(sound.index, 'checking'));

        const result = await player.verifyPlayable(sound);
        setVerdicts((previous) => new Map(previous).set(sound.index, result));

        // A track that will not play must not end up in a schedule, so it is
        // dropped from the selection rather than merely flagged.
        if (!result.playable) {
          setChosen((previous) => {
            const next = new Set(previous);
            next.delete(sound.index);
            return next;
          });
        }
      }
      setStatus(`verified ${queue.length} track(s)`);
    } finally {
      player.pause();
      player.setVolume(100);
      setVerifying(false);
    }
  }, [chosen, sounds, verifying]);

  const toggle = useCallback((index: number) => {
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const selected = sounds.filter((s) => chosen.has(s.index));
  const verifiedPlayable = selected.filter((s) => {
    const verdict = verdicts.get(s.index);
    return verdict !== undefined && verdict !== 'checking' && verdict.playable;
  });
  const allSelectedVerified = selected.length > 0 && verifiedPlayable.length === selected.length;
  const rejected = sounds.filter((s) => {
    const verdict = verdicts.get(s.index);
    return verdict !== undefined && verdict !== 'checking' && !verdict.playable;
  });
  const totalMs = verifiedPlayable.reduce((sum, s) => sum + s.durationMs, 0);

  const payload = allSelectedVerified
    ? JSON.stringify(
        {
          setUrl,
          verifiedAt: new Date().toISOString(),
          tracks: verifiedPlayable.map((s) => ({
            url: s.url,
            title: s.title,
            artist: s.artist,
            artwork: s.artwork,
            durationMs: s.durationMs,
          })),
        },
        null,
        2,
      )
    : '';

  return (
    <main>
      <h1>Seed harvester</h1>
      <p>
        <code>{setUrl}</code> — {status}
      </p>

      <p>
        <button type="button" onClick={() => void verify()} disabled={verifying || sounds.length === 0}>
          {verifying ? 'Verifying…' : `Verify ${selected.length} selected track(s)`}
        </button>{' '}
        <small>
          Plays each one silently and checks the widget stays on it. Roughly three seconds
          each.
        </small>
      </p>

      {rejected.length > 0 && (
        <div role="alert">
          <h2>Will not play — excluded</h2>
          <ul>
            {rejected.map((sound) => (
              <li key={sound.index}>
                <strong>
                  {sound.artist} — {sound.title}
                </strong>
                : {(verdicts.get(sound.index) as PlayabilityResult).reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2>
        Tracks — {verifiedPlayable.length} of {selected.length} selected verified, one
        revolution {formatDuration(totalMs)}
      </h2>
      <ol start={0}>
        {sounds.map((sound) => {
          const verdict = verdicts.get(sound.index);
          const mark =
            verdict === undefined
              ? ''
              : verdict === 'checking'
                ? ' — checking…'
                : verdict.playable
                  ? ' — plays'
                  : ` — WILL NOT PLAY: ${verdict.reason}`;
          return (
            <li key={sound.index}>
              <label>
                <input
                  type="checkbox"
                  checked={chosen.has(sound.index)}
                  disabled={
                    !sound.embeddable ||
                    verifying ||
                    (verdict !== undefined && verdict !== 'checking' && !verdict.playable)
                  }
                  onChange={() => toggle(sound.index)}
                />{' '}
                {sound.artist} — {sound.title} ({formatDuration(sound.durationMs)})
                {!sound.embeddable && ' — embedding not permitted'}
                {mark}
              </label>
            </li>
          );
        })}
      </ol>

      <h2>Snapshot</h2>
      {allSelectedVerified ? (
        <>
          <p>
            Save as <code>seed.json</code>, then run{' '}
            <code>node --env-file=.env.local scripts/seed.mjs seed.json</code>.
          </p>
          <textarea readOnly rows={20} cols={100} value={payload} />
        </>
      ) : (
        <p>
          <small>
            No snapshot until every selected track has been verified. Metadata does not
            predict playability, and one track that will not play breaks the room for
            everyone in it.
          </small>
        </p>
      )}

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
