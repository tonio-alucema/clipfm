/**
 * A listener's face.
 *
 * Pure SVG, no motion — everything that moves lives in the component that
 * wraps this, so GSAP and Framer Motion never reach the same node.
 *
 * Every choice here is derived from the listener id rather than random: the
 * same person is the same face across reloads, across tabs, and to everyone
 * else in the room. That is the entire point of an avatar.
 */

import { jitter } from '@/lib/motion';

/** Flat bottom, semicircular top. Width 100, height 116, radius 50. */
const DOME = 'M0,116 L0,50 A50,50 0 0 1 100,50 L100,116 Z';

// Features sit in the lower middle with room to breathe beneath them. Pushed
// much lower and the face reads as sliding off its own chin.
const EYE_Y = 68;
const EYE_X = 32;
const MOUTH_Y = 88;

const EYE_STYLES = ['dots', 'dashes', 'happy'] as const;
const MOUTH_STYLES = ['none', 'smile', 'wry'] as const;
// A third of the room, roughly. Hair is what makes the ones who have it
// recognisable, and everyone having it defeats that.
const HAIR_STYLES = ['none', 'none', 'none', 'none', 'fringe', 'tuft'] as const;

type EyeStyle = (typeof EYE_STYLES)[number];
type MouthStyle = (typeof MOUTH_STYLES)[number];
type HairStyle = (typeof HAIR_STYLES)[number];

function pick<T>(options: readonly T[], seed: string): T {
  return options[Math.floor(jitter(seed, options.length))] ?? options[0]!;
}

function Eye({ x, style }: { x: number; style: EyeStyle }) {
  if (style === 'dots') return <circle cx={x} cy={EYE_Y} r={5.5} fill="white" />;
  if (style === 'dashes') {
    return <rect x={x - 7} y={EYE_Y - 2} width={14} height={4.5} rx={2.25} fill="white" />;
  }
  // Closed and content: a shallow cup.
  return (
    <path
      d={`M${x - 7},${EYE_Y - 1.5} Q${x},${EYE_Y + 5} ${x + 7},${EYE_Y - 1.5}`}
      stroke="white"
      strokeWidth={4.5}
      strokeLinecap="round"
      fill="none"
    />
  );
}

/**
 * Hair, clipped to the dome so it stays attached however the shape is drawn.
 *
 * Both shapes are deliberately asymmetric — swept low on one side and high on
 * the other. A symmetric band with a wavy hem reads as a helmet rather than as
 * a haircut, which is the difference between a character and a mascot.
 */
function Hair({ style, clipId }: { style: HairStyle; clipId: string }) {
  if (style === 'none') return null;
  const d =
    style === 'fringe'
      ? 'M-6,-6 L106,-6 L106,21 C88,27 79,15 63,24 C51,31 43,20 31,31 C21,40 8,35 -6,49 Z'
      : 'M-6,-6 L106,-6 L106,13 C83,21 69,11 53,20 C39,28 25,15 -6,28 Z';
  return (
    <g clipPath={`url(#${clipId})`}>
      <path d={d} fill="hsl(24 30% 15%)" />
    </g>
  );
}

function Mouth({ style }: { style: MouthStyle }) {
  if (style === 'none') return null;
  const tilt = style === 'wry' ? -11 : 0;
  // Shallow. A deep curve stops reading as contentment and starts reading as
  // a cartoon.
  const d =
    style === 'wry'
      ? `M37,${MOUTH_Y} Q50,${MOUTH_Y + 4} 63,${MOUTH_Y - 2}`
      : `M36,${MOUTH_Y - 1} Q50,${MOUTH_Y + 7} 64,${MOUTH_Y - 1}`;
  return (
    <path
      d={d}
      stroke="white"
      strokeWidth={4.5}
      strokeLinecap="round"
      fill="none"
      transform={`rotate(${tilt} 50 ${MOUTH_Y})`}
    />
  );
}

export type AvatarFaceProps = {
  id: string;
  size?: number;
  title?: string;
};

export function AvatarFace({ id, size = 64, title }: AvatarFaceProps) {
  // Two hues rather than one, so the fill is a gradient with somewhere to go.
  const hue = Math.floor(jitter(id, 360));
  const hueShift = Math.floor(jitter(`${id}~shift`, 150)) - 60;
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  const gradientId = `avatar-grad-${safeId}`;
  const clipId = `avatar-clip-${safeId}`;

  return (
    <svg
      viewBox="0 0 100 116"
      width={size}
      height={(size * 116) / 100}
      role={title === undefined ? 'presentation' : 'img'}
      aria-label={title}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`hsl(${hue} 62% 58%)`} />
          <stop offset="100%" stopColor={`hsl(${hue + hueShift} 66% 46%)`} />
        </linearGradient>
        <clipPath id={clipId}>
          <path d={DOME} />
        </clipPath>
      </defs>
      <path d={DOME} fill={`url(#${gradientId})`} />
      <Hair style={pick(HAIR_STYLES, `${id}~hair`)} clipId={clipId} />
      <Eye x={EYE_X} style={pick(EYE_STYLES, `${id}~eyes`)} />
      <Eye x={100 - EYE_X} style={pick(EYE_STYLES, `${id}~eyes`)} />
      <Mouth style={pick(MOUTH_STYLES, `${id}~mouth`)} />
    </svg>
  );
}
