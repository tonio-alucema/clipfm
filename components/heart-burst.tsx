'use client';

/**
 * A heart, thrown.
 *
 * Purely ephemeral: a burst is broadcast, never stored, and nobody arriving
 * later sees one that has already happened. That is the point — it is a
 * gesture, not a record.
 *
 * It rises from the avatar of whoever threw it, found by presence id at the
 * moment it appears. Measured rather than computed: the row wraps, avatars
 * arrive and leave, and anything derived from an index would point at the
 * wrong person the moment the room changed size.
 *
 * Per-instance variation is seeded off the burst id, so a rerender never
 * makes a heart jump sideways mid-flight.
 */

import { motion } from 'framer-motion';
import { useLayoutEffect, useRef, useState } from 'react';
import { EASE, HEART_BURST_SECONDS, jitter } from '@/lib/motion';

export type HeartBurstProps = {
  id: string;
  /** Whose heart it is. Matched against `data-listener` on the avatars. */
  listenerId: string;
  /**
   * Where it starts if that avatar cannot be found — someone who left mid
   * throw, or a burst that arrived before presence caught up. A heart with
   * nobody to come from still beats no heart at all.
   */
  fallbackOrigin: number;
};

type Origin = { leftPercent: number; topPx: number | null };

export function HeartBurst({ id, listenerId, fallbackOrigin }: HeartBurstProps) {
  // Two independent offsets from one id, so drift and rotation do not correlate.
  const drift = jitter(id, 48) - 24;
  const tilt = jitter(`${id}~tilt`, 40) - 20;
  const scale = 0.85 + jitter(`${id}~scale`, 0.5);

  const ref = useRef<HTMLSpanElement | null>(null);
  const [origin, setOrigin] = useState<Origin>({
    leftPercent: fallbackOrigin * 100,
    topPx: null,
  });

  // Layout effect, not effect: this runs before paint, so the heart is never
  // seen at the fallback position and then snapped to the avatar.
  useLayoutEffect(() => {
    const container = ref.current?.offsetParent;
    if (!(container instanceof HTMLElement)) return;

    const avatar = container.querySelector(`[data-listener="${CSS.escape(listenerId)}"]`);
    if (!(avatar instanceof HTMLElement)) return;

    const box = container.getBoundingClientRect();
    const from = avatar.getBoundingClientRect();
    if (box.width === 0) return;

    setOrigin({
      leftPercent: ((from.left + from.width / 2 - box.left) / box.width) * 100,
      // From the top of the head rather than the feet, so it reads as thrown
      // rather than as rising out of the floor.
      topPx: from.top - box.top,
    });
  }, [listenerId]);

  return (
    <motion.span
      ref={ref}
      aria-hidden
      initial={{ opacity: 0, y: 0, x: 0, scale: 0.4, rotate: 0 }}
      animate={{
        opacity: [0, 1, 1, 0],
        y: -90,
        x: drift,
        scale,
        rotate: tilt,
        // Decelerating, not accelerating. A heart is a thing leaving, which
        // normally argues for EASE.exit — but over this long an accelerating
        // curve reads as hanging still and then darting off. Rising quickly
        // and settling into a drift is what a released thing actually does.
        //
        // The opacity stops are pulled earlier so the burst still appears at
        // once: it fades in over ~0.14s and spends the rest of its life
        // fading out.
        transition: {
          duration: HEART_BURST_SECONDS,
          ease: EASE.enter,
          times: [0, 0.06, 0.55, 1],
        },
      }}
      style={{
        position: 'absolute',
        left: `${origin.leftPercent}%`,
        // Falls back to the floor of the room when there is no avatar to
        // leave from.
        ...(origin.topPx === null ? { bottom: 0 } : { top: origin.topPx }),
        fontSize: '1.4rem',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      ♥
    </motion.span>
  );
}
