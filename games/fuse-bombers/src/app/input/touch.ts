import { FIRE } from "../../engine/input.js";
import { stickBits } from "./gamepad.js";
import type { DeviceId, InputSource } from "./hub.js";

/**
 * Touch pads for up to two riders sharing one touch screen: side 0 (the device `touch:0`) in the bottom-left corner
 * and side 1 (`touch:1`) in the bottom-right, each a D-pad and a FIRE button. A finger holds the control it went down
 * on until it lifts, so a thumb on each control, or two players' four thumbs, hold independently (multi-touch). A
 * thumb on the D-pad steers by where it is now: 8 ways, the diagonals between two arrows, so sliding it turns.
 *
 * Geometry is computed here, in CSS pixels of the surface, and used both for hit testing and for drawing, so what
 * players see is what they hit.
 */

/** The most riders one touch screen seats. */
export const TOUCH_SIDES = 2;
/** Of the D-pad's half-width: a finger this close to its centre steers nowhere. */
export const DPAD_DEAD_ZONE = 0.25;
const MARGIN = 12;
/** FIRE's diameter and its gap from the D-pad, as fractions of the D-pad's size. */
const FIRE_SIZE = 0.8;
const FIRE_GAP = 0.25;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One side's controls: a square D-pad and a round FIRE button (`fire` is the circle's bounding square). */
export interface TouchPad {
  readonly side: number;
  readonly dpad: Rect;
  readonly fire: Rect;
}

/**
 * Where the `sides` shown sit on a `width` × `height` surface. Each side has its D-pad with FIRE to its right, in its
 * bottom corner; a lone side (one touch rider in a match) spreads over both corners, D-pad left and FIRE right, a
 * thumb for each. They shrink to fit a phone, never meeting in the middle.
 */
export function touchPadLayout(
  width: number,
  height: number,
  sides: readonly number[],
): TouchPad[] {
  const size = Math.max(
    40,
    Math.min(
      170,
      height * 0.3,
      (width / 2 - 2 * MARGIN) / (1 + FIRE_GAP + FIRE_SIZE),
    ),
  );
  const fire = size * FIRE_SIZE;
  const y = height - MARGIN - size;
  const fireY = y + (size - fire) / 2;
  const solo = sides.length === 1;
  return sides.map((side) => {
    const right = !solo && side === 1;
    const dpadX = right
      ? width - MARGIN - fire - size * (1 + FIRE_GAP)
      : MARGIN;
    const fireX =
      right || solo ? width - MARGIN - fire : MARGIN + size * (1 + FIRE_GAP);
    return {
      side,
      dpad: { x: dpadX, y, width: size, height: size },
      fire: { x: fireX, y: fireY, width: fire, height: fire },
    };
  });
}

/** Where pads sit on a surface: `touchPadLayout` over the arena, `controllerPadLayout` on a phone that is a controller. */
export type PadLayout = typeof touchPadLayout;

/** The top of a controller phone's page, as a fraction of its height, that its header (`online.css`'s `.fb-pad`) keeps. */
export const CONTROLLER_TOP = 0.3;
/**
 * A phone that is only a controller (a shared TV shows the arena): side 0's D-pad and FIRE as big as fit below the
 * top `CONTROLLER_TOP` (the controller's header). Side by side on a wide screen, D-pad left; on a tall one the D-pad
 * at the bottom, under the thumb, and FIRE above it. Only side 0 has pads: any other side is not shown.
 */
