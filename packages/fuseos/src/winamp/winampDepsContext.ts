import { createContext } from 'react';

import type { MediaErrorInfo } from './mediaErrorReporting';
import { subscribeMediaErrors } from './mediaErrorReporting';
import type { WebampPlayer } from './webampPlayer';

/**
 * Winamp's dependencies, injected so tests and demo mode never load the `webamp`
 * package (about 250KB gzipped): the production App loads it on first use, the way
 * `viewer3dDepsContext` loads Reveal, keeping it out of the main bundle.
 */
export type WinampDeps = {
  /** Loads `webamp` and constructs one player with the bundled classic skin; undefined where Winamp is not available (tests default to this, matching the 3D viewer and file viewer). */
  createPlayer: (() => Promise<WebampPlayer>) | undefined;
  createObjectURL: (file: File) => string;
  revokeObjectURL: (url: string) => void;
  /** Subscribes to local audio playback failures (a CSP block or any other load error); returns an unsubscribe. Real browser events by default; tests inject a controllable fake. */
  subscribeMediaErrors: (onError: (info: MediaErrorInfo) => void) => () => void;
};

export const defaultWinampDeps: WinampDeps = {
  createPlayer: undefined,
  createObjectURL: (file) => URL.createObjectURL(file),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  subscribeMediaErrors,
};

export const WinampDepsContext = createContext<WinampDeps>(defaultWinampDeps);
