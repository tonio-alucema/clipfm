'use client';

/**
 * Out to the track, on SoundCloud.
 *
 * Sits beside the heart because both are things you do about what is playing,
 * rather than things the room tells you. Deliberately not dimmed while tuned
 * out: you can look a track up without listening to it, and a dimmed control
 * reads as disabled.
 */

import { motion } from 'framer-motion';
import { SPRING } from '@/lib/motion';

export type TrackLinkProps = {
  /** The track playing right now. Null when nothing is. */
  href: string | null;
};

export function TrackLink({ href }: TrackLinkProps) {
  // Nothing playing, nowhere to go. An anchor with no destination is a dead
  // control that still looks live.
  if (href === null) return null;

  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      whileTap={{ scale: 0.88 }}
      transition={SPRING.arrive}
      aria-label="Open this track on SoundCloud in a new tab"
      className="flex shrink-0 items-center rounded-full border border-room-edge p-2 text-room-dim"
    >
      {/* h-5 matches the heart's content box — its row is as tall as the
          text beside its icon, not as tall as the icon alone. Without this
          the two pills sit at different heights. */}
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
  );
}
