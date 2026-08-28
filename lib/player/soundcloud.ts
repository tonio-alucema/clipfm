/**
 * `RoomPlayer` backed by the SoundCloud embed widget.
 *
 * The widget is an iframe we do not control, driven over postMessage. Every
 * call is fire-and-forget and every reply is a callback that may never come,
 * so each await here is bounded by a timeout. A track that will not embed
 * off-platform typically produces silence rather than an error.
 */

import { LOAD_TIMEOUT_MS, STALL_AFTER_MS, STALL_POLL_MS } from '../config/player';
import type { LoadOutcome, PlayerState, RoomPlayer } from './types';
import { loadWidgetApi, WIDGET_DISPLAY_OPTIONS, type ScWidget } from './widget-api';

const POSITION_TIMEOUT_MS = 2_000;

export type SoundCloudPlayerOptions = {
  /**
   * Debug sink for raw widget events. Used by the step 2 harness to learn what
   * the widget actually emits; the room does not pass this.
   */
  onWidgetEvent?: (name: string, payload?: unknown) => void;
};

export async function createSoundCloudPlayer(
  iframe: HTMLIFrameElement,
  options: SoundCloudPlayerOptions = {},
): Promise<RoomPlayer> {
  const sc = await loadWidgetApi();
  const widget: ScWidget = sc.Widget(iframe);

  // Event name constants are read off the global rather than hardcoded, but
  // fall back to the documented strings if a build omits them.
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
  /** `performance.now()` of the last progress event — monotonic, unlike the clock. */
  let lastProgressAt = 0;
  let destroyed = false;

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
    // A pause we did ask for is just a pause. A pause we did not ask for means
    // the widget stopped itself — buffering, throttled, or refusing to start
    // because the user gesture that authorised playback has gone stale by the
    // time load() settled and play() was finally called. That is a stall, and
    // the sync loop knows how to recover from one.
    setState(wantsToPlay ? 'stalled' : 'ready');
  });

  // Nothing advances on FINISH. The schedule decides what plays; a finish only
  // tells us the duration in the snapshot disagrees with reality.
  on(EV.finish, () => {});

  // Bound purely so seeks show up in the harness log.
  on(EV.seek, () => {});

  on(EV.error, () => setState('unavailable'));

  // Wait for the iframe to come up. Bounded, because binding after READY has
  // already fired would otherwise hang forever. Note READY fires again after
  // every `load()`, since `load()` reloads the iframe — it is not one-shot.
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, LOAD_TIMEOUT_MS);
    on(EV.ready, () => {
      clearTimeout(timer);
      resolve();
    });
  });

  const stallWatchdog = setInterval(() => {
    if (!wantsToPlay || state !== 'playing') return;
    if (performance.now() - lastProgressAt > STALL_AFTER_MS) setState('stalled');
  }, STALL_POLL_MS);

  async function load(trackUrl: string): Promise<LoadOutcome> {
    wantsToPlay = false;
    setState('loading');

    const outcome = await new Promise<LoadOutcome>((resolve) => {
      let settled = false;
      const settle = (result: LoadOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => settle('unavailable'), LOAD_TIMEOUT_MS);

      widget.load(trackUrl, {
        ...WIDGET_DISPLAY_OPTIONS,
        auto_play: false,
        callback: () => {
          // The load callback fires even for a track that refuses off-platform
          // embedding, so confirm a sound actually materialised.
          widget.getCurrentSound((sound) => settle(sound ? 'ready' : 'unavailable'));
        },
      });
    });

    setState(outcome);
    return outcome;
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
      // NaN means "no reading". Every comparison against it is false, so a
      // drift check that misses a reply declines to correct rather than
      // seeking on a guess.
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
    onStateChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      // Deliberately does not call `widget.unbind()`. Bindings are keyed by
      // iframe inside the widget API, not by wrapper, so unbinding here would
      // also strip the listeners of any other player sharing this iframe —
      // which is exactly what happens under React StrictMode's double mount.
      // Handlers check `destroyed` and no-op instead.
      destroyed = true;
      clearInterval(stallWatchdog);
      listeners.clear();
    },
  };
}
