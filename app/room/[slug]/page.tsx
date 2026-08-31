'use client';

/**
 * The room.
 *
 * A dark place you tune into. Everything the room knows comes from `useRoom`;
 * this file is only responsible for how it looks.
 *
 * The SoundCloud widget is kept visible, small, at the bottom. Hiding an embed
 * is where attribution goes to die, and the audio genuinely does come from
 * there — pretending otherwise would be both dishonest and against the terms
 * the free widget is offered under.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/avatar';
import { HeartBurst } from '@/components/heart-burst';
import { MarqueeText } from '@/components/marquee-text';
import { VoteBar } from '@/components/vote-bar';
import { widgetIframeSrc } from '@/lib/player/widget-api';
import { CONFIRM_HOLD, DURATION, EASE, SPRING, jitter } from '@/lib/motion';
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

  // The buttons sit near the bottom, so the input it reveals opens off-screen
  // on a phone — a field you cannot see is a field nobody fills in.
  useEffect(() => {
    if (!requesting) return;
    requestRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [requesting]);

  const progress =
    room.track === null ? 0 : Math.min(1, room.offsetMs / room.track.durationMs);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pb-6 pt-10">
      <header className="mb-8 flex items-baseline justify-between">
        <h1 className="text-sm font-medium tracking-widest text-room-dim uppercase">
          {room.roomName}
        </h1>
        <span className="text-xs text-room-faint">
          {room.listeners.length === 0
            ? 'nobody here'
            : `${room.listeners.length} listening`}
        </span>
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
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                {/* Scrolls itself only when the title does not fit. Keyed on
                    the title so a track change starts it over rather than
                    resuming mid-scroll on different words. */}
                <MarqueeText
                  key={room.track?.url ?? 'none'}
                  text={room.track?.title ?? '—'}
                  className="text-lg font-medium"
                />
                <p className="truncate text-sm text-room-dim">{room.track?.artist ?? ''}</p>
              </div>

              <VoteBar
                up={room.votes.up}
                down={room.votes.down}
                myVote={room.myVote}
                onVote={room.vote}
                likedTracks={room.likedTracks}
              />
            </div>

            {/* Everyone is at the same point in this bar, which is the whole
                idea. It is drawn from the schedule, not from the player. */}
            <div className="mt-4 flex items-center gap-3 text-xs tabular-nums text-room-faint">
              <span>{clock(room.offsetMs)}</span>
              <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-room-edge">
                <div
                  className="h-full rounded-full bg-room-dim"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <span>{clock(room.track?.durationMs ?? 0)}</span>
            </div>

            {/* A quarter of the width, centred. The room is about the people;
                the record sleeve is context, not the subject. */}
            <div className="mx-auto mt-7 aspect-square w-1/4 overflow-hidden rounded-2xl bg-room-floor">
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
            </div>
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
                  origin={jitter(heart.listenerId, 0.78) + 0.11}
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

          <div className="pt-8">
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
                  className="rounded-full border-2 border-room-ink px-12 py-5 text-sm font-medium text-room-ink"
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
                  {!room.ready ? 'Getting ready…' : room.contended ? 'Try again' : 'Tune in'}
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
                Request track
              </motion.button>
            </div>

            {room.tunedIn && !room.contended && (
              <p className="mt-2 text-center text-xs text-room-faint">
                {room.unavailable
                  ? 'this track will not play here'
                  : room.playerState === 'stalled'
                    ? 'catching up…'
                    : 'tuned in'}
              </p>
            )}
            {room.contended && (
              <p className="mt-2 text-center text-xs text-room-faint">
                Playback would not start. If the room is open in another tab, close it.
              </p>
            )}

            <AnimatePresence>
              {requesting && (
                <motion.form
                  ref={requestRef}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{
                    opacity: 1,
                    height: 'auto',
                    transition: { duration: DURATION.normal, ease: EASE.enter },
                  }}
                  exit={{
                    opacity: 0,
                    height: 0,
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
                  <div className="mt-4 flex gap-2">
                    <input
                      value={request}
                      onChange={(event) => {
                        setRequest(event.target.value);
                        setRequestResult(null);
                      }}
                      placeholder="paste soundcloud link here"
                      aria-label="SoundCloud track link"
                      inputMode="url"
                      className="min-w-0 flex-1 rounded-full border border-room-edge bg-room-floor px-4 py-3 text-sm text-room-ink placeholder:text-room-faint"
                    />
                    <motion.button
                      layout
                      transition={SPRING.arrive}
                      type="submit"
                      disabled={sent || request.trim().length === 0}
                      className="flex items-center justify-center rounded-full bg-room-ink px-5 py-3 text-sm font-medium text-room-void disabled:opacity-40"
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
                  <p className="mt-2 text-center text-xs text-room-faint">
                    {requestResult === 'saved' && 'Sent — it is up to the curator now.'}
                    {requestResult === 'already' && 'You have already asked for that one.'}
                    {requestResult === 'invalid' &&
                      'That is not a SoundCloud track link. A set or a profile will not play here.'}
                    {requestResult === 'failed' && 'Could not send that. Try again in a moment.'}
                    {requestResult === null && 'A link to a single track, not a playlist.'}
                  </p>
                </motion.form>
              )}
            </AnimatePresence>
          </div>
        </>
      )}

      {/* Kept visible and small: this is where the audio actually comes from,
          and where SoundCloud's attribution lives. */}
      {room.setUrl !== null && (
        <div className="mt-6 overflow-hidden rounded-lg opacity-40">
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
