'use client';

/**
 * Out to the track, on SoundCloud.
 *
 * Sits beside the title because it points at this track specifically.
 * Deliberately not dimmed while tuned out: you can look a track up without
 * listening to it, and a dimmed control reads as disabled.
 *
 * The label appears on hover and on focus, not hover alone — a control that
 * only explains itself to a mouse leaves keyboard users guessing.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { DURATION, EASE, SPRING } from '@/lib/motion';

export type TrackLinkProps = {
  /** The track playing right now. Null when nothing is. */
  href: string | null;
};

const LABEL = 'go to track on soundcloud';

export function TrackLink({ href }: TrackLinkProps) {
  const [showing, setShowing] = useState(false);

  // Nothing playing, nowhere to go. An anchor with no destination is a dead
  // control that still looks live.
  if (href === null) return null;

  return (
    <span className="relative flex shrink-0 items-center">
      <motion.a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        whileTap={{ scale: 0.88 }}
        transition={SPRING.arrive}
        aria-label={LABEL}
        onHoverStart={() => setShowing(true)}
        onHoverEnd={() => setShowing(false)}
        onFocus={() => setShowing(true)}
        onBlur={() => setShowing(false)}
        className="flex shrink-0 items-center rounded-full border border-room-edge p-2 text-room-dim"
      >
        {/* h-5 matches the heart's content box — its row is as tall as the
            text beside its icon, not as tall as the icon alone. */}
        <span className="flex h-5 items-center">
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
            style={{ display: 'block' }}
          >
            <path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
          </svg>
        </span>
      </motion.a>

      <AnimatePresence>
        {showing && (
          <motion.span
            // Already announced by aria-label; a second copy would be read twice.
            aria-hidden
            initial={{ opacity: 0, y: -4 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: { duration: DURATION.quick, ease: EASE.enter },
            }}
            exit={{
              opacity: 0,
              y: -4,
              transition: { duration: DURATION.instant, ease: EASE.exit },
            }}
            // Anchored right so it grows inward — it sits at the edge of the
            // page and would otherwise run off it.
            className="pointer-events-none absolute right-0 top-full z-10 mt-1.5 whitespace-nowrap rounded-md border border-room-edge bg-room-floor px-2 py-1 text-[10px] text-room-dim shadow-lg"
          >
            {LABEL}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
