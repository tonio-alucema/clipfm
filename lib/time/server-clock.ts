/**
 * Agreeing with the server's clock.
 *
 * The client's own clock can be minutes wrong, so the scheduler is never given
 * `Date.now()`. Instead we measure the offset to the server once, then track
 * elapsed time with `performance.now()`, which is monotonic and unaffected by
 * the system clock being corrected, the machine sleeping, or a timezone
 * change mid-session.
 */

import { CLOCK_SAMPLE_COUNT } from '../config/sync';

export type TimeSample = {
  /** The server's clock, as reported. */
  serverMs: number;
  /** `performance.now()` immediately before the request went out. */
  sentAtPerfMs: number;
  /** `performance.now()` immediately after the reply came back. */
  receivedAtPerfMs: number;
};

export type ClockOffset = {
  serverAtSyncMs: number;
  perfAtSyncMs: number;
  /** Round trip of the winning sample — the confidence interval, roughly. */
  rttMs: number;
};

/**
 * Assume the server read its clock at the midpoint of the round trip. That is
 * wrong by however asymmetric the network path was, which is why we take
 * several samples and keep the fastest.
 */
export function toOffset(sample: TimeSample): ClockOffset {
  return {
    serverAtSyncMs: sample.serverMs,
    perfAtSyncMs: (sample.sentAtPerfMs + sample.receivedAtPerfMs) / 2,
    rttMs: sample.receivedAtPerfMs - sample.sentAtPerfMs,
  };
}

/**
 * The lowest-RTT sample is the least contaminated by queueing in one
 * direction, which is the trick NTP uses.
 */
export function bestOffset(samples: readonly TimeSample[]): ClockOffset | null {
  let best: TimeSample | null = null;
  for (const sample of samples) {
    const rtt = sample.receivedAtPerfMs - sample.sentAtPerfMs;
    if (!Number.isFinite(rtt) || rtt < 0) continue;
    if (best === null || rtt < best.receivedAtPerfMs - best.sentAtPerfMs) best = sample;
  }
  return best === null ? null : toOffset(best);
}

/** The server's clock as of `perfNowMs`. This is `serverNow()`. */
export function serverNowFrom(offset: ClockOffset, perfNowMs: number): number {
  return offset.serverAtSyncMs + (perfNowMs - offset.perfAtSyncMs);
}

async function fetchServerMs(): Promise<number> {
  const response = await fetch('/api/time', { cache: 'no-store' });
  if (!response.ok) throw new Error(`/api/time responded ${response.status}`);
  const body: unknown = await response.json();
  const now = (body as { now?: unknown }).now;
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new Error('/api/time returned no usable timestamp');
  }
  return now;
}

export type MeasureOptions = {
  sampleCount?: number;
  fetchServer?: () => Promise<number>;
  perfNow?: () => number;
};

/** Samples the server clock a few times and keeps the best reading. */
export async function measureServerClock(
  options: MeasureOptions = {},
): Promise<ClockOffset | null> {
  const sampleCount = options.sampleCount ?? CLOCK_SAMPLE_COUNT;
  const fetchServer = options.fetchServer ?? fetchServerMs;
  const perfNow = options.perfNow ?? (() => performance.now());

  const samples: TimeSample[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const sentAtPerfMs = perfNow();
    try {
      const serverMs = await fetchServer();
      samples.push({ serverMs, sentAtPerfMs, receivedAtPerfMs: perfNow() });
    } catch {
      // One failed round trip is not fatal; the best of the rest still works.
    }
  }
  return bestOffset(samples);
}
