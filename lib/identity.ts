/**
 * Who a listener is, in Phase 0.
 *
 * A nickname and a UUID in localStorage. No auth, no account, no row. The id
 * identifies a browser, not a person — one person in two tabs is two
 * listeners, which is a known and accepted limitation of this phase.
 */

const STORAGE_KEY = 'clipfm.listener';

export type Listener = {
  id: string;
  nickname: string;
};

const ADJECTIVES = [
  'quiet', 'slow', 'warm', 'late', 'soft', 'dim', 'far', 'deep',
  'idle', 'low', 'blue', 'lone', 'still', 'faint', 'dusk',
] as const;

const NOUNS = [
  'hours', 'signal', 'static', 'echo', 'drift', 'tape', 'room', 'wire',
  'radio', 'moth', 'ember', 'tide', 'lamp', 'fog', 'orbit',
] as const;

/** Deliberately atmospheric rather than cute. The room has a mood. */
export function randomNickname(random: () => number = Math.random): string {
  const adjective = ADJECTIVES[Math.floor(random() * ADJECTIVES.length)] ?? 'quiet';
  const noun = NOUNS[Math.floor(random() * NOUNS.length)] ?? 'signal';
  return `${adjective} ${noun}`;
}

/** Accepts anything storable; returns null for anything that is not a listener. */
export function parseListener(raw: string | null): Listener | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { id, nickname } = parsed as Record<string, unknown>;
    if (typeof id !== 'string' || id.length === 0) return null;
    if (typeof nickname !== 'string' || nickname.length === 0) return null;
    return { id, nickname };
  } catch {
    return null;
  }
}

/** Trimmed, collapsed, and bounded — a nickname is a label, not an essay. */
export function normalizeNickname(input: string): string {
  return input.replace(/\s+/g, ' ').trim().slice(0, 24);
}

/**
 * The listener for this browser, created on first visit and stable after.
 *
 * Storage can throw or be unavailable (private windows, blocked cookies), so a
 * failure produces a working in-memory listener rather than an error — being
 * in the room matters more than being remembered.
 */
export function loadListener(storage: Storage | null = safeStorage()): Listener {
  const existing = storage === null ? null : parseListener(read(storage, STORAGE_KEY));
  if (existing !== null) return existing;

  const created: Listener = { id: crypto.randomUUID(), nickname: randomNickname() };
  write(storage, STORAGE_KEY, JSON.stringify(created));
  return created;
}

export function saveListener(listener: Listener, storage: Storage | null = safeStorage()): void {
  write(storage, STORAGE_KEY, JSON.stringify(listener));
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: Storage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // A listener who cannot be remembered is still a listener.
  }
}
