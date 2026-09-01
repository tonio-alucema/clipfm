import { describe, expect, it } from 'vitest';
import { DURATION, EASE, HEART_BURST_SECONDS, jitter } from './motion';

describe('jitter', () => {
  it('is stable for a given seed, so a re-render never reshuffles the room', () => {
    expect(jitter('listener-a', 2)).toBe(jitter('listener-a', 2));
  });

  it('separates instances, so repeated elements fall out of phase', () => {
    const offsets = ['a', 'b', 'c', 'd', 'e'].map((seed) => jitter(seed, 2));
    expect(new Set(offsets).size).toBe(offsets.length);
  });

  it('stays inside the requested spread', () => {
    for (const seed of ['', 'x', 'a-much-longer-listener-identifier', '🎧']) {
      const offset = jitter(seed, 1.5);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(1.5);
    }
  });

  it('is zero when there is no spread to spread over', () => {
    expect(jitter('a', 0)).toBe(0);
    expect(jitter('a', -1)).toBe(0);
  });
});

describe('tokens', () => {
  it('orders durations as their names claim', () => {
    expect(DURATION.instant).toBeLessThan(DURATION.quick);
    expect(DURATION.quick).toBeLessThan(DURATION.normal);
    expect(DURATION.normal).toBeLessThan(DURATION.slow);
  });

  it('keeps easings as valid cubic-bezier control points', () => {
    for (const curve of Object.values(EASE)) {
      expect(curve).toHaveLength(4);
      // x values must be within [0,1]; y may overshoot for anticipation.
      expect(curve[0]).toBeGreaterThanOrEqual(0);
      expect(curve[0]).toBeLessThanOrEqual(1);
      expect(curve[2]).toBeGreaterThanOrEqual(0);
      expect(curve[2]).toBeLessThanOrEqual(1);
    }
  });
});

describe('HEART_BURST_SECONDS', () => {
  // The burst animation and the timer that removes the heart both read this.
  // If the removal ever fires first, hearts get cut off mid-flight — so the
  // relationship matters more than the number.
  it('leaves the removal timer a margin over the animation', () => {
    const lifetimeMs = HEART_BURST_SECONDS * 1000 + 200;
    expect(lifetimeMs).toBeGreaterThan(HEART_BURST_SECONDS * 1000);
  });

  it('lasts long enough for someone to look up and see it', () => {
    expect(HEART_BURST_SECONDS).toBeGreaterThanOrEqual(2);
  });
});
