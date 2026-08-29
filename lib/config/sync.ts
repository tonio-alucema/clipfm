/** Every tunable the sync loop has. Nothing here is inlined at a call site. */

/** How often local position is compared against the schedule. */
export const DRIFT_CHECK_INTERVAL_MS = 5_000;

/**
 * Re-seek only past this gap.
 *
 * Deliberately generous. Every correction is a seek, and every seek is an
 * audible glitch — so the room now prefers a listener sitting quietly a
 * fraction of a second out to one being yanked into place. Being roughly in
 * time and smooth beats being exactly in time and stuttering.
 */
export const DRIFT_CORRECTION_THRESHOLD_MS = 2_500;

/**
 * The step 3 pass bar. Distinct from the correction threshold above: this is
 * how far any single client may sit from the schedule for the phase to be
 * considered a success. Two clients at opposite extremes are twice this far
 * apart, which is where the "within ~1 second of each other" goal comes from.
 */
export const DRIFT_PASS_BAR_MS = 1_500;

/** A seek takes time to land. Ignore drift readings during the settle. */
export const SEEK_SETTLE_MS = 1_500;

/** Round trips per clock measurement. The lowest-RTT sample wins. */
export const CLOCK_SAMPLE_COUNT = 5;

/** Re-measure the offset periodically, and on every return to visibility. */
export const CLOCK_RESYNC_INTERVAL_MS = 5 * 60_000;

/**
 * `setTimeout` overflows past 2^31-1 ms and fires immediately. Boundary timers
 * are re-armed rather than trusted with a long delay.
 */
export const MAX_TIMER_MS = 2_147_483_000;

/**
 * A join or a track change needs a second, tighter correction.
 *
 * Loading and seeking take real time, so the first seek lands behind — around
 * 1.7s in local measurement. That is inside DRIFT_CORRECTION_THRESHOLD_MS, so
 * without this a client could settle permanently outside the pass bar and
 * never correct.
 *
 * Correcting hard is acceptable here precisely because a transition is already
 * a discontinuity: nobody notices a seek inside the moment they tuned in, or
 * inside a track change. Mid-song is the case that must stay conservative.
 */
export const JOIN_CORRECTION_THRESHOLD_MS = 700;

/** When the post-transition check runs. Must exceed SEEK_SETTLE_MS. */
export const POST_SEEK_CHECK_MS = SEEK_SETTLE_MS + 250;

/**
 * How soon to retry after the player stalls. Faster than the drift poll,
 * because a stall is silence and the drift poll's job is only to nudge
 * playback that is already running.
 */
export const STALL_RECOVERY_DELAY_MS = 1_000;

/**
 * How many times to retry a stall before giving up.
 *
 * A buffering stall clears in a retry or two. Something else holding the audio
 * — another tab of the same room, since the widget only lets one instance play
 * per browser — never clears, and retrying forever turns it into a fight where
 * each tab preempts the last. Measured 28 corrections in a window that should
 * have needed none.
 */
export const MAX_STALL_RECOVERY_ATTEMPTS = 3;

/**
 * Seek latency compensation.
 *
 * A seek does not land instantly. Between asking and hearing, the schedule has
 * moved on, so the player settles behind by however long that took — measured
 * at roughly 750ms on cellular against 30-60ms on wifi. Correcting does not
 * help, because each correction re-introduces the same lag; a client can sit
 * permanently behind while every individual seek is "accurate".
 *
 * So aim ahead by however late the last seek actually landed.
 */

/** How fast the estimate follows a new sample. Low enough that one stalled
 *  reading cannot throw it. */
export const SEEK_LATENCY_SMOOTHING = 0.35;

/** Nothing beyond this is a seek landing late; it is something else broken. */
export const MAX_SEEK_LATENCY_MS = 3_000;

/** Never aim closer than this to the end of a track — that is the boundary's job. */
export const SEEK_COMPENSATION_MARGIN_MS = 500;

/**
 * Transitions are started early.
 *
 * A track change costs real time: the widget cuts the old track, loads the new
 * one, and starts it at zero. Doing that *at* the boundary means the new track
 * begins late and then has to be seeked forward to catch up — a second
 * interruption, and a second of the wrong part of the song in between.
 *
 * So the transition is armed early by however long one actually takes. Done
 * right, the new track begins at 0:00 at the moment the schedule says it
 * should, and no seek is needed at all.
 *
 * The cost is the tail: the previous track is cut short by the lead. That is a
 * deliberate trade — a fraction of a second off the end of one song, in
 * exchange for hearing the next one's actual opening, in time, without a jump.
 */
export const MAX_TRANSITION_LEAD_MS = 4_000;

/**
 * Never hand over later than this before the boundary, even before anything
 * has been learned.
 *
 * A set player advances by itself when a track ends. Handing over *at* the
 * boundary races that: our skip and the widget's own advance both fire, and we
 * land one track past the one we asked for — playing something the schedule
 * never mentioned while the loop seeks at it once a second trying to correct.
 *
 * Leaving before the outgoing track can end avoids the race entirely, because
 * a track we have already left never reaches its end.
 */
export const MIN_TRANSITION_LEAD_MS = 250;

/**
 * How far off a handover may land before it is worth correcting.
 *
 * Looser than a join, deliberately. A correction here is a second audible
 * interruption moments after the first, and the lead is still converging —
 * being a third of a second out is well inside the sync goal and much less
 * noticeable than the seek that would fix it.
 */
export const BOUNDARY_CORRECTION_THRESHOLD_MS = 1_200;
