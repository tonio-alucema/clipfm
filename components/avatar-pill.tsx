'use client';

/**
 * A listener, as a pill.
 *
 * Framer Motion handles enter, exit, and the layout shift as pills make room
 * for each other — GSAP is not involved here and must not be, since the two
 * must never drive the same element. The idle bob at step 7 is GSAP's job, on
 * an inner element.
 *
 * Every duration and easing comes from lib/motion.ts.
 */

import { motion } from 'framer-motion';
import { DURATION, EASE, SPRING, jitter } from '@/lib/motion';

export type AvatarPillProps = {
  id: string;
  nickname: string;
  isSelf?: boolean;
};

/** Enough hues that adjacent listeners rarely collide, seeded off the id. */
function hueFor(id: string): number {
  return Math.floor(jitter(id, 360));
}

export function AvatarPill({ id, nickname, isSelf = false }: AvatarPillProps) {
  const hue = hueFor(id);

  return (
    <motion.li
      layout
      transition={SPRING.layout}
      initial={{ opacity: 0, scale: 0.7, y: 8 }}
      animate={{
        opacity: 1,
        scale: 1,
        y: 0,
        transition: { ...SPRING.arrive, opacity: { duration: DURATION.quick, ease: EASE.enter } },
      }}
      exit={{
        opacity: 0,
        scale: 0.7,
        y: 8,
        transition: { duration: DURATION.quick, ease: EASE.exit },
      }}
      style={{
        listStyle: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.4rem 0.9rem',
        borderRadius: '999px',
        background: `hsl(${hue} 45% 22%)`,
        color: `hsl(${hue} 70% 92%)`,
        border: isSelf ? '2px solid hsl(0 0% 100% / 0.75)' : '2px solid transparent',
        fontSize: '0.95rem',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden
        style={{
          width: '0.5rem',
          height: '0.5rem',
          borderRadius: '999px',
          background: `hsl(${hue} 80% 70%)`,
        }}
      />
      {nickname}
      {isSelf && <span style={{ opacity: 0.65 }}>(you)</span>}
    </motion.li>
  );
}
