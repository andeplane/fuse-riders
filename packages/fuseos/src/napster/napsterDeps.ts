import { createContext } from "react";

import type { Random } from "./fakeNetwork";
import type { ChimeAudioContext } from "./napsterChime";
import { createChime } from "./napsterChime";

/** Cancels what `every` or `after` scheduled. */
export type Cancel = () => void;

/**
 * Napster's outside world, injected: the random source behind every fake result and chat line, the clock that
 * moves transfers and chatter, and the connected chime. Tests hand in a seeded random and manual timers.
 */
export type NapsterDeps = {
  random: Random;
  /** Runs `callback` every `ms` until cancelled. */
  every: (ms: number, callback: () => void) => Cancel;
  /** Runs `callback` once after `ms` unless cancelled. */
  after: (ms: number, callback: () => void) => Cancel;
  playChime: () => void;
  /**
   * The chance, per network tick (about a second), that the court order pulls the plug mid-session.
   * Tiny in production (a rare treat), 0 in tests unless one asks for it.
   */
  shutdownChance: number;
};

export const TICK_MS = 1000;

/** The page's AudioContext, unless there is none or the page was opened with `?mute`. */
export function createBrowserAudio(
  Context: (new () => ChimeAudioContext) | undefined,
  search: string,
): () => ChimeAudioContext | undefined {
  return () => {
    if (!Context || new URLSearchParams(search).has("mute")) return undefined;
    return new Context();
  };
}

export const browserEvery = (ms: number, callback: () => void): Cancel => {
  const handle = globalThis.setInterval(callback, ms);
  return () => globalThis.clearInterval(handle);
};

export const browserAfter = (ms: number, callback: () => void): Cancel => {
  const handle = globalThis.setTimeout(callback, ms);
  return () => globalThis.clearTimeout(handle);
};

export const defaultNapsterDeps: NapsterDeps = {
  random: Math.random,
  every: browserEvery,
  after: browserAfter,
  playChime: createChime(
    createBrowserAudio(
      typeof AudioContext === "function" ? AudioContext : undefined,
      globalThis.location?.search ?? "",
    ),
    (callback, ms) => {
      browserAfter(ms, callback);
    },
  ),
  shutdownChance: 1 / 2400,
};

export const NapsterDepsContext =
  createContext<NapsterDeps>(defaultNapsterDeps);
