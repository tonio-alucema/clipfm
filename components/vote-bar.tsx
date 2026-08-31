'use client';

/**
 * Thumbs up, thumbs down, and what you have liked.
 *
 * One thumb drawn once and rotated for the other, so the two can never drift
 * apart visually.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { DURATION, EASE, SPRING } from '@/lib/motion';
import type { VoteDirection } from '@/lib/votes/votes';

export type LikedTrack = {
  url: string;
  title: string;
  artist: string | null;
};

function Thumb({ down = false }: { down?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ transform: down ? 'rotate(180deg)' : undefined, display: 'block' }}
    >
      <path d="M6 21V10l4.6-7.4A1.6 1.6 0 0 1 13 3.7V8.6h5.3a2 2 0 0 1 2 2.4l-1.4 7.2a2.4 2.4 0 0 1-2.4 1.9H8a2 2 0 0 1-2-2z" />
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

export type VoteBarProps = {
  up: number;
  down: number;
  myVote: VoteDirection | undefined;
  onVote: (direction: VoteDirection) => void;
  likedTracks: readonly LikedTrack[];
};

export function VoteBar({ up, down, myVote, onVote, likedTracks }: VoteBarProps) {
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
    <div ref={wrapRef} className="relative flex shrink-0 items-center gap-2">
      <div className="flex items-center gap-1 rounded-full border border-room-edge">
        <motion.button
          type="button"
          onClick={() => onVote(1)}
          whileTap={{ scale: 0.88 }}
          transition={SPRING.arrive}
          aria-label="Thumbs up"
          aria-pressed={myVote === 1}
          className="flex items-center gap-1.5 rounded-full py-2 pl-3.5 pr-2 text-sm"
          style={{ color: myVote === 1 ? 'var(--color-room-heart)' : undefined }}
        >
          <Thumb />
          <span className="tabular-nums">{up}</span>
        </motion.button>

        <span aria-hidden className="h-4 w-px bg-room-edge" />

        <motion.button
          type="button"
          onClick={() => onVote(-1)}
          whileTap={{ scale: 0.88 }}
          transition={SPRING.arrive}
          aria-label="Thumbs down"
          aria-pressed={myVote === -1}
          className="flex items-center gap-1.5 rounded-full py-2 pl-2 pr-3.5 text-sm"
          style={{ color: myVote === -1 ? 'var(--color-room-dim)' : undefined }}
        >
          <Thumb down />
          <span className="tabular-nums">{down}</span>
        </motion.button>
      </div>

      {/* Only offered once there is something in it. */}
      {likedTracks.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          aria-label={`Tracks you liked (${likedTracks.length})`}
          className="rounded-full border border-room-edge px-2 py-2 text-xs text-room-dim"
        >
          <motion.span
            aria-hidden
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: DURATION.quick, ease: EASE.standard }}
            className="block"
          >
            ▾
          </motion.span>
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: SPRING.arrive }}
            exit={{ opacity: 0, y: -6, transition: { duration: DURATION.quick, ease: EASE.exit } }}
            className="absolute right-0 top-full z-10 mt-2 max-h-64 w-72 overflow-y-auto rounded-xl border border-room-edge bg-room-floor p-1.5 shadow-xl"
          >
            <p className="px-2.5 py-1.5 text-xs text-room-faint">You liked</p>
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
