'use client';

/**
 * A heart, thrown.
 *
 * Purely ephemeral: a burst is broadcast, never stored, and nobody arriving
 * later sees one that has already happened. That is the point — it is a
 * gesture, not a record.
 *
 * Per-instance variation is seeded off the burst id, so a rerender never
 * makes a heart jump sideways mid-flight.
 */

import { motion } from 'framer-motion';
import { EASE, HEART_BURST_SECONDS, jitter } from '@/lib/motion';

export type HeartBurstProps = {
  id: string;
  /** Roughly where along the row it came from, 0–1. */
  origin: number;
};

export function HeartBurst({ id, origin }: HeartBurstProps) {
  // Two independent offsets from one id, so drift and rotation do not correlate.
  const drift = jitter(id, 48) - 24;
  const tilt = jitter(`${id}~tilt`, 40) - 20;
  const scale = 0.85 + jitter(`${id}~scale`, 0.5);

  return (
    <motion.span
      aria-hidden
      initial={{ opacity: 0, y: 0, x: 0, scale: 0.4, rotate: 0 }}
      animate={{
        opacity: [0, 1, 1, 0],
        y: -90,
        x: drift,
        scale,
        rotate: tilt,
        transition: { duration: HEART_BURST_SECONDS, ease: EASE.exit, times: [0, 0.12, 0.6, 1] },
      }}
      style={{
        position: 'absolute',
        left: `${origin * 100}%`,
        bottom: 0,
        fontSize: '1.4rem',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      ♥
    </motion.span>
  );
}
