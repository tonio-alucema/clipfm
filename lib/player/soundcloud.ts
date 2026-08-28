/**
 * `RoomPlayer` backed by the SoundCloud embed widget, driving a whole set.
 *
 * The iframe is pointed at a set once and never reloaded. Changing track is
 * `skip(index)`, which keeps the same media element alive.
 *
 * That is not a micro-optimisation. `load()` rebuilds the iframe, producing a
 * media element that no user has ever tapped, and mobile browsers refuse to
 * start one. Measured: desktop crossed a track boundary at -30ms, while mobile
 * played the first track and then went silent forever. `skip()` inherits the
 * unlock from the original tune-in gesture.
 *
 * The widget is an iframe we do not control, driven over postMessage. Every
 * call is fire-and-forget and every reply may never come, so each await is
 * bounded by a timeout.
 */

import { LOAD_TIMEOUT_MS, STALL_AFTER_MS, STALL_POLL_MS } from '../config/player';
import {
  indexSoundsByUrl,
  normalizeTrackUrl,
  parseWidgetSounds,
  type WidgetSound,
} from './sounds';
import type { LoadOutcome, PlayerState, RoomPlayer } from './types';
import { loadWidgetApi, WIDGET_DISPLAY_OPTIONS, type ScWidget } from './widget-api';

const POSITION_TIMEOUT_MS = 2_000;
const SKIP_CONFIRM_POLL_MS = 200;
/**
 * Best-effort only. A skip that has not visibly landed yet is not a failure —
 * the drift check will notice and retry — so this budget is short and its
 * expiry is not reported as unavailable.
 */
const SKIP_CONFIRM_BUDGET_MS = 2_500;

export type SoundCloudPlayerOptions = {
  /**
   * The set to drive. Loaded once here, at construction, and never again —
   * every later track change is `skip()`.
   */
  setUrl: string;
  /** Debug sink for raw widget events. The room does not pass this. */
  onWidgetEvent?: (name: string, payload?: unknown) => void;
};

export type SoundCloudPlayer = RoomPlayer & {
  /** Everything in the loaded set, for seeding and for the harness. */
  getSounds: () => readonly WidgetSound[];
  /** What the widget is actually holding — not what the schedule wants. */
  getLoadedSound: () => WidgetSound | null;
};

