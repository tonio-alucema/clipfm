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

/**
 * Flat bottom, semicircular top. Width 115, height 104, radius 57.5.
 *
 * Slightly wider than tall. The arch dominates and the straight sides are a
 * skirt beneath it; the face sits in the widest part rather than below it.
 */
const WIDTH = 115;
const HEIGHT = 104;
const DOME = `M0,${HEIGHT} L0,57.5 A57.5,57.5 0 0 1 ${WIDTH},57.5 L${WIDTH},${HEIGHT} Z`;

// High in the arch, where the shape is widest, with a generous skirt beneath.
// Pushed lower and the face reads as sliding off its own chin.
const EYE_Y = 56;
const EYE_X = 37;
const MOUTH_Y = 75;

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
      ? 'M-7,-7 L122,-7 L122,19 C101,25 91,13 72,21 C59,28 49,18 36,28 C24,36 9,31 -7,44 Z'
      : 'M-7,-7 L122,-7 L122,11 C95,19 79,10 61,18 C45,25 29,13 -7,25 Z';
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
      ? `M42,${MOUTH_Y} Q57.5,${MOUTH_Y + 4} 73,${MOUTH_Y - 2}`
      : `M41,${MOUTH_Y - 1} Q57.5,${MOUTH_Y + 7} 74,${MOUTH_Y - 1}`;
  return (
    <path
      d={d}
      stroke="white"
      strokeWidth={4.5}
      strokeLinecap="round"
      fill="none"
      transform={`rotate(${tilt} 57.5 ${MOUTH_Y})`}
    />
  );
}

export type AvatarFaceProps = {
  id: string;
  size?: number;
  title?: string;
};

export function AvatarFace({ id, size = 74, title }: AvatarFaceProps) {
  // Two hues rather than one, so the fill is a gradient with somewhere to go.
  const hue = Math.floor(jitter(id, 360));
  const hueShift = Math.floor(jitter(`${id}~shift`, 150)) - 60;
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  const gradientId = `avatar-grad-${safeId}`;
  const clipId = `avatar-clip-${safeId}`;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={size}
      height={(size * HEIGHT) / WIDTH}
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
      <Eye x={WIDTH - EYE_X} style={pick(EYE_STYLES, `${id}~eyes`)} />
      <Mouth style={pick(MOUTH_STYLES, `${id}~mouth`)} />
    </svg>
  );
}
