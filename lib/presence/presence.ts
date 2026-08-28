/**
 * Who else is in the room.
 *
 * Presence is ephemeral by definition — it goes over Realtime and is never
 * written. A listener who closes the tab leaves no trace, which is the point.
 *
 * Keying on the listener id also answers an open question from the handoff:
 * one person in two tabs does NOT read as two listeners. Both tabs share the
 * id from localStorage, so they arrive as two presence refs under one key and
 * are collapsed back into a single listener below.
 *
 * Parsing is kept pure and separate from the channel so ordering and
 * deduplication can be tested without a socket.
 */

export type PresentListener = {
  id: string;
  nickname: string;
  /** serverNow() at the moment they tuned in. Orders the room. */
  joinedAt: number;
};

/** What each client tracks on the channel. Kept small; it is sent on every sync. */
export type PresencePayload = {
  nickname: string;
  joinedAt: number;
};

function parseEntry(id: string, raw: unknown): PresentListener | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { nickname, joinedAt } = raw as Record<string, unknown>;
  if (typeof nickname !== 'string' || nickname.length === 0) return null;
  if (typeof joinedAt !== 'number' || !Number.isFinite(joinedAt)) return null;
  return { id, nickname, joinedAt };
}

/**
 * Flattens Supabase's presence state into a stable, ordered list.
 *
 * A single key can carry several presence refs — a reconnect leaves the old
 * one briefly alive — so the earliest join wins and the listener appears once.
 * Ordering by join time means an arrival lands at the end rather than
 * reshuffling everyone already there, which matters once these are animated.
 */
export function parsePresenceState(raw: unknown): PresentListener[] {
  if (typeof raw !== 'object' || raw === null) return [];

  const listeners: PresentListener[] = [];
  for (const [id, entries] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;

    let earliest: PresentListener | null = null;
    for (const entry of entries) {
      const parsed = parseEntry(id, entry);
      if (parsed === null) continue;
      if (earliest === null || parsed.joinedAt < earliest.joinedAt) earliest = parsed;
    }
    if (earliest !== null) listeners.push(earliest);
  }

  return listeners.sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
}

/** Everyone except you. The room shows others; you are already here. */
export function others(listeners: readonly PresentListener[], selfId: string): PresentListener[] {
  return listeners.filter((listener) => listener.id !== selfId);
}
