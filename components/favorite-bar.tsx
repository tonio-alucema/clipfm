'use client';

/**
 * The heart, and what you have favorited.
 *
 * One pill, two controls. The heart and the list belong to the same idea, so
 * they share a border and a divider rather than floating as two separate
 * buttons — but they stay separate <button>s, because tapping the heart and
 * opening the list are different things and a single control that does both
 * depending on where you hit it is a trap.
 *
 * The heart fills once it is yours and stays filled. There is no un-heart, so
 * the pressed state is a record rather than a toggle.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { DURATION, EASE, SPRING } from '@/lib/motion';

export type LikedTrack = {
  url: string;
  title: string;
  artist: string | null;
};

function Heart({ filled = false }: { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ display: 'block' }}
    >
      <path d="M12 20.3 4.3 12.6a4.6 4.6 0 0 1 0-6.5 4.6 4.6 0 0 1 6.5 0l1.2 1.2 1.2-1.2a4.6 4.6 0 0 1 6.5 0 4.6 4.6 0 0 1 0 6.5z" />
    </svg>
  );
}

function ExternalLink() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

export type FavoriteBarProps = {
  count: number;
  isMine: boolean;
  onFavorite: () => void;
  likedTracks: readonly LikedTrack[];
};

export function FavoriteBar({ count, isMine, onFavorite, likedTracks }: FavoriteBarProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // A panel that stays open after you have looked away is a panel in the way.
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative flex shrink-0 items-center">
      <div className="flex items-center rounded-full border border-room-edge">
        <motion.button
          type="button"
          onClick={onFavorite}
          whileTap={{ scale: 0.88 }}
          transition={SPRING.arrive}
          aria-label="Favorite this track"
          aria-pressed={isMine}
          className="flex items-center gap-1.5 rounded-full py-2 pl-3.5 pr-2.5 text-sm"
          style={{ color: isMine ? 'var(--color-room-heart)' : undefined }}
        >
          <Heart filled={isMine} />
          <span className="tabular-nums">{count}</span>
        </motion.button>

        <span aria-hidden className="h-4 w-px bg-room-edge" />

        {/* Always offered, even empty. A control that only appears once you
            have earned it is a control nobody knows is there. */}
        <motion.button
          type="button"
          onClick={() => setOpen((was) => !was)}
          whileTap={{ scale: 0.88 }}
          transition={SPRING.arrive}
          aria-expanded={open}
          aria-label={`Tracks you favorited (${likedTracks.length})`}
          className="rounded-full py-2 pl-2.5 pr-3 text-sm leading-none text-room-dim"
        >
          <motion.span
            aria-hidden
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: DURATION.quick, ease: EASE.standard }}
            className="block"
          >
            ▾
          </motion.span>
        </motion.button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: SPRING.arrive }}
            exit={{ opacity: 0, y: -6, transition: { duration: DURATION.quick, ease: EASE.exit } }}
            className="absolute right-0 top-full z-10 mt-2 max-h-64 w-72 overflow-y-auto rounded-xl border border-room-edge bg-room-floor p-1.5 shadow-xl"
          >
            {likedTracks.length === 0 ? (
              <p className="px-2.5 py-3 text-center text-xs text-room-faint">
                no favorited tracks yet
              </p>
            ) : (
              <>
              <p className="px-2.5 py-1.5 text-xs text-room-faint">You favorited</p>
              <ul>
                {likedTracks.map((liked) => (
                  <li key={liked.url}>
                    <a
                      href={liked.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm hover:bg-room-edge"
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{liked.title}</span>
                        {liked.artist !== null && (
                          <span className="block truncate text-xs text-room-faint">
                            {liked.artist}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-room-faint">
                        <ExternalLink />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
