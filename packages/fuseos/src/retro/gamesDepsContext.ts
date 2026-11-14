import { createContext } from "react";

import { publicUrl } from "./publicUrl";

/** Browser and asset dependencies of the games, injected so tests never load a page or a timer. */
export type GamesDeps = {
  /** Absolute URL of a page or bundle under public/, from a path relative to the app root. */
  resolveUrl: (path: string) => string;
  now: () => number;
  /** Calls back about once a second while subscribed; returns an unsubscribe. */
  subscribeSeconds: (onTick: () => void) => () => void;
  /** Calls back once per animation frame while subscribed; returns an unsubscribe. */
  subscribeFrames: (onFrame: () => void) => () => void;
  /** Uniform random number in [0, 1). */
  random: () => number;
};

export const defaultGamesDeps: GamesDeps = {
  resolveUrl: (path) =>
    publicUrl(path, import.meta.env.BASE_URL, document.baseURI),
  now: () => Date.now(),
  subscribeSeconds: (onTick) => {
    const handle = window.setInterval(onTick, 250);
    return () => window.clearInterval(handle);
  },
  subscribeFrames: (onFrame) => {
    let handle = window.requestAnimationFrame(function frame() {
      onFrame();
      handle = window.requestAnimationFrame(frame);
    });
    return () => window.cancelAnimationFrame(handle);
  },
  random: () => Math.random(),
};

export const GamesDepsContext = createContext<GamesDeps>(defaultGamesDeps);
