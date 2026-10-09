import type { DeviceId, InputSource } from "./hub.js";

/**
 * Touch zones: big tap areas side by side along the bottom edge, zone i being the device `touch:i`. The app decides
 * how many there are (one per joined touch player, plus a "join" zone in the lobby); each tap in a zone is one
 * press, and several fingers in different zones press independently (multi-touch).
 *
 * Geometry is computed here, in CSS pixels of the surface, and used both for hit testing and for drawing, so what
 * players see is what they hit. Taps between zones count for the nearest one.
 */

/** Height of the zone band: a quarter of the surface, but at least a thumb and at most a palm. */
export function touchBandHeight(height: number): number {
  return Math.min(height, Math.max(80, Math.min(180, height * 0.25)));
}

const ZONE_GAP = 8;

export interface ZoneRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where to draw `count` zones on a `width` × `height` surface, left to right. */
export function touchZoneLayout(
  width: number,
  height: number,
  count: number,
): ZoneRect[] {
  const band = touchBandHeight(height);
  const slice = width / Math.max(count, 1);
  return Array.from({ length: count }, (_, zone) => ({
    x: zone * slice + ZONE_GAP / 2,
    y: height - band + ZONE_GAP / 2,
    width: Math.max(slice - ZONE_GAP, 0),
    height: Math.max(band - ZONE_GAP, 0),
  }));
}

/** The zone at (`x`, `y`) on the surface, or undefined above the band or when there are no zones. */
export function touchZoneAt(
  x: number,
  y: number,
  width: number,
  height: number,
  count: number,
): number | undefined {
  if (count <= 0 || width <= 0 || y < height - touchBandHeight(height))
    return undefined;
  return Math.min(count - 1, Math.max(0, Math.floor((x / width) * count)));
}

/** The part of a `PointerEvent` the touch source reads. */
export type PointerLike = Pick<
  PointerEvent,
  "clientX" | "clientY" | "preventDefault"
>;

/** The element that receives taps (the zone overlay in the browser, a fake in tests). */
export interface PointerTarget {
  addEventListener(
    type: "pointerdown",
    listener: (event: PointerLike) => void,
  ): void;
  removeEventListener(
    type: "pointerdown",
    listener: (event: PointerLike) => void,
  ): void;
  getBoundingClientRect(): {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface TouchSource extends InputSource {
  /** Show `count` zones; taps outside them are ignored. Starts at 0. */
  setZoneCount(count: number): void;
  zoneCount(): number;
  /**
   * Where to draw the zones, relative to the target's top-left corner. Measured from the same rect that taps are
   * hit-tested against, so the drawing cannot drift from the hit areas (scrollbars, mobile URL bars).
   */
  layout(): ZoneRect[];
}

export function attachTouch(
  target: PointerTarget,
  press: (device: DeviceId) => void,
): TouchSource {
  let count = 0;
  const onPointerDown = (event: PointerLike): void => {
    const rect = target.getBoundingClientRect();
    const zone = touchZoneAt(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
      count,
    );
    if (zone === undefined) return;
    event.preventDefault(); // No emulated mouse events, focus or double-tap zoom from a zone tap.
    press(`touch:${zone}`);
  };
  target.addEventListener("pointerdown", onPointerDown);
  return {
    setZoneCount: (next) => {
      count = Math.max(0, Math.floor(next));
    },
    zoneCount: () => count,
    layout: () => {
      const rect = target.getBoundingClientRect();
      return touchZoneLayout(rect.width, rect.height, count);
    },
    dispose: () => target.removeEventListener("pointerdown", onPointerDown),
  };
}
