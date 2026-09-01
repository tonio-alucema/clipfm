'use client';

/**
 * SoundCloud attribution, horizontal.
 *
 * The player iframe used to carry this on its own. Now that it is out of
 * sight, the credit has to be carried deliberately — so this links out to
 * whatever is actually playing rather than being decoration. The audio comes
 * from SoundCloud and the room should keep saying so.
 */

export type SoundCloudMarkProps = {
  /** Where the sound actually is. Null while nothing is playing. */
  href: string | null;
};

function Mark() {
  return (
    <svg
      viewBox="0 0 26 14"
      height="9"
      width="16.7"
      fill="currentColor"
      aria-hidden
      style={{ display: 'block' }}
    >
      {/* The waveform, shortest to tallest, as the mark has it. */}
      <rect x="0" y="7.2" width="1.4" height="5.3" rx="0.7" />
      <rect x="2.9" y="5.2" width="1.4" height="7.3" rx="0.7" />
      <rect x="5.8" y="3.1" width="1.4" height="9.4" rx="0.7" />
      <rect x="8.7" y="4.6" width="1.4" height="7.9" rx="0.7" />
      {/* The cloud, drawn as overlapping forms so it stays solid at 10px. */}
      <circle cx="15.4" cy="7.4" r="4.1" />
      <circle cx="20.6" cy="9" r="3.4" />
      <rect x="11.8" y="8.7" width="12.6" height="3.8" rx="1.9" />
    </svg>
  );
}

export function SoundCloudMark({ href }: SoundCloudMarkProps) {
  const content = (
    <>
      <Mark />
      <span className="text-[8px] font-medium tracking-[0.08em]">SOUNDCLOUD</span>
    </>
  );

  const shared = 'flex shrink-0 items-center gap-1 text-room-faint';

  // Not a link until there is somewhere to go — an anchor with no href is a
  // dead control, and this one is the attribution.
  if (href === null) {
    return (
      <span className={shared} aria-label="Audio by SoundCloud">
        {content}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label="Listen on SoundCloud"
      className={`${shared} transition-opacity hover:opacity-80`}
    >
      {content}
    </a>
  );
}
