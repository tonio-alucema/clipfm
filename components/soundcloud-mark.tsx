/**
 * SoundCloud attribution.
 *
 * Credit, and only credit. The player iframe used to carry this on its own;
 * now that it is out of sight the credit has to be stated deliberately.
 *
 * Deliberately not a link. The button beside the title is the way out to the
 * track, and two controls to the same place a few pixels apart is one control
 * too many — so this stays a mark, and the action stays where it is.
 */

export function SoundCloudMark() {
  return (
    <span className="flex shrink-0 items-center gap-1 text-room-faint">
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
        {/* The cloud, drawn as overlapping forms so it stays solid at 9px. */}
        <circle cx="15.4" cy="7.4" r="4.1" />
        <circle cx="20.6" cy="9" r="3.4" />
        <rect x="11.8" y="8.7" width="12.6" height="3.8" rx="1.9" />
      </svg>
      <span className="text-[8px] font-medium tracking-[0.08em]">SOUNDCLOUD</span>
    </span>
  );
}
