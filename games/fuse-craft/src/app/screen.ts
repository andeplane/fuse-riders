import type { PointerSurface } from "../render/camera.js";

/**
 * The browser surfaces behind full screen and edge scrolling, typed to the
 * few members used so tests can drive them with plain fakes.
 */
type Listener<E> = (event: E) => void;
interface Events<E> {
  addEventListener(type: string, listener: Listener<E>): void;
  removeEventListener(type: string, listener: Listener<E>): void;
}

export interface FullscreenDocument extends Events<unknown> {
  readonly fullscreenEnabled?: boolean;
  readonly webkitFullscreenEnabled?: boolean;
  readonly fullscreenElement?: unknown;
  readonly webkitFullscreenElement?: unknown;
  exitFullscreen?(): Promise<void>;
  /** Older Safari returns nothing; newer may return a promise. */
  webkitExitFullscreen?(): void | Promise<void>;
}
export interface FullscreenTarget {
  requestFullscreen?(options?: { navigationUI?: "hide" }): Promise<void>;
  webkitRequestFullscreen?(): void | Promise<void>;
}
export interface FullscreenControl {
  active(): boolean;
  toggle(): void;
  onChange(callback: () => void): () => void;
}

/**
 * Real full screen for the game's container, with Safari's prefixed API as a
 * fallback. Returns undefined where the browser cannot do it (an iframe
 * without permission, iPhone Safari), so no button is offered. The state
 * comes from the document, so Esc and the browser's own exit keep the button
 * in step through the change events.
 */
export function createFullscreenControl(
  doc: FullscreenDocument,
  target: FullscreenTarget,
): FullscreenControl | undefined {
  const enabled =
    (doc.fullscreenEnabled === true && !!target.requestFullscreen) ||
    (doc.webkitFullscreenEnabled === true && !!target.webkitRequestFullscreen);
  if (!enabled) return undefined;
  const element = () => doc.fullscreenElement ?? doc.webkitFullscreenElement;
  const ignore = () => {};
  // A refused request is the browser's answer, not an error to surface.
  const settle = (result: void | Promise<void>) =>
    void Promise.resolve(result).catch(ignore);
  return {
    active: () => element() != null,
    toggle() {
      if (element() != null) {
        if (doc.exitFullscreen) void doc.exitFullscreen().catch(ignore);
        else settle(doc.webkitExitFullscreen?.());
      } else if (target.requestFullscreen)
        void target.requestFullscreen({ navigationUI: "hide" }).catch(ignore);
      else settle(target.webkitRequestFullscreen?.());
    },
    onChange(callback) {
      const listener = () => callback();
      doc.addEventListener("fullscreenchange", listener);
      doc.addEventListener("webkitfullscreenchange", listener);
      return () => {
        doc.removeEventListener("fullscreenchange", listener);
        doc.removeEventListener("webkitfullscreenchange", listener);
      };
    },
  };
}

export interface PointerLike {
  readonly pointerType: string;
  readonly buttons: number;
  readonly clientX: number;
  readonly clientY: number;
}
export interface PointerWindow extends Events<PointerLike> {
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly document: Events<unknown> & {
    readonly visibilityState?: string;
    readonly documentElement: Events<unknown>;
  };
}

/**
 * Follows the mouse over the whole window, HUD included, for edge
 * scrolling: null while a button is held, once it leaves the window, when
 * the window loses focus or is hidden. In full screen it cannot leave, so
 * resting it on the outermost pixels keeps scrolling.
 */
export function createPointerSurface(win: PointerWindow): PointerSurface {
  return {
    size: () => ({ width: win.innerWidth, height: win.innerHeight }),
    watch(listener) {
      const move = (event: PointerLike) =>
        listener(
          event.pointerType === "mouse" && !event.buttons
            ? { x: event.clientX, y: event.clientY }
            : null,
        );
      const clear = () => listener(null);
      const hidden = () => {
        if (win.document.visibilityState === "hidden") listener(null);
      };
      win.addEventListener("pointermove", move);
      win.addEventListener("pointerdown", move);
      win.addEventListener("blur", clear);
      win.document.documentElement.addEventListener("mouseleave", clear);
      win.document.addEventListener("visibilitychange", hidden);
      return () => {
        win.removeEventListener("pointermove", move);
        win.removeEventListener("pointerdown", move);
        win.removeEventListener("blur", clear);
        win.document.documentElement.removeEventListener("mouseleave", clear);
        win.document.removeEventListener("visibilitychange", hidden);
      };
    },
  };
}
