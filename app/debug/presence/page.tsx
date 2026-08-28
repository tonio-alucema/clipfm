'use client';

/**
 * Step 5 harness — presence and avatars.
 *
 * Deliberately has no audio. Presence is the thing under test, and the widget
 * only lets one instance per browser produce sound, which would make a
 * three-tab test unreadable for reasons that have nothing to do with presence.
 *
 * ?room=<slug>  use a room other than "main".
 * ?as=<name>     act as a distinct, unsaved listener. Tabs in one browser
 *                share localStorage and so share an id — which is the right
 *                behaviour, since one person in two tabs should be one
 *                listener, but it makes a multi-tab test impossible without
 *                this.
 */

import { AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AvatarPill } from '@/components/avatar-pill';
import { loadListener, normalizeNickname, saveListener, type Listener } from '@/lib/identity';
import { useRoomPresence } from '@/lib/presence/use-room-presence';
import { measureServerClock, serverNowFrom, type ClockOffset } from '@/lib/time/server-clock';

export default function PresenceHarness() {
  const clockRef = useRef<ClockOffset | null>(null);
  const [clockReady, setClockReady] = useState(false);
  const [listener, setListener] = useState<Listener | null>(null);
  const [roomSlug, setRoomSlug] = useState('main');
  const [draftNickname, setDraftNickname] = useState('');

  // serverNow, so arrival order agrees between clients with wrong clocks.
  const now = useCallback(() => {
    const offset = clockRef.current;
    return offset === null ? Number.NaN : serverNowFrom(offset, performance.now());
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRoomSlug(params.get('room') ?? 'main');

    const actAs = params.get('as');
    const loaded: Listener =
      actAs === null || actAs.length === 0
        ? loadListener()
        : // Not saved: a debug listener should not displace the real one.
          { id: `debug-${actAs}`, nickname: actAs };
    setListener(loaded);
    setDraftNickname(loaded.nickname);

    let cancelled = false;
    void measureServerClock().then((offset) => {
      if (cancelled || offset === null) return;
      clockRef.current = offset;
      setClockReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { listeners, status, announceNickname } = useRoomPresence({
    roomSlug,
    listener: clockReady ? listener : null,
    now,
  });

  const rename = useCallback(() => {
    const nickname = normalizeNickname(draftNickname);
    if (listener === null || nickname.length === 0 || nickname === listener.nickname) return;
    const updated = { ...listener, nickname };
    setListener(updated);
    // A debug listener is not persisted, so it does not overwrite the real one.
    if (!listener.id.startsWith('debug-')) saveListener(updated);
    announceNickname(nickname);
  }, [announceNickname, draftNickname, listener]);

  return (
    <main>
      <h1>Presence harness</h1>
      <p>
        room <code>{roomSlug}</code> — <strong>{status}</strong> — {listeners.length} listener(s)
      </p>

      <h2>In the room</h2>
      <ul style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', padding: 0, margin: 0 }}>
        <AnimatePresence initial={false} mode="popLayout">
          {listeners.map((present) => (
            <AvatarPill
              key={present.id}
              id={present.id}
              nickname={present.nickname}
              isSelf={present.id === listener?.id}
            />
          ))}
        </AnimatePresence>
      </ul>
      {listeners.length === 0 && (
        <p>
          <small>
            {status === 'unavailable'
              ? 'Realtime is unavailable — is Supabase configured?'
              : 'Nobody here yet.'}
          </small>
        </p>
      )}

      <h2>You</h2>
      <p>
        <input
          value={draftNickname}
          onChange={(event) => setDraftNickname(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') rename();
          }}
          aria-label="nickname"
          maxLength={24}
        />{' '}
        <button type="button" onClick={rename}>
          Rename
        </button>
      </p>
      <p>
        <small>
          Renaming keeps your place in the room — arrival order is fixed at join, not at
          rename. Your id lives in localStorage and presence is keyed on it, so opening a
          second tab does not make you two listeners.
        </small>
      </p>
    </main>
  );
}
