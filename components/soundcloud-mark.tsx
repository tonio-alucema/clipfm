'use client';

/**
 * SoundCloud attribution, and the way out to the track.
 *
 * The player iframe used to carry the credit on its own; now that it is out of
 * sight, the credit has to be stated deliberately. It doubles as the link
 * because a mark that says where the audio comes from is the obvious thing to
 * press when you want to go there — a second button beside it was one control
 * too many.
 */

import { motion } from 'framer-motion';
import { AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { DURATION, EASE, SPRING } from '@/lib/motion';

export type SoundCloudMarkProps = {
  /** The track playing right now. Null while nothing is. */
  href: string | null;
};

const LABEL = 'go to track on soundcloud';

function Mark() {
  return (
    <>
      <svg
        viewBox="0 0 26 14"
        height="9"
        width="16.7"
        fill="currentColor"
        aria-hidden
        style={{ display: 'block' }}
      >
        {/* The waveform, shortest to tallest, as the mark has it. */}
        <rect x="0" y="7.2" width="1.4" height="5.3" rx="0.7" />
        <rect x="2.9" y="5.2" width="1.4" height="7.3" rx="0.7" />
        <rect x="5.8" y="3.1" width="1.4" height="9.4" rx="0.7" />
        <rect x="8.7" y="4.6" width="1.4" height="7.9" rx="0.7" />
        {/* The cloud, drawn as overlapping forms so it stays solid at 9px. */}
        <circle cx="15.4" cy="7.4" r="4.1" />
        <circle cx="20.6" cy="9" r="3.4" />
        <rect x="11.8" y="8.7" width="12.6" height="3.8" rx="1.9" />
      </svg>
      <span className="text-[8px] font-medium tracking-[0.08em]">SOUNDCLOUD</span>
    </>
  );
}

export function SoundCloudMark({ href }: SoundCloudMarkProps) {
  const [showing, setShowing] = useState(false);
  const shared = 'flex shrink-0 items-center gap-1 text-room-faint';

  // Not a link until there is somewhere to go. An anchor with no destination
  // is a dead control that still looks live — but the credit still stands.
  if (href === null) {
    return (
      <span className={shared}>
        <Mark />
      </span>
    );
  }

  return (
    // Focus is handled on the wrapper rather than the anchor. React maps
    // onFocus to focusin, which bubbles, so this hears the anchor being
    // focused without depending on motion.a forwarding the prop.
    <span
      className="relative flex shrink-0 items-center"
      onFocus={() => setShowing(true)}
      onBlur={() => setShowing(false)}
    >
      <motion.a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        whileTap={{ scale: 0.92 }}
        transition={SPRING.arrive}
        aria-label={LABEL}
        onHoverStart={() => setShowing(true)}
        onHoverEnd={() => setShowing(false)}
        className={`${shared} transition-opacity hover:opacity-80`}
      >
        <Mark />
      </motion.a>

      <AnimatePresence>
        {showing && (
          <motion.span
            // Already the anchor's accessible name; a second copy reads twice.
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
