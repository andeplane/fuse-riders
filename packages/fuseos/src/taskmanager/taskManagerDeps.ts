import { createContext } from "react";

/**
 * The slice of a `Window` the frame-rate sampler needs. For a game window this is the
 * same-origin page inside its iframe (`iframe.contentWindow`); for the desktop it is the
 * document FuseOS itself runs in.
 */
export interface FrameWindow {
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(handle: number): void;
}

/** What `performance.memory` reports in Chromium; absent elsewhere. */
export type HeapSample = { usedBytes: number; totalBytes: number };

/** Browser dependencies of the Task Manager, injected so tests drive the clock, the frames and the heap by hand. */
export interface TaskManagerDeps {
  now: () => number;
  /** Calls back about once a second while subscribed; returns an unsubscribe. The Task Manager samples on this. */
  subscribeTicks: (onTick: () => void) => () => void;
  /** The desktop's own frames: what the Performance tab shows as "Desktop". */
  desktopFrame: FrameWindow;
  /**
   * The page inside window `windowId`'s iframe, resolved afresh on every tick so a frame that
   * mounts later, or navigates, is picked up. Undefined when the window has no iframe, the
   * iframe has not loaded yet, or its page is not ours (a cross-origin page refuses the call).
   */
  frameWindowFor: (windowId: string) => FrameWindow | undefined;
  /** The JavaScript heap, where the browser reports it (Chromium's `performance.memory`). */
  heap: () => HeapSample | undefined;
}

/** How often the Task Manager samples; the Performance tab's graphs advance one column per tick. */
export const TICK_MS = 1000;

function isHeapSample(value: unknown): value is HeapSample {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "usedBytes") === "number" &&
    typeof Reflect.get(value, "totalBytes") === "number"
  );
}

/** `performance.memory` is Chromium-only and not in the DOM typings; read it without widening `performance`. */
export function readHeap(perf: Performance): HeapSample | undefined {
  const memory: unknown = Reflect.get(perf, "memory");
  if (typeof memory !== "object" || memory === null) return undefined;
  const sample = {
    usedBytes: Reflect.get(memory, "usedJSHeapSize"),
    totalBytes: Reflect.get(memory, "totalJSHeapSize"),
  };
  return isHeapSample(sample) ? sample : undefined;
}

/**
 * The window inside a frame element, when it is one of our own pages. Reading
 * `requestAnimationFrame` on a cross-origin page throws a SecurityError; that frame is left out.
 */
export function frameWindowOf(
  frame: HTMLIFrameElement | null,
): FrameWindow | undefined {
  const target = frame?.contentWindow;
  if (!target) return undefined;
  try {
    if (typeof target.requestAnimationFrame !== "function") return undefined;
    // One wrapper per page, so a sampler sees the same frame on every tick and keeps its count.
    const cached = frameWindows.get(target);
    if (cached) return cached;
    const wrapper: FrameWindow = {
      requestAnimationFrame: (callback) =>
        target.requestAnimationFrame(callback),
      cancelAnimationFrame: (handle) => target.cancelAnimationFrame(handle),
    };
    frameWindows.set(target, wrapper);
    return wrapper;
  } catch {
    return undefined;
  }
}

const frameWindows = new WeakMap<Window, FrameWindow>();

/** Finds the iframe inside the frame `WindowHost` renders for a window (`data-window-id`). */
export function findWindowIframe(
  root: ParentNode,
  windowId: string,
): HTMLIFrameElement | null {
  // Compared as data rather than put into a selector, so no id needs escaping.
  for (const frame of root.querySelectorAll("[data-window-id]")) {
    if (frame.getAttribute("data-window-id") !== windowId) continue;
    const element = frame.querySelector("iframe");
    return element instanceof HTMLIFrameElement ? element : null;
  }
  return null;
}

/** The real browser. */
export const browserTaskManagerDeps: TaskManagerDeps = {
  now: () => performance.now(),
  subscribeTicks: (onTick) => {
    const handle = window.setInterval(onTick, TICK_MS);
    return () => window.clearInterval(handle);
  },
  desktopFrame: {
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  },
  frameWindowFor: (windowId) =>
    frameWindowOf(findWindowIframe(document, windowId)),
  heap: () => readHeap(performance),
};

export const TaskManagerDepsContext = createContext<TaskManagerDeps>(
  browserTaskManagerDeps,
);
