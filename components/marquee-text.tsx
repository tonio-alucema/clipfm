'use client';

/**
 * Text that scrolls itself when it does not fit.
 *
 * Only when it does not fit: a title that already fits must sit still, or the
 * room develops a twitch. And it travels at a fixed rate rather than over a
 * fixed duration, so a very long title and a barely-overflowing one move at
 * the same readable pace.
 *
 * GSAP, because this is a sequence — hold, travel, hold, return — and that is
 * the division of labour: Framer Motion owns enter, exit and layout, GSAP owns
 * choreography. The element below is GSAP's alone.
 */

import gsap from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { MARQUEE } from '@/lib/motion';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export type MarqueeTextProps = {
  text: string;
  className?: string;
};

export function MarqueeText({ text, className }: MarqueeTextProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  /** Only used to fall back to an ellipsis when nothing is going to move. */
  const [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    const element = textRef.current;
    if (frame === null || element === null) return;

    let context: gsap.Context | null = null;

    const measure = () => {
      context?.revert();
      context = null;
      gsap.set(element, { x: 0 });

      const overflow = element.scrollWidth - frame.clientWidth;
      // A pixel or two of overflow is a rounding artefact, not a long title.
      if (overflow <= 2 || prefersReducedMotion()) {
        setScrolling(false);
        return;
      }
      setScrolling(true);

      const travel = overflow / MARQUEE.speed;
      context = gsap.context(() => {
        gsap
          .timeline({ repeat: -1 })
          .to(element, { x: -overflow, duration: travel, ease: MARQUEE.ease, delay: MARQUEE.hold })
          .to(element, { x: 0, duration: travel, ease: MARQUEE.ease, delay: MARQUEE.hold });
      }, element);
    };

    measure();

    // The same title overflows or does not depending on the width available.
    const observer = new ResizeObserver(measure);
    observer.observe(frame);

    return () => {
      observer.disconnect();
      context?.revert();
    };
  }, [text]);

  return (
    <div ref={frameRef} className={`overflow-hidden ${className ?? ''}`}>
      <span
        ref={textRef}
        className={`block whitespace-nowrap ${scrolling ? '' : 'overflow-hidden text-ellipsis'}`}
      >
        {text}
      </span>
    </div>
  );
}
