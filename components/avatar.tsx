'use client';

/**
 * A listener in the room.
 *
 * Two animation systems, deliberately separated by a DOM node:
 *
 *   motion.li   Framer Motion — arrival, departure, and the layout shift as
 *               everyone makes room.
 *   div ref     GSAP — the idle bob, which runs forever and is nobody else's
 *               business.
 *
 * They never drive the same element. Sharing one would mean two libraries
 * fighting over a transform, which does not fail loudly — it just goes subtly
 * wrong forever.
 */

import { motion } from 'framer-motion';
import gsap from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { AvatarFace } from '@/components/avatar-face';
import { DURATION, EASE, IDLE_BOB, SPRING, jitter } from '@/lib/motion';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export type AvatarProps = {
  id: string;
  nickname: string;
  isSelf?: boolean;
  /**
   * Only ever passed for your own avatar. Renaming is done by clicking your
   * own name, where the name is — not in a settings line somewhere else on the
   * page describing who you are.
   */
  onRename?: (nickname: string) => void;
};

export function Avatar({ id, nickname, isSelf = false, onRename }: AvatarProps) {
  const bobRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nickname);

  useEffect(() => {
    const element = bobRef.current;
    if (element === null || prefersReducedMotion()) return;

    // Phase and period both vary per avatar. Phase alone is not enough: a room
    // that starts out of step still converges if everyone shares a period, and
    // twelve avatars breathing in unison reads as a broken loop, not as life.
    const period = IDLE_BOB.period + jitter(`${id}~period`, IDLE_BOB.periodSpread);
    const bobPhase = jitter(`${id}~phase`, IDLE_BOB.phaseSpread);
    const swayPhase = jitter(`${id}~sway`, IDLE_BOB.phaseSpread);

    const context = gsap.context(() => {
      const bob = gsap.to(element, {
        y: -IDLE_BOB.amplitude,
        duration: period / 2,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      });
      // A sway on a different period, so the path is a slow wander rather than
      // a lift. Deliberately not a round multiple of the bob.
      const sway = gsap.to(element, {
        x: IDLE_BOB.swayAmplitude,
        duration: period * 0.81,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      });
      bob.seek(bobPhase);
      sway.seek(swayPhase);
    }, element);

    return () => context.revert();
  }, [id]);

  return (
    <motion.li
      layout
      transition={SPRING.layout}
      initial={{ opacity: 0, scale: 0.6, y: 14 }}
      animate={{
        opacity: 1,
        scale: 1,
        y: 0,
        transition: { ...SPRING.arrive, opacity: { duration: DURATION.quick, ease: EASE.enter } },
      }}
      exit={{
        opacity: 0,
        scale: 0.6,
        y: 14,
        transition: { duration: DURATION.quick, ease: EASE.exit },
      }}
      style={{
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.4rem',
        width: '5.6rem',
      }}
    >
      <div ref={bobRef}>
        <AvatarFace id={id} title={nickname} />
      </div>
      {editing && onRename !== undefined ? (
        <input
          autoFocus
          value={draft}
          maxLength={24}
          aria-label="your name"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            onRename(draft);
            setEditing(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setDraft(nickname);
              setEditing(false);
            }
          }}
          className="w-full rounded-md border border-room-edge bg-room-floor px-1 py-0.5 text-center text-[0.8rem] text-room-ink"
        />
      ) : (
        <button
          type="button"
          disabled={onRename === undefined}
          onClick={() => {
            setDraft(nickname);
            setEditing(true);
          }}
          style={{
            fontSize: '0.8rem',
            opacity: isSelf ? 1 : 0.7,
            fontWeight: isSelf ? 600 : 400,
            textAlign: 'center',
            lineHeight: 1.2,
            maxWidth: '100%',
            overflowWrap: 'anywhere',
            // Only your own name invites a click, so only it looks clickable.
            cursor: onRename === undefined ? 'default' : 'text',
            textDecoration: onRename === undefined ? 'none' : 'underline',
            textDecorationStyle: 'dotted',
            textUnderlineOffset: '3px',
            textDecorationColor: 'var(--color-room-faint)',
          }}
        >
          {nickname}
        </button>
      )}

      {/* The slot is reserved on every avatar, not only yours. The row is
          bottom-aligned, so a line that exists on one avatar and not the
          others would lift yours out of step with the room. */}
      <span
        className="h-3 text-[0.6rem] leading-3 text-room-faint"
        style={{ pointerEvents: 'none' }}
      >
        {isSelf ? '(you)' : ''}
      </span>
    </motion.li>
  );
}
