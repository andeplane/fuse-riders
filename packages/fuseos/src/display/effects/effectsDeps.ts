import { createContext } from "react";

import type { MapCanvas } from "./curvatureMap";
import { curvatureMapDataUrl } from "./curvatureMap";

/** A pending timer, opaque to the code that holds it. */
export type TimerHandle = unknown;

/** What the effects need from the browser: timers for the revert countdown and a canvas for the curvature map. */
export type DisplayEffectsDeps = {
  setTimeout: (callback: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
  /** The curvature displacement map as a data URL; undefined means the tube stays flat. */
  createCurvatureMap: () => string | undefined;
};

export const defaultDisplayEffectsDeps: DisplayEffectsDeps = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  createCurvatureMap: () =>
    curvatureMapDataUrl(
      (): MapCanvas => document.createElement("canvas") as MapCanvas,
    ),
};

export const DisplayEffectsDepsContext = createContext<DisplayEffectsDeps>(
  defaultDisplayEffectsDeps,
);

/** Timers a test drives by hand: nothing fires until `advance` is called. */
export type ManualTimers = Pick<
  DisplayEffectsDeps,
  "setTimeout" | "clearTimeout"
> & {
  /** Moves the clock forward and fires every timer due by then, in order. */
  advance(ms: number): void;
  pending(): number;
};

export function createManualTimers(): ManualTimers {
  type Entry = { id: number; due: number; callback: () => void };
  let now = 0;
  let nextId = 1;
  let entries: Entry[] = [];
  return {
    setTimeout: (callback, ms) => {
      const entry = { id: nextId++, due: now + ms, callback };
      entries.push(entry);
      return entry.id;
    },
    clearTimeout: (handle) => {
      entries = entries.filter((entry) => entry.id !== handle);
    },
    advance: (ms) => {
      const target = now + ms;
      for (;;) {
        const due = entries
          .filter((entry) => entry.due <= target)
          .sort((a, b) => a.due - b.due)[0];
        if (!due) break;
        now = due.due;
        entries = entries.filter((entry) => entry.id !== due.id);
        due.callback();
      }
      now = target;
    },
    pending: () => entries.length,
  };
}
