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
