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
import { useState } from 'react';
import { Avatar } from '@/components/avatar';
import { HeartBurst } from '@/components/heart-burst';
import { widgetIframeSrc } from '@/lib/player/widget-api';
import { DURATION, EASE, SPRING, jitter } from '@/lib/motion';
import { useRoom } from '@/lib/room/use-room';

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function RoomPage() {
  const params = useParams<{ slug: string }>();
  const room = useRoom(params.slug ?? 'main');
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');

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
          Nothing is scheduled here yet. The room is real, but silent.
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
            <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-room-floor">
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
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}
              </AnimatePresence>
            </div>

            <div className="mt-5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-lg font-medium">{room.track?.title ?? '—'}</p>
                <p className="truncate text-sm text-room-dim">{room.track?.artist ?? ''}</p>
              </div>

              <motion.button
                type="button"
                onClick={room.throwHeart}
                whileTap={{ scale: 0.88 }}
                transition={SPRING.arrive}
                aria-label={room.hasFavorited ? 'Favourited' : 'Favourite this track'}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-room-edge px-3.5 py-2 text-sm"
                style={{ color: room.hasFavorited ? 'var(--color-room-heart)' : undefined }}
              >
                <span aria-hidden>♥</span>
                <span className="tabular-nums">{room.favoriteCount}</span>
              </motion.button>
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
          </section>

          {/* The room --------------------------------------------------- */}
          <section className="relative mt-10 min-h-40">
            <AnimatePresence initial={false}>
              {room.hearts.map((heart) => (
                <HeartBurst
                  key={heart.id}
                  id={heart.id}
                  origin={jitter(heart.listenerId, 0.78) + 0.11}
                />
              ))}
            </AnimatePresence>

            <ul className="flex flex-wrap items-end gap-x-3 gap-y-4">
              <AnimatePresence initial={false} mode="popLayout">
                {room.listeners.map((present) => (
                  <Avatar
                    key={present.id}
                    id={present.id}
                    nickname={present.nickname}
                    isSelf={present.id === room.listener?.id}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </section>

          <div className="mt-auto pt-8">
            {/* Tune in needs a real gesture, and mobile only unlocks audio from
                inside one — so the button stays disabled until there is a
                player to receive it. Tapping early would spend the tap on
                nothing and leave the room silent. */}
            {room.tunedIn && !room.contended ? (
              <div className="flex items-center justify-between gap-4 text-xs text-room-faint">
                <span>
                  {room.unavailable
                    ? 'this track will not play here'
                    : room.playerState === 'stalled'
                      ? 'catching up…'
                      : 'tuned in'}
                </span>
                <button type="button" onClick={room.tuneOut} className="underline">
                  tune out
                </button>
              </div>
            ) : (
              <>
                <motion.button
                  type="button"
                  onClick={room.tuneIn}
                  disabled={!room.ready}
                  whileTap={{ scale: room.ready ? 0.97 : 1 }}
                  transition={SPRING.arrive}
                  className="w-full rounded-full bg-room-ink py-3.5 text-sm font-medium text-room-void disabled:opacity-40"
                >
                  {!room.ready ? 'Getting ready…' : room.contended ? 'Try again' : 'Tune in'}
                </motion.button>
                {room.contended && (
                  <p className="mt-2 text-center text-xs text-room-faint">
                    Playback would not start. If the room is open in another tab, close it.
                  </p>
                )}
              </>
            )}

            <div className="mt-4 text-center text-xs text-room-faint">
              {renaming ? (
                <input
                  autoFocus
                  value={draft}
                  maxLength={24}
                  aria-label="your name"
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => {
                    room.setNickname(draft);
                    setRenaming(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                  className="w-40 rounded-md border border-room-edge bg-room-floor px-2 py-1 text-center text-room-ink"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(room.listener?.nickname ?? '');
                    setRenaming(true);
                  }}
                >
                  you are <span className="text-room-dim">{room.listener?.nickname}</span>
                </button>
              )}
            </div>
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
