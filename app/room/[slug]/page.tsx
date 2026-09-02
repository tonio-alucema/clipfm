'use client';

/**
 * The room.
 *
 * A dark place you tune into. Everything the room knows comes from `useRoom`;
 * this file is only responsible for how it looks.
 *
 * The SoundCloud widget is mounted but out of sight. Its own controls were
 * misleading here — pausing it fights the schedule rather than the room, and
 * the room is not a thing you pause. What the embed carried that still matters
 * is the credit, so that moves to the mark beside the progress bar and links
 * out to the track. Attribution is kept deliberately rather than incidentally.
 *
 * It is positioned off-screen rather than `display: none`: a hidden iframe can
 * be suspended by the browser, and this one is the audio.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/avatar';
import { HeartBurst } from '@/components/heart-burst';
import { MarqueeText } from '@/components/marquee-text';
import { FavoriteBar } from '@/components/favorite-bar';
import { SoundCloudMark } from '@/components/soundcloud-mark';
import { widgetIframeSrc } from '@/lib/player/widget-api';
import {
  CONFIRM_HOLD,
  DURATION,
  EASE,
  SPRING,
  TUNED_OUT_OPACITY,
  jitter,
} from '@/lib/motion';
import { useRoom } from '@/lib/room/use-room';
import type { SuggestionOutcome } from '@/lib/suggestions/suggestions';
import { DEFAULT_ROOM_SLUG } from '@/lib/rooms';

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function RoomPage() {
  const params = useParams<{ slug: string }>();
  const room = useRoom(params.slug ?? DEFAULT_ROOM_SLUG);
  const [requesting, setRequesting] = useState(false);
  const [request, setRequest] = useState('');
  const [requestResult, setRequestResult] = useState<SuggestionOutcome | null>(null);
  const [sent, setSent] = useState(false);
  const requestRef = useRef<HTMLFormElement | null>(null);
  const collapseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (collapseRef.current !== null) clearTimeout(collapseRef.current);
  }, []);

  // The field opens above the buttons, so it is in view already — but a phone
  // keyboard covers the lower third once it is focused, which puts it back
  // off-screen. Scrolling it up is for the keyboard, not the layout.
  useEffect(() => {
    if (!requesting) return;
    requestRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [requesting]);

  const progress =
    room.track === null ? 0 : Math.min(1, room.offsetMs / room.track.durationMs);

  // Contended is not tuned in, whatever the player thinks — the same reading
  // the buttons use, so the room never contradicts its own controls.
  const live = room.tunedIn && !room.contended;

  // What is playing recedes while you are out and comes up when you join. The
  // heart is deliberately not in here: it stays available either way, and
  // dimming an action makes it look disabled.
  const recede = {
    animate: { opacity: live ? 1 : TUNED_OUT_OPACITY },
    transition: { duration: DURATION.slow, ease: EASE.enter },
  } as const;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pb-6 pt-10">
      <header className="mb-8">
        {/* The mark, not the room name. They happen to be the same words
            today, but the logo is the product and the name is data — if a
            second room is ever added, this should not silently rename it. */}
        <h1>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/clipfm-logo-white.svg"
            alt="clip.fm"
            width={171}
            height={55}
            className="block h-[44px] w-auto"
          />
        </h1>
      </header>

      {room.phase === 'connecting' && (
        <p className="text-sm text-room-faint">Finding the room…</p>
      )}

      {room.phase === 'empty' && (
        <p className="text-sm text-room-dim">
          Nothing is playing here. Either this room has no schedule yet, or there is no
          room by this name.
        </p>
      )}

      {room.phase === 'error' && (
        <p role="alert" className="text-sm text-room-heart">
          {room.error}
        </p>
      )}

      {room.phase === 'ready' && (
        <>
          {/* Now playing ------------------------------------------------ */}
          <section>
            {/* Its own row, so the heart centres against the title and artist
                rather than against the label above them. */}
            <motion.p
              {...recede}
              className="mb-1 text-[10px] font-medium uppercase tracking-widest text-room-faint"
            >
              now playing
            </motion.p>

            <div className="flex items-center justify-between gap-4">
              <motion.div {...recede} className="min-w-0 flex-1">
                {/* Scrolls itself only when the title does not fit. Keyed on
                    the title so a track change starts it over rather than
                    resuming mid-scroll on different words. */}
                <MarqueeText
                  key={room.track?.url ?? 'none'}
                  text={room.track?.title ?? '—'}
                  className="text-base font-medium"
                />
                <p className="truncate text-sm text-room-dim">{room.track?.artist ?? ''}</p>
              </motion.div>

              {/* Not dimmed with the room: favoriting stays available whether
                  or not you are listening. */}
              <FavoriteBar
                count={room.favorites}
                isMine={room.isFavorited}
                onFavorite={room.favorite}
                likedTracks={room.likedTracks}
              />
            </div>

            {/* Everyone is at the same point in this bar, which is the whole
                idea. It is drawn from the schedule, not from the player. */}
            <motion.div
              {...recede}
              className="mt-4 flex items-center gap-2.5 text-xs tabular-nums text-room-faint"
            >
              <span>{clock(room.offsetMs)}</span>
              <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-room-edge">
                <div
                  className="h-full rounded-full bg-room-dim"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <span>{clock(room.track?.durationMs ?? 0)}</span>
              <SoundCloudMark href={room.track?.url ?? null} />
            </motion.div>

            {/* A quarter of the width, centred. The room is about the people;
                the record sleeve is context, not the subject. */}
            <motion.div
              {...recede}
              className="mx-auto mt-7 aspect-square w-1/4 overflow-hidden rounded-2xl bg-room-floor"
            >
              <AnimatePresence mode="popLayout">
                {room.track?.artwork != null && (
                  <motion.img
                    key={room.track.artwork}
                    src={room.track.artwork}
                    alt=""
                    initial={{ opacity: 0, scale: 1.04 }}
                    animate={{
                      opacity: 1,
                      scale: 1,
                      transition: { duration: DURATION.slow, ease: EASE.enter },
                    }}
                    exit={{
                      opacity: 0,
                      transition: { duration: DURATION.normal, ease: EASE.exit },
                    }}
                    className="h-full w-full object-cover"
                  />
                )}
              </AnimatePresence>
            </motion.div>
          </section>

          {/* The room --------------------------------------------------- */}
          {/* Takes whatever space is left and centres in it, so two listeners
              and twelve both look like a room rather than a list pinned under
              the artwork. */}
          <section className="relative mt-10 flex flex-1 items-center justify-center">
            <AnimatePresence initial={false}>
              {room.hearts.map((heart) => (
                <HeartBurst
                  key={heart.id}
                  id={heart.id}
                  listenerId={heart.listenerId}
                  fallbackOrigin={jitter(heart.listenerId, 0.78) + 0.11}
                />
              ))}
            </AnimatePresence>

            <ul className="flex w-full flex-wrap items-end justify-center gap-x-3 gap-y-5">
              <AnimatePresence initial={false} mode="popLayout">
                {room.listeners.map((present) => {
                  const isSelf = present.id === room.listener?.id;
                  return (
                    <Avatar
                      key={present.id}
                      id={present.id}
                      nickname={present.nickname}
                      isSelf={isSelf}
                      // Only your own name is yours to change.
                      {...(isSelf ? { onRename: room.setNickname } : {})}
                    />
                  );
                })}
              </AnimatePresence>
            </ul>
          </section>

          {/* Bottom-anchored, and the order is deliberate: the buttons are
              the one thing that never moves. Status sits above them, and the
              request field opens between the two — so revealing it nudges the
              status up rather than pushing the buttons off under a thumb. */}
          <div className="pt-8">
            {/* No "tuned in" — the room coming up to full says that. What is
                left is only what opacity cannot tell you. */}
            {live && (room.unavailable || room.playerState === 'stalled') && (
              <p className="mb-3 text-center text-xs text-room-faint">
                {room.unavailable ? 'this track will not play here' : 'catching up…'}
              </p>
            )}
            {room.contended && (
              <p className="mb-3 text-center text-xs text-room-faint">
                Playback would not start. If the room is open in another tab, close it.
              </p>
            )}

            <AnimatePresence>
              {requesting && (
                <motion.form
                  ref={requestRef}
                  initial={{ opacity: 0, height: 0, y: 12 }}
                  animate={{
                    opacity: 1,
                    height: 'auto',
                    y: 0,
                    transition: { duration: DURATION.normal, ease: EASE.enter },
                  }}
                  exit={{
                    opacity: 0,
                    height: 0,
                    y: 12,
                    transition: { duration: DURATION.quick, ease: EASE.exit },
                  }}
                  className="overflow-hidden"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void room.suggest(request).then((outcome) => {
                      setRequestResult(outcome);
                      if (outcome !== 'saved') return;
                      // Confirm where the action was, then take the whole
                      // thing away — a form that stays open after a successful
                      // send is asking whether it worked.
                      setSent(true);
                      collapseRef.current = setTimeout(() => {
                        setSent(false);
                        setRequesting(false);
                        setRequest('');
                        setRequestResult(null);
                      }, CONFIRM_HOLD * 1000);
                    });
                  }}
                >
                  <div className="mb-4 flex gap-2">
                    <input
                      value={request}
                      onChange={(event) => {
                        setRequest(event.target.value);
                        setRequestResult(null);
                      }}
                      placeholder="paste Soundcloud track link here"
                      aria-label="SoundCloud track link"
                      inputMode="url"
                      className="min-w-0 flex-1 rounded-full border border-room-edge bg-room-floor px-3.5 py-3 text-sm text-room-ink placeholder:text-room-faint"
                    />
                    <motion.button
                      layout
                      transition={SPRING.arrive}
                      type="submit"
                      disabled={sent || request.trim().length === 0}
                      className="flex items-center justify-center rounded-full bg-room-ink px-4 py-3 text-sm font-medium text-room-void disabled:opacity-40"
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        {sent ? (
                          <motion.svg
                            key="sent"
                            viewBox="0 0 24 24"
                            width="18"
                            height="18"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2.6}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-label="Sent"
                            initial={{ opacity: 0, scale: 0.5 }}
                            animate={{ opacity: 1, scale: 1, transition: SPRING.arrive }}
                            exit={{
                              opacity: 0,
                              scale: 0.5,
                              transition: { duration: DURATION.instant, ease: EASE.exit },
                            }}
                          >
                            <path d="M4.5 12.5l5 5 10-11" />
                          </motion.svg>
                        ) : (
                          <motion.span
                            key="send"
                            initial={{ opacity: 0 }}
                            animate={{
                              opacity: 1,
                              transition: { duration: DURATION.quick, ease: EASE.enter },
                            }}
                            exit={{
                              opacity: 0,
                              transition: { duration: DURATION.instant, ease: EASE.exit },
                            }}
                          >
                            Send
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </motion.button>
                  </div>
                  {/* Only when something went wrong. The guidance lives in the
                      field now, and a success is already answered by the
                      checkmark and the form closing itself. */}
                  {requestResult !== null && requestResult !== 'saved' && (
                    <p className="mb-4 text-center text-xs text-room-faint">
                      {requestResult === 'already' && 'You have already asked for that one.'}
                      {requestResult === 'invalid' &&
                        'That is not a SoundCloud track link. A set or a profile will not play here.'}
                      {requestResult === 'failed' && 'Could not send that. Try again in a moment.'}
                    </p>
                  )}
                </motion.form>
              )}
            </AnimatePresence>

            {/* Tune in needs a real gesture, and mobile only unlocks audio from
                inside one — so the button stays disabled until there is a
                player to receive it. */}
            <div className="flex items-center justify-center gap-3">
              {room.tunedIn && !room.contended ? (
                <motion.button
                  type="button"
                  onClick={room.tuneOut}
                  whileTap={{ scale: 0.97 }}
                  transition={SPRING.arrive}
                  className="rounded-full px-12 py-5 text-sm font-medium text-room-ink shadow-[inset_0_0_0_2px_var(--color-room-ink)]"
                >
                  Tune out
                </motion.button>
              ) : (
                <motion.button
                  type="button"
                  onClick={room.tuneIn}
                  disabled={!room.ready}
                  whileTap={{ scale: room.ready ? 0.97 : 1 }}
                  transition={SPRING.arrive}
                  className="rounded-full bg-room-ink px-12 py-5 text-sm font-medium text-room-void disabled:opacity-40"
                >
                  {!room.ready ? 'checking fake id…' : room.contended ? 'Try again' : 'Tune in'}
                </motion.button>
              )}

              <motion.button
                type="button"
                onClick={() => {
                  setRequestResult(null);
                  setRequesting((was) => !was);
                }}
                whileTap={{ scale: 0.97 }}
                transition={SPRING.arrive}
                aria-expanded={requesting}
                className="rounded-full border border-room-edge px-6 py-5 text-sm font-medium text-room-dim"
              >
                Request
              </motion.button>
            </div>

            {/* Last thing on the page and quiet enough to be ignored, which is
                what a signature should be. */}
            <p className="mt-4 text-center text-[9px] text-room-faint">
              made with ❤️ by{' '}
              <a
                href="https://x.com/tonioalucema"
                target="_blank"
                rel="noreferrer noopener"
                className="underline decoration-room-edge underline-offset-2 transition-colors hover:text-room-dim"
              >
                Tonio Alucema
              </a>
            </p>
          </div>

        </>
      )}

      {/* Out of sight, still playing. Off-screen rather than hidden: a
          `display: none` iframe is a candidate for suspension, and this one is
          the only thing making sound. Credit lives on the mark up by the
          progress bar. */}
      {room.setUrl !== null && (
        <div
          aria-hidden
          className="pointer-events-none fixed top-0 h-px w-px overflow-hidden opacity-0"
          style={{ left: '-9999px' }}
        >
          <iframe
            ref={room.iframeRef}
            title="SoundCloud player"
            src={widgetIframeSrc(room.setUrl)}
            allow="autoplay"
            width="100%"
            height="20"
            className="block"
          />
        </div>
      )}
    </main>
  );
}