export function controllerPadLayout(
  width: number,
  height: number,
  sides: readonly number[],
): TouchPad[] {
  if (!sides.includes(0)) return [];
  const room = height * (1 - CONTROLLER_TOP) - MARGIN;
  const wide = width > height;
  const size = Math.max(
    40,
    wide
      ? Math.min(room, (width - 3 * MARGIN) / 2)
      : Math.min(width - 2 * MARGIN, room * 0.58),
  );
  const fire = Math.max(
    40,
    wide ? size * 0.9 : Math.min(size * 0.75, room - size - MARGIN),
  );
  const y = height - MARGIN - size;
  const square = (x: number, top: number, side: number): Rect => ({
    x,
    y: top,
    width: side,
    height: side,
  });
  return [
    {
      side: 0,
      dpad: square(wide ? MARGIN : (width - size) / 2, y, size),
      fire: wide
        ? square(width - MARGIN - fire, y + (size - fire) / 2, fire)
        : square((width - fire) / 2, y - MARGIN - fire, fire),
    },
  ];
}

const inRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

const inCircle = (r: Rect, x: number, y: number): boolean =>
  Math.hypot(x - r.x - r.width / 2, y - r.y - r.height / 2) <= r.width / 2;

/** The control at (`x`, `y`) among `pads`, or undefined between and outside them. */
export function touchControlAt(
  x: number,
  y: number,
  pads: readonly TouchPad[],
): { side: number; fire: boolean } | undefined {
  for (const pad of pads) {
    if (inCircle(pad.fire, x, y)) return { side: pad.side, fire: true };
    if (inRect(pad.dpad, x, y)) return { side: pad.side, fire: false };
  }
  return undefined;
}

/** The direction bits of a finger at (`x`, `y`) on `dpad`: 8 directions in 45° sectors round a small dead centre. */
export function dpadBits(dpad: Rect, x: number, y: number): number {
  const half = dpad.width / 2;
  return stickBits(
    (x - dpad.x - half) / half,
    (y - dpad.y - dpad.height / 2) / half,
    DPAD_DEAD_ZONE,
  );
}

/** The part of a `PointerEvent` the touch source reads. */
export type PointerLike = Pick<
  PointerEvent,
  "clientX" | "clientY" | "pointerId" | "preventDefault"
> & { readonly target?: EventTarget | null };

type PointerType =
  | "pointerdown"
  | "pointermove"
  | "pointerup"
  | "pointercancel"
  | "lostpointercapture";

