'use client';

/**
 * Avatar gallery.
 *
 * A room of strangers, at a size where their faces can actually be judged.
 * Every one is generated from an id, so this is also the check that the space
 * of faces is wide enough that a dozen listeners look like a dozen people.
 */

import { Avatar } from '@/components/avatar';
import { AvatarFace } from '@/components/avatar-face';

const NAMES = [
  'quiet hours', 'slow tape', 'warm static', 'late echo', 'soft drift',
  'dim signal', 'far radio', 'deep moth', 'idle ember', 'low tide',
  'blue lamp', 'lone fog', 'still orbit', 'faint wire', 'dusk room',
];

export default function AvatarGallery() {
  return (
    <main>
      <h1>Avatar gallery</h1>
      <p>
        <small>Generated from ids. Everything moves — the bob is per-avatar out of phase.</small>
      </p>

      <h2>At room size, bobbing</h2>
      <ul
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: '1.1rem',
          padding: 0,
          margin: 0,
        }}
      >
        {NAMES.map((name) => (
          <Avatar key={name} id={`gallery:${name}`} nickname={name} />
        ))}
      </ul>

      <h2>Large, still</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'flex-end' }}>
        {NAMES.slice(0, 8).map((name) => (
          <AvatarFace key={name} id={`gallery:${name}`} size={130} title={name} />
        ))}
      </div>
    </main>
  );
}
