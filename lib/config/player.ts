/** Tunables for the player wrapper. Nothing here is inlined at a call site. */

/**
 * How long to wait for a track to settle after `load()` before treating it as
 * unavailable. A track that will not embed off-platform, or one that has been
 * taken down, often produces no callback at all rather than an error.
 */
export const LOAD_TIMEOUT_MS = 10_000;

/**
 * Playback is considered stalled if we asked to play and this long has passed
 * without a progress event. Drift measured during a stall is meaningless, and
 * correcting it makes the stall worse.
 */
export const STALL_AFTER_MS = 2_000;

/** How often the stall watchdog checks. */
export const STALL_POLL_MS = 500;

/**
 * Seed-time playability verification.
 *
 * Metadata does not predict playability. A track can report `streamable: true`,
 * `embeddable_by: "all"`, a real duration, and load perfectly on its own, and
 * still refuse to play inside a set — observed with a track that either got
 * skipped straight past or ignored the skip entirely.
 *
 * An unplayable track in a schedule breaks the room permanently: the widget
 * drops it, the sync loop fights to restore it, and the listener hears a
 * different song while the interface names the scheduled one. So each track is
 * actually driven before it is allowed into a snapshot.
 */

/** How long to let a skip settle before asking where the widget ended up. */
export const VERIFY_SETTLE_MS = 2_000;

/** How long to watch the position, to catch a track that loads but never streams. */
export const VERIFY_ADVANCE_MS = 1_200;
