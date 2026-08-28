'use client';

/**
 * The room's single Realtime channel: who is here, and hearts thrown.
 *
 * One channel per room rather than one per concern — Realtime connections are
 * the scarce resource on the free tier, and presence and reactions belong to
 * the same room anyway.
 *
 * Nothing here writes a row. Presence and bursts are both ephemeral: a closed
 * tab leaves no trace, and a heart thrown before you arrived is simply gone.
 * The durable half of a favourite lives in lib/favorites.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from '../db/client';
import type { Listener } from '../identity';
import { HEART_BURST_SECONDS } from '../motion';
import { parsePresenceState, type PresentListener } from './presence';

const HEART_EVENT = 'heart';
/** A little longer than the animation, so nothing is cut off mid-flight. */
const HEART_LIFETIME_MS = HEART_BURST_SECONDS * 1000 + 200;

export type HeartBurstEvent = {
  id: string;
  listenerId: string;
  nickname: string;
  trackUrl: string;
};

function parseHeart(raw: unknown): HeartBurstEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id, listenerId, nickname, trackUrl } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof listenerId !== 'string' || typeof nickname !== 'string') return null;
  if (typeof trackUrl !== 'string') return null;
  return { id, listenerId, nickname, trackUrl };
}

export type PresenceStatus = 'idle' | 'joining' | 'joined' | 'unavailable';

export type UseRoomChannelOptions = {
  roomSlug: string;
  listener: Listener | null;
  /** serverNow, so arrival order agrees across clients with wrong clocks. */
  now: () => number;
};

export function useRoomChannel({ roomSlug, listener, now }: UseRoomChannelOptions) {
  const [listeners, setListeners] = useState<PresentListener[]>([]);
  const [status, setStatus] = useState<PresenceStatus>('idle');
  const [hearts, setHearts] = useState<HeartBurstEvent[]>([]);

  const channelRef = useRef<ReturnType<NonNullable<ReturnType<typeof getSupabase>>['channel']> | null>(null);
  const nicknameRef = useRef(listener?.nickname ?? '');
  /** Captured once, so renaming yourself does not move you in the room. */
  const joinedAtRef = useRef<number | null>(null);

  nicknameRef.current = listener?.nickname ?? '';

  const listenerId = listener?.id ?? null;

  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  const addHeart = useCallback((heart: HeartBurstEvent) => {
    setHearts((previous) => [...previous, heart]);
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      setHearts((previous) => previous.filter((existing) => existing.id !== heart.id));
    }, HEART_LIFETIME_MS);
    timersRef.current.add(timer);
  }, []);

  // Hearts in flight when the component unmounts must not keep timers alive.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    if (supabase === null || listenerId === null) {
      setStatus('unavailable');
      return;
    }

    setStatus('joining');
    const channel = supabase.channel(`room:${roomSlug}`, {
      config: { presence: { key: listenerId } },
    });
    channelRef.current = channel;

    channel.on('presence', { event: 'sync' }, () => {
      setListeners(parsePresenceState(channel.presenceState()));
    });

    channel.on('broadcast', { event: HEART_EVENT }, ({ payload }) => {
      const heart = parseHeart(payload);
      if (heart !== null) addHeart(heart);
    });

    channel.subscribe((subscribeStatus) => {
      if (subscribeStatus === 'SUBSCRIBED') {
        joinedAtRef.current ??= now();
        setStatus('joined');
        void channel.track({
          nickname: nicknameRef.current,
          joinedAt: joinedAtRef.current,
        });
        return;
      }
      if (subscribeStatus === 'CLOSED') setStatus('idle');
      if (subscribeStatus === 'CHANNEL_ERROR' || subscribeStatus === 'TIMED_OUT') {
        setStatus('unavailable');
      }
    });

    return () => {
      channelRef.current = null;
      void channel.unsubscribe();
    };
  }, [roomSlug, listenerId, now]);

  /**
   * Throw a heart.
   *
   * The local burst is added before anything leaves the machine, because this
   * is the one interaction that must feel instant — a listener should never
   * wait on a round trip to see their own heart. Broadcast does not echo to
   * the sender, so this is the only way we see our own.
   */
  const sendHeart = useCallback(
    (trackUrl: string) => {
      if (listener === null) return null;
      const heart: HeartBurstEvent = {
        id: crypto.randomUUID(),
        listenerId: listener.id,
        nickname: listener.nickname,
        trackUrl,
      };
      addHeart(heart);
      void channelRef.current?.send({ type: 'broadcast', event: HEART_EVENT, payload: heart });
      return heart;
    },
    [addHeart, listener],
  );

  /** Re-announce a renamed listener without rejoining, so they keep their place. */
  const announceNickname = useCallback((nickname: string) => {
    nicknameRef.current = nickname;
    const channel = channelRef.current;
    if (channel === null || joinedAtRef.current === null) return;
    void channel.track({ nickname, joinedAt: joinedAtRef.current });
  }, []);

  return { listeners, status, hearts, sendHeart, announceNickname };
}
