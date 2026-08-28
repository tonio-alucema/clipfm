import { describe, expect, it } from 'vitest';
import { others, parsePresenceState } from './presence';

const entry = (nickname: string, joinedAt: number) => ({ presence_ref: 'ref', nickname, joinedAt });

describe('parsePresenceState', () => {
  it('flattens the channel state into listeners', () => {
    expect(
      parsePresenceState({ a: [entry('quiet hours', 100)], b: [entry('slow tape', 200)] }),
    ).toEqual([
      { id: 'a', nickname: 'quiet hours', joinedAt: 100 },
      { id: 'b', nickname: 'slow tape', joinedAt: 200 },
    ]);
  });

  // A reconnect leaves the previous ref alive for a moment. One person should
  // not briefly become two avatars.
  it('shows a listener once even with several presence refs', () => {
    const parsed = parsePresenceState({ a: [entry('quiet hours', 300), entry('quiet hours', 100)] });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.joinedAt).toBe(100);
  });

  // Ordering by arrival means a new listener lands at the end instead of
  // pushing everyone else sideways once these are animated.
  it('orders by arrival, with a stable tiebreak', () => {
    const parsed = parsePresenceState({
      late: [entry('late', 300)],
      early: [entry('early', 100)],
      mid: [entry('mid', 200)],
    });
    expect(parsed.map((l) => l.id)).toEqual(['early', 'mid', 'late']);
  });

  it('breaks ties on id so the order never flickers', () => {
    const parsed = parsePresenceState({ b: [entry('b', 100)], a: [entry('a', 100)] });
    expect(parsed.map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('ignores entries it cannot make sense of', () => {
    expect(
      parsePresenceState({
        ok: [entry('fine', 100)],
        empty: [],
        notAnArray: entry('x', 1),
        noNickname: [{ joinedAt: 1 }],
        noJoinedAt: [{ nickname: 'x' }],
        junk: [null, 'nope', 7],
      }),
    ).toEqual([{ id: 'ok', nickname: 'fine', joinedAt: 100 }]);
  });

  it('returns nothing for an empty or malformed room', () => {
    expect(parsePresenceState({})).toEqual([]);
    expect(parsePresenceState(null)).toEqual([]);
    expect(parsePresenceState('nobody')).toEqual([]);
  });
});

describe('others', () => {
  it('leaves you out of the room you are in', () => {
    const room = parsePresenceState({ me: [entry('me', 1)], you: [entry('you', 2)] });
    expect(others(room, 'me').map((l) => l.id)).toEqual(['you']);
    expect(others(room, 'nobody')).toHaveLength(2);
  });
});
