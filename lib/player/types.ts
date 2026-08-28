/**
 * The audio provider is swappable. Everything a room needs from a player is
 * this interface; nothing outside `lib/player/` may know that SoundCloud
 * exists.
 *
 * Deliberately absent: any "track finished, advance" callback. The schedule
 * decides what is playing. A player that reports finishing is telling us our
 * recorded duration was wrong, which is a diagnostic, not control flow.
 */

export type PlayerState =
  /** Nothing loaded yet. */
  | 'idle'
  /** `load()` is in flight. */
  | 'loading'
  /** Loaded and seekable, not producing sound. */
  | 'ready'
  /** Producing sound, position advancing. */
  | 'playing'
  /** We asked to play, but the position has stopped advancing. */
  | 'stalled'
  /** This track will not play here: embedding denied, geo-blocked, or gone. */
  | 'unavailable';

/** The two states `load()` can settle into. */
export type LoadOutcome = Extract<PlayerState, 'ready' | 'unavailable'>;

export interface RoomPlayer {
  /**
   * Load a track and settle. Never rejects — a track that cannot play resolves
   * to `'unavailable'` so the room can render a state instead of crashing.
   */
  load(trackUrl: string): Promise<LoadOutcome>;
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  /** Current playback position in ms. */
  getPosition(): Promise<number>;
  getState(): PlayerState;
  /** Returns an unsubscribe function. */
  onStateChange(listener: (state: PlayerState) => void): () => void;
  destroy(): void;
}
