'use client';

/**
 * Joins a room's presence channel and reports who is in it.
 *
 * Nothing here writes a row. Presence lives entirely in Realtime, so a closed
 * tab leaves no trace and a busy room costs nothing on the free tier.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from '../db/client';
import type { Listener } from '../identity';
import { parsePresenceState, type PresentListener } from './presence';

export type PresenceStatus = 'idle' | 'joining' | 'joined' | 'unavailable';

export type UseRoomPresenceOptions = {
  roomSlug: string;
  listener: Listener | null;
  /** serverNow, so arrival order agrees across clients with wrong clocks. */
  now: () => number;
};

export function useRoomPresence({ roomSlug, listener, now }: UseRoomPresenceOptions) {
  const [listeners, setListeners] = useState<PresentListener[]>([]);
  const [status, setStatus] = useState<PresenceStatus>('idle');

  const channelRef = useRef<ReturnType<NonNullable<ReturnType<typeof getSupabase>>['channel']> | null>(null);
  const nicknameRef = useRef(listener?.nickname ?? '');
  /** Captured once, so renaming yourself does not move you in the room. */
  const joinedAtRef = useRef<number | null>(null);

  nicknameRef.current = listener?.nickname ?? '';

  const listenerId = listener?.id ?? null;

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

  /** Re-announce a renamed listener without rejoining, so they keep their place. */
  const announceNickname = useCallback((nickname: string) => {
    nicknameRef.current = nickname;
    const channel = channelRef.current;
    if (channel === null || joinedAtRef.current === null) return;
    void channel.track({ nickname, joinedAt: joinedAtRef.current });
  }, []);

  return { listeners, status, announceNickname };
}