/** The element that receives touches (the pad overlay in the browser, a fake in tests). */
export interface PointerTarget {
  addEventListener(
    type: PointerType,
    listener: (event: PointerLike) => void,
  ): void;
  removeEventListener(
    type: PointerType,
    listener: (event: PointerLike) => void,
  ): void;
  getBoundingClientRect(): {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

/**
 * Where the page reports losing focus, and every finger lifting wherever it lifts: `window` in the browser, a fake in
 * tests.
 */
export interface PageTarget {
  addEventListener(
    type: "blur" | "visibilitychange",
    listener: () => void,
  ): void;
  addEventListener(
    type: "pointerup" | "pointercancel",
    listener: (event: PointerLike) => void,
  ): void;
  removeEventListener(
    type: "blur" | "visibilitychange",
    listener: () => void,
  ): void;
  removeEventListener(
    type: "pointerup" | "pointercancel",
    listener: (event: PointerLike) => void,
  ): void;
}

export interface TouchSource extends InputSource {
  /** Show the pads of these sides, placed by `layout`; touches elsewhere are ignored, and fingers on a side that goes
   * away let go. */
  setSides(sides: readonly number[], layout?: PadLayout): void;
  /**
   * Where to draw the shown pads, relative to the target's top-left corner. Measured from the same rect that
   * touches are hit-tested against, so the drawing cannot drift from the hit areas (scrollbars, mobile URL bars).
   */
  layout(): TouchPad[];
}

/**
 * Report each side's held bits (`hold`, the hub's `setHeld`) as fingers go down, slide and lift. The touched element
 * captures its finger, so sliding off FIRE still holds fire and a thumb past the D-pad's edge still steers, until it
 * lifts. Every way a lift can go missing lets go too: a cancelled pointer (a system gesture), a lost capture (the
 * element hidden), and the page losing focus or visibility (`page`), when no pointerup will come. A browser that
 * cannot capture the pointer sends the lift of a finger that slid off its pad to whatever is under it, so the page
 * listens for lifts and cancels as well, wherever they land.
 */
export function attachTouch(
  target: PointerTarget,
  hold: (device: DeviceId, bits: number) => void,
  page: PageTarget,
): TouchSource {
  let sides: readonly number[] = [],
    place: PadLayout = touchPadLayout;
  const fingers = new Map<number, { side: number; bits: number }>();
  const pads = (): TouchPad[] => {
    const rect = target.getBoundingClientRect();
    return place(rect.width, rect.height, sides);
  };
  const point = (event: PointerLike): [number, number] => {
    const rect = target.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const report = (side: number): void => {
    let bits = 0;
    for (const finger of fingers.values())
      if (finger.side === side) bits |= finger.bits;
    hold(`touch:${side}`, bits);
  };
  const steer = (side: number, x: number, y: number): number => {
    const pad = pads().find((p) => p.side === side);
    return pad ? dpadBits(pad.dpad, x, y) : 0;
  };
  const releaseWhere = (release: (side: number) => boolean): void => {
    const released = new Set<number>();
    for (const [id, finger] of fingers)
      if (release(finger.side)) {
        fingers.delete(id);
        released.add(finger.side);
      }
    for (const side of released) report(side);
  };
  const releaseAll = (): void => releaseWhere(() => true);

  const onDown = (event: PointerLike): void => {
    const [x, y] = point(event);
    const control = touchControlAt(x, y, pads());
    if (!control) return;
    event.preventDefault(); // No emulated mouse events, focus or double-tap zoom from a pad.
    const element = event.target as Partial<
      Pick<Element, "setPointerCapture">
    > | null;
    try {
      // Moves and the lift come back here even once the finger slides off; a pointer no longer tracked cannot be.
      element?.setPointerCapture?.(event.pointerId);
    } catch {
      /* without capture the page's own pointerup and pointercancel listeners still hear the lift */
    }
    const bits = control.fire ? FIRE : steer(control.side, x, y);
    fingers.set(event.pointerId, { side: control.side, bits });
    report(control.side);
  };
  const onMove = (event: PointerLike): void => {
    const finger = fingers.get(event.pointerId);
    if (!finger || finger.bits & FIRE) return;
    const bits = steer(finger.side, ...point(event));
    if (bits === finger.bits) return;
    finger.bits = bits;
    report(finger.side);
  };
  const onUp = (event: PointerLike): void => {
    const finger = fingers.get(event.pointerId);
    if (!finger) return;
    fingers.delete(event.pointerId);
    report(finger.side);
  };

  const listeners: [PointerType, (event: PointerLike) => void][] = [
    ["pointerdown", onDown],
    ["pointermove", onMove],
    ["pointerup", onUp],
    ["pointercancel", onUp],
    ["lostpointercapture", onUp],
  ];
  for (const [type, listener] of listeners)
    target.addEventListener(type, listener);
  page.addEventListener("blur", releaseAll);
  page.addEventListener("visibilitychange", releaseAll);
  page.addEventListener("pointerup", onUp);
  page.addEventListener("pointercancel", onUp);
  return {
    setSides: (next, layout = touchPadLayout) => {
      place = layout;
      sides = [...new Set(next)]
        .filter(
          (side) => Number.isInteger(side) && side >= 0 && side < TOUCH_SIDES,
        )
        .sort((a, b) => a - b);
      releaseWhere((side) => !sides.includes(side));
    },
    layout: pads,
    dispose: () => {
      for (const [type, listener] of listeners)
        target.removeEventListener(type, listener);
      page.removeEventListener("blur", releaseAll);
      page.removeEventListener("visibilitychange", releaseAll);
      page.removeEventListener("pointerup", onUp);
      page.removeEventListener("pointercancel", onUp);
    },
  };
}
