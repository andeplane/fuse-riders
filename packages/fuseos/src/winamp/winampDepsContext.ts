import { createContext } from "react";

import type { MediaErrorInfo } from "./mediaErrorReporting";
import { subscribeMediaErrors } from "./mediaErrorReporting";
import type { WebampPlayer } from "./webampPlayer";

/**
 * Winamp's dependencies, injected so tests and previews never load the `webamp` package (about
 * 250KB gzipped): the production entry point loads it on first use, keeping it out of the main bundle.
 */
export type WinampDeps = {
  /** Loads `webamp` and constructs one player with the bundled classic skin; undefined where Winamp is not available (tests default to this). */
  createPlayer: (() => Promise<WebampPlayer>) | undefined;
  /** Subscribes to audio playback failures (a CSP block or any other load error); returns an unsubscribe. Real browser events by default; tests inject a controllable fake. */
  subscribeMediaErrors: (onError: (info: MediaErrorInfo) => void) => () => void;
  /** The site base the Fuse soundtrack's files are served under (Vite's `BASE_URL`: `/`, `/fuse-riders/` or `./`). */
  base: string;
};

export const defaultWinampDeps: WinampDeps = {
  createPlayer: undefined,
  subscribeMediaErrors,
  base: import.meta.env.BASE_URL,
};

export const WinampDepsContext = createContext<WinampDeps>(defaultWinampDeps);
