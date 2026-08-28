import { describe, expect, it } from 'vitest';
import {
  bestOffset,
  measureServerClock,
  serverNowFrom,
  toOffset,
  type TimeSample,
} from './server-clock';

const sample = (serverMs: number, sentAtPerfMs: number, receivedAtPerfMs: number): TimeSample => ({
  serverMs,
  sentAtPerfMs,
  receivedAtPerfMs,
});

describe('toOffset', () => {
  it('assumes the server read its clock at the midpoint of the round trip', () => {
    expect(toOffset(sample(1_000_000, 100, 140))).toEqual({
      serverAtSyncMs: 1_000_000,
      perfAtSyncMs: 120,
      rttMs: 40,
    });
  });
});

describe('bestOffset', () => {
  it('keeps the lowest-RTT sample, not the newest', () => {
    const offset = bestOffset([
      sample(1_000_000, 0, 400),
      sample(1_000_150, 500, 520),
      sample(1_000_400, 900, 1_100),
    ]);
    expect(offset).toEqual({ serverAtSyncMs: 1_000_150, perfAtSyncMs: 510, rttMs: 20 });
  });

  it('is null when there is nothing usable', () => {
    expect(bestOffset([])).toBeNull();
  });

  it('discards impossible round trips rather than trusting them', () => {
    const offset = bestOffset([
      sample(1_000_000, 500, 100), // negative
      sample(1_000_000, 0, Number.NaN),
      sample(1_000_050, 200, 260),
    ]);
    expect(offset).toEqual({ serverAtSyncMs: 1_000_050, perfAtSyncMs: 230, rttMs: 60 });
  });
});

describe('serverNowFrom', () => {
  const offset = { serverAtSyncMs: 1_000_000, perfAtSyncMs: 500, rttMs: 20 };

  it('advances with the monotonic clock', () => {
    expect(serverNowFrom(offset, 500)).toBe(1_000_000);
    expect(serverNowFrom(offset, 3_500)).toBe(1_003_000);
  });

  // The whole reason for tracking performance.now() rather than re-reading
  // Date.now(): a system clock correction mid-session must not move playback.
  it('is unaffected by the system clock, having never read it', () => {
    const before = serverNowFrom(offset, 10_000);
    const after = serverNowFrom(offset, 10_000);
    expect(after).toBe(before);
  });
});

describe('measureServerClock', () => {
  it('samples repeatedly and keeps the best', async () => {
    let perf = 0;
    const perfNow = () => (perf += 10);
    const offset = await measureServerClock({
      sampleCount: 3,
      perfNow,
      fetchServer: () => Promise.resolve(5_000),
    });
    expect(offset?.rttMs).toBe(10);
  });

  it('survives a failed round trip', async () => {
    let calls = 0;
    let perf = 0;
    const offset = await measureServerClock({
      sampleCount: 3,
      perfNow: () => (perf += 10),
      fetchServer: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(7_000);
      },
    });
    expect(offset).not.toBeNull();
    expect(offset?.serverAtSyncMs).toBe(7_000);
  });

  it('returns null when every round trip fails', async () => {
    const offset = await measureServerClock({
      sampleCount: 2,
      perfNow: () => 0,
      fetchServer: () => Promise.reject(new Error('offline')),
    });
    expect(offset).toBeNull();
  });
});