export async function createSoundCloudPlayer(
  iframe: HTMLIFrameElement,
  options: SoundCloudPlayerOptions,
): Promise<SoundCloudPlayer> {
  const sc = await loadWidgetApi();
  const widget: ScWidget = sc.Widget(iframe);

  const names = sc.Widget.Events;
  const EV = {
    ready: names.READY ?? 'ready',
    play: names.PLAY ?? 'play',
    pause: names.PAUSE ?? 'pause',
    finish: names.FINISH ?? 'finish',
    progress: names.PLAY_PROGRESS ?? 'playProgress',
    seek: names.SEEK ?? 'seek',
    error: names.ERROR ?? 'error',
  };

  let state: PlayerState = 'idle';
  let wantsToPlay = false;
  let lastProgressAt = 0;
  let destroyed = false;
  let sounds: WidgetSound[] = [];
  let indexByUrl = new Map<string, number>();
  let currentIndex: number | null = null;

  const listeners = new Set<(next: PlayerState) => void>();

  function setState(next: PlayerState): void {
    if (destroyed || next === state) return;
    state = next;
    for (const listener of listeners) listener(next);
  }

  function on(eventName: string, handler: (payload?: unknown) => void): void {
    widget.bind(eventName, (payload) => {
      if (destroyed) return;
      options.onWidgetEvent?.(eventName, payload);
      handler(payload);
    });
  }

  on(EV.progress, () => {
    lastProgressAt = performance.now();
    if (wantsToPlay) setState('playing');
  });

  on(EV.play, () => {
    lastProgressAt = performance.now();
  });

  on(EV.pause, () => {
    // A pause we did not ask for means the widget stopped itself: buffering,
    // or another instance of the widget taking the audio.
    setState(wantsToPlay ? 'stalled' : 'ready');
  });

  // Nothing advances on FINISH. The schedule decides what plays.
  on(EV.finish, () => {});
  on(EV.seek, () => {});
  on(EV.error, () => setState('unavailable'));

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, LOAD_TIMEOUT_MS);
    on(EV.ready, () => {
      clearTimeout(timer);
      resolve();
    });
  });

  /**
   * Read the set's manifest. One keyless call gives every track — but READY
   * fires before the set is populated, so an early read comes back empty and
   * every track then looks like it is not in the set.
   */
  async function readSounds(): Promise<void> {
    const raw = await new Promise<unknown[]>((resolve) => {
      const timer = setTimeout(() => resolve([]), POSITION_TIMEOUT_MS);
      widget.getSounds((list) => {
        clearTimeout(timer);
        resolve(Array.isArray(list) ? list : []);
      });
    });
    const parsed = parseWidgetSounds(raw);
    if (parsed.length === 0) return;
    sounds = parsed;
    indexByUrl = indexSoundsByUrl(parsed);
  }

  async function ensureSounds(): Promise<void> {
    const deadline = performance.now() + LOAD_TIMEOUT_MS;
    let previousCount = -1;
    let stableReads = 0;
    while (!destroyed && performance.now() < deadline) {
      await readSounds();
      // The manifest fills in lazily, so a non-empty read is not a complete
      // one. Wait for the count to stop growing.
      if (sounds.length > 0 && sounds.length === previousCount) {
        stableReads += 1;
        if (stableReads >= 2) return;
      } else {
        stableReads = 0;
        previousCount = sounds.length;
      }
      await new Promise((resolve) => setTimeout(resolve, SKIP_CONFIRM_POLL_MS));
    }
  }

  /**
   * Load the set once, here, before the listener has tapped anything.
   *
   * Pointing the iframe src at a set only yields a partial manifest — five of
   * twenty-four in measurement — so a track deep in the set looks absent. An
   * explicit load populates all of it. This is the only load() in the player's
   * life: doing it now means the media element the listener later unlocks with
   * their tap is the one that plays for the rest of the session.
   */
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, LOAD_TIMEOUT_MS);
    widget.load(options.setUrl, {
      ...WIDGET_DISPLAY_OPTIONS,
      auto_play: false,
      callback: () => {
        clearTimeout(timer);
        resolve();
      },
    });
  });

  await ensureSounds();

  function currentPermalink(): Promise<string | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), POSITION_TIMEOUT_MS);
      widget.getCurrentSound((sound) => {
        clearTimeout(timer);
        const url =
          typeof sound === 'object' && sound !== null
            ? (sound as Record<string, unknown>)['permalink_url']
            : null;
        resolve(typeof url === 'string' ? url : null);
      });
    });
  }

  // Establish where the widget already is, so a join to the current track does
  // not skip needlessly.
  const startingUrl = await currentPermalink();
  if (startingUrl !== null) {
    currentIndex = indexByUrl.get(normalizeTrackUrl(startingUrl)) ?? null;
  }

  const stallWatchdog = setInterval(() => {
    if (!wantsToPlay || state !== 'playing') return;
    if (performance.now() - lastProgressAt > STALL_AFTER_MS) setState('stalled');
  }, STALL_POLL_MS);

  async function load(trackUrl: string): Promise<LoadOutcome> {
    const wanted = normalizeTrackUrl(trackUrl);
    // A miss may mean the manifest is still filling in rather than that the
    // track is absent. Re-read once before writing a track off.
    if (!indexByUrl.has(wanted)) await ensureSounds();

    const index = indexByUrl.get(wanted);
    if (index === undefined) {
      // Not in the set. The clock keeps running; this is a state, not a crash.
      setState('unavailable');
      return 'unavailable';
    }

    if (index === currentIndex) {
      if (state === 'unavailable' || state === 'idle') setState('ready');
      return 'ready';
    }

    setState('loading');
    widget.skip(index);
    currentIndex = index;
    // skip() starts the new track on its own. Record that as intent, so the
    // progress events it produces are recognised as playing rather than as an
    // unrequested pause to recover from.
    wantsToPlay = true;
    lastProgressAt = performance.now();

    // skip() is fire-and-forget, so wait for the widget to visibly move — but
    // only briefly. 'unavailable' means "not in this set", which we already
    // established synchronously above. A slow confirmation is not that, and
    // reporting it as such would strand a track that is playing perfectly
    // well.
    const expected = normalizeTrackUrl(sounds[index]?.url ?? trackUrl);
    const deadline = performance.now() + SKIP_CONFIRM_BUDGET_MS;
    while (!destroyed && performance.now() < deadline) {
      const actual = await currentPermalink();
      if (actual !== null && normalizeTrackUrl(actual) === expected) break;
      await new Promise((resolve) => setTimeout(resolve, SKIP_CONFIRM_POLL_MS));
    }

    setState('ready');
    return 'ready';
  }

  function getPosition(): Promise<number> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (ms: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ms);
      };
      // NaN means "no reading". Comparisons against it are false, so a drift
      // check that misses a reply declines to correct rather than guessing.
      const timer = setTimeout(() => settle(Number.NaN), POSITION_TIMEOUT_MS);
      widget.getPosition(settle);
    });
  }

  return {
    load,
    play() {
      wantsToPlay = true;
      lastProgressAt = performance.now();
      widget.play();
    },
    pause() {
      wantsToPlay = false;
      widget.pause();
      setState('ready');
    },
    seekTo(ms: number) {
      widget.seekTo(Math.max(0, Math.round(ms)));
      lastProgressAt = performance.now();
    },
    getPosition,
    getState: () => state,
    getSounds: () => sounds,
    getLoadedSound: () => (currentIndex === null ? null : (sounds[currentIndex] ?? null)),
    onStateChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      // Deliberately no widget.unbind(): bindings are keyed by iframe, so
      // unbinding would strip the listeners of any other player sharing it.
      destroyed = true;
      clearInterval(stallWatchdog);
      listeners.clear();
    },
  };
}
