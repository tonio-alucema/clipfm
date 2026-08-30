/**
 * Loader and minimal typings for the SoundCloud Widget API.
 *
 * The `SC` global and every SoundCloud-shaped type are confined to this
 * directory. No key is involved: `api.js` and the widget iframe are free
 * public surfaces.
 */

export type ScWidget = {
  bind(eventName: string, listener: (payload?: unknown) => void): void;
  unbind(eventName: string): void;
  load(url: string, options: Record<string, unknown>): void;
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  getPosition(callback: (ms: number) => void): void;
  getDuration(callback: (ms: number) => void): void;
  getCurrentSound(callback: (sound: unknown) => void): void;
  /** Jump to a track within a loaded set. Does not reload the iframe. */
  skip(soundIndex: number): void;
  /** 0-100. Used to keep seed-time verification silent. */
  setVolume(volume: number): void;
  /** Every sound in the loaded set, with durations and permalinks. */
  getSounds(callback: (sounds: unknown[]) => void): void;
};

type ScWidgetFactory = ((element: HTMLIFrameElement | string) => ScWidget) & {
  /**
   * Observed on 2026-08-27: READY, PLAY, PAUSE, FINISH, PLAY_PROGRESS,
   * LOAD_PROGRESS, SEEK, ERROR, and three share/download/buy events. Read
   * defensively anyway — this is an undeclared surface of someone else's
   * iframe, not an API we have a contract for.
   */
  Events: Partial<Record<string, string>>;
};

export type ScGlobal = { Widget: ScWidgetFactory };

declare global {
  interface Window {
    SC?: ScGlobal;
  }
}

const WIDGET_API_SRC = 'https://w.soundcloud.com/player/api.js';

let pending: Promise<ScGlobal> | null = null;

/** Loads `api.js` once per document, however many players ask for it. */
export function loadWidgetApi(): Promise<ScGlobal> {
  if (pending) return pending;

  pending = new Promise<ScGlobal>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('The SoundCloud widget API requires a browser.'));
      return;
    }
    if (window.SC?.Widget) {
      resolve(window.SC);
      return;
    }

    const script = document.createElement('script');
    script.src = WIDGET_API_SRC;
    script.async = true;
    script.addEventListener('load', () => {
      if (window.SC?.Widget) resolve(window.SC);
      else reject(new Error('api.js loaded but window.SC.Widget is missing.'));
    });
    script.addEventListener('error', () =>
      reject(new Error('Could not load the SoundCloud widget API.')),
    );
    document.head.appendChild(script);
  });

  // A failed load should not poison every later attempt.
  pending.catch(() => {
    pending = null;
  });

  return pending;
}

/**
 * Keep the widget's own chrome quiet; the room draws its own UI.
 *
 * These must be passed to BOTH the initial iframe `src` and every `load()`
 * call. `load()` rebuilds the iframe URL from the options it is given and
 * silently drops anything that was only in the original src.
 */
export const WIDGET_DISPLAY_OPTIONS = {
  show_artwork: false,
  hide_related: true,
  show_comments: false,
  show_user: false,
  show_teaser: false,
} as const;

/** The iframe `src` a widget-backed player needs before it can be wrapped. */
export function widgetIframeSrc(trackUrl: string): string {
  const params = new URLSearchParams({ url: trackUrl, auto_play: 'false' });
  for (const [key, value] of Object.entries(WIDGET_DISPLAY_OPTIONS)) {
    params.set(key, String(value));
  }
  return `https://w.soundcloud.com/player/?${params.toString()}`;
}
