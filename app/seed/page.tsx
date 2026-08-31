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
 *
 * It also diffs the set against whatever the room is actually playing, so
 * opening it answers "is there anything to do?" at a glance — and so only the
 * tracks that are genuinely new need driving, rather than all of them every
 * time.
 *
 * ?set=<soundcloud set url> to harvest a set other than the current default.
 * ?room=<slug>              to diff against a room other than the default.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchActiveSchedule, type LiveSchedule } from '@/lib/db/schedules';
import { FIXTURE_SET_URL } from '@/lib/fixtures/tracks';
import { DEFAULT_ROOM_SLUG } from '@/lib/rooms';
import { normalizeTrackUrl } from '@/lib/track-url';
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

  const [setUrl, setSetUrl] = useState<string>(FIXTURE_SET_URL);

  useEffect(() => {
    const override = new URLSearchParams(window.location.search).get('set');
    if (override !== null && override.length > 0) setSetUrl(override);
  }, []);
  const [sounds, setSounds] = useState<WidgetSound[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [verdicts, setVerdicts] = useState<Map<number, Verdict>>(new Map());
  const [verifying, setVerifying] = useState(false);
  const [status, setStatus] = useState('loading the set…');
  const [live, setLive] = useState<LiveSchedule | null>(null);

  // What the room is playing right now, to diff the set against.
  useEffect(() => {
    const roomSlug = new URLSearchParams(window.location.search).get('room') ?? DEFAULT_ROOM_SLUG;
    let cancelled = false;
    void fetchActiveSchedule(roomSlug)
      .then((schedule) => {
        if (!cancelled) setLive(schedule);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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

  /**
   * A track already in the live schedule was driven when that schedule was
   * seeded, so it does not need driving again to re-seed. Not free of risk —
   * a track can stop playing after the fact, which is exactly what happened
   * once — but re-checking a whole set to add one song costs a minute and
   * a half every time, and nobody does a chore that expensive.
   */
  const scheduleUrls = useMemo(
    () => new Set((live?.tracks ?? []).map((track) => normalizeTrackUrl(track.url))),
    [live],
  );
  const isInSchedule = useCallback(
    (url: string) => scheduleUrls.has(normalizeTrackUrl(url)),
    [scheduleUrls],
  );

  /** In the schedule but no longer in the set — the room cannot resolve these. */
  const missingFromSet = useMemo(() => {
    if (live === null || sounds.length === 0) return [];
    const setUrls = new Set(sounds.map((sound) => normalizeTrackUrl(sound.url)));
    return live.tracks.filter((track) => !setUrls.has(normalizeTrackUrl(track.url)));
  }, [live, sounds]);

  const verify = useCallback(async () => {
    const player = playerRef.current;
    if (player === null || verifying) return;

    // Only what needs driving: already-scheduled tracks were checked when the
    // schedule was seeded.
    const queue = sounds.filter(
      (sound) =>
        chosen.has(sound.index) &&
        !isInSchedule(sound.url) &&
        verdicts.get(sound.index) === undefined,
    );
    if (queue.length === 0) {
      setStatus('nothing new to check — everything selected is already in the schedule');
      return;
    }
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
  }, [chosen, isInSchedule, sounds, verdicts, verifying]);

  const toggle = useCallback((index: number) => {
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const newToTheSet = sounds.filter((sound) => !isInSchedule(sound.url));

  const selected = sounds.filter((s) => chosen.has(s.index));
  const verifiedPlayable = selected.filter((s) => {
    const verdict = verdicts.get(s.index);
    if (verdict !== undefined && verdict !== 'checking') return verdict.playable;
    return isInSchedule(s.url);
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

      {/* The question this page exists to answer at a glance. */}
      {live !== null && sounds.length > 0 && (
        <p>
          <strong>
            {newToTheSet.length === 0 && missingFromSet.length === 0
              ? 'Nothing to do — the set and the schedule agree.'
              : `${newToTheSet.length} track(s) in the set are not in the schedule.`}
          </strong>{' '}
          <small>
            The room is playing {live.tracks.length} of the set&apos;s {sounds.length}, from
            schedule {live.scheduleId.slice(0, 8)}.
          </small>
        </p>
      )}

      {missingFromSet.length > 0 && (
        <div role="alert">
          <h2>In the schedule but no longer in the set</h2>
          <p>
            <small>
              The room cannot resolve these, so it treats them as unplayable and skips
              past. Put them back in the set, or re-seed without them.
            </small>
          </p>
          <ul>
            {missingFromSet.map((track) => (
              <li key={track.url}>
                {track.artist} — {track.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p>
        <button type="button" onClick={() => void verify()} disabled={verifying || sounds.length === 0}>
          {verifying
            ? 'Verifying…'
            : `Verify ${selected.filter((s) => !isInSchedule(s.url) && verdicts.get(s.index) === undefined).length} unchecked track(s)`}
        </button>{' '}
        <small>
          Plays each one silently and checks the widget stays on it, roughly three seconds
          each. Tracks already in the schedule are skipped — they were driven when it was
          seeded.
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
              ? isInSchedule(sound.index === -1 ? '' : sound.url)
                ? ' — in the schedule'
                : ' — NEW, not yet playing'
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
