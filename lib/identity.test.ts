import { describe, expect, it } from 'vitest';
import { deterministicUuid, normalizeNickname, parseListener, randomNickname } from './identity';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('deterministicUuid', () => {
  // listener_id is a uuid column, so a readable id like "debug-alpha" is
  // rejected outright — which is how debug listeners silently failed to
  // favourite anything.
  it('produces a well-formed v4-shaped uuid', () => {
    for (const seed of ['alpha', 'beta', '', 'a much longer seed 🎧']) {
      expect(deterministicUuid(seed)).toMatch(UUID);
    }
  });

  it('is stable for a seed, so a reload keeps the same listener', () => {
    expect(deterministicUuid('alpha')).toBe(deterministicUuid('alpha'));
  });

  it('separates seeds', () => {
    const ids = ['alpha', 'beta', 'gamma', 'delta'].map(deterministicUuid);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('parseListener', () => {
  it('reads a stored listener', () => {
    expect(parseListener('{"id":"abc","nickname":"quiet hours"}')).toEqual({
      id: 'abc',
      nickname: 'quiet hours',
    });
  });

  it('returns null for anything that is not one', () => {
    expect(parseListener(null)).toBeNull();
    expect(parseListener('not json')).toBeNull();
    expect(parseListener('null')).toBeNull();
    expect(parseListener('{"id":"abc"}')).toBeNull();
    expect(parseListener('{"nickname":"x"}')).toBeNull();
    expect(parseListener('{"id":"","nickname":"x"}')).toBeNull();
  });
});

describe('normalizeNickname', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeNickname('  slow   tape  ')).toBe('slow tape');
  });

  it('bounds the length, because a nickname is a label', () => {
    expect(normalizeNickname('x'.repeat(60))).toHaveLength(24);
  });
});

describe('randomNickname', () => {
  it('is two words, drawn from the lists', () => {
    expect(randomNickname(() => 0)).toBe('quiet hours');
    expect(randomNickname(() => 0.999)).toMatch(/^\w+ \w+$/);
  });
});
