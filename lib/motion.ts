/**
 * Motion tokens.
 *
 * Components import from here. No duration or easing is written at a call
 * site, including in prototypes — a one-off value is how a system stops being
 * a system.
 *
 * Seconds, because that is the unit both Framer Motion and GSAP take.
 */

export const DURATION = {
  /** Barely there. State flips that should feel instant but not jarring. */
  instant: 0.12,
  /** Small elements arriving or leaving. */
  quick: 0.22,
  /** The default. Anything the eye should follow. */
  normal: 0.36,
  /** Deliberate — something asking to be noticed. */
  slow: 0.6,
} as const;

export const EASE = {
  /** Symmetric. For things that move without arriving or leaving. */
  standard: [0.4, 0, 0.2, 1],
  /** Decelerating. Things entering should settle, not skid. */
  enter: [0, 0, 0.2, 1],
  /** Accelerating. Things leaving should get out of the way. */
  exit: [0.4, 0, 1, 1],
} as const;

export const SPRING = {
  /** Layout shifts as avatars make room for each other. */
  layout: { type: 'spring', stiffness: 320, damping: 32, mass: 0.9 },
  /** A little overshoot, for arrivals. */
  arrive: { type: 'spring', stiffness: 420, damping: 26, mass: 0.8 },
} as const;

/**
 * How long a heart lives on screen, in seconds.
 *
 * Shared between the burst animation and the code that expires it, so the two
 * cannot drift apart and leave hearts hanging or cut them off mid-flight.
 */
export const HEART_BURST_SECONDS = DURATION.slow * 2;

/**
 * A stable per-instance offset in the range [0, spread).
 *
 * Twelve pills bobbing in unison reads as broken, not alive — so repeated
 * elements need to be out of phase with each other. Derived from the
 * instance's id rather than randomly, so the same listener always gets the
 * same offset and a re-render never reshuffles the room.
 */
export function jitter(seed: string, spread: number): number {
  if (spread <= 0) return 0;
  // FNV-1a. Small, well distributed for short strings, and no dependency.
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash / 0x100000000) * spread;
}
