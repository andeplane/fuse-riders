import type { ControllerButton } from "fuse-ui";
import { ATTACK, DOWN, JUMP, LEFT, MAGIC, RIGHT, UP } from "../engine/input.js";

/**
 * The phone's pads: an 8-way d-pad a thumb slides on, and the Attack, Jump and Magic buttons. They only hold bits in
 * `HeldControls` like the keys do, so a double tap of Left or Right on the d-pad (a lift and a second tap, or a slide
 * back through the centre and out again) is the same press, release, press the engine reads as a run.
 */

/** sin(22.5°): an axis counts once a lean is within 67.5° of it, which splits the circle into 8 equal sectors. */
const SECTOR = Math.sin(Math.PI / 8);
/** How far from the d-pad's centre, as a fraction of its radius, a thumb must lean before it steers. */
export const PAD_DEAD_ZONE = 0.25;

/**
 * Direction bits for a lean of (`x`, `y`), y growing downward as on the screen and a stick's axes (up is into the
 * road): none within `deadZone` of the centre, else the nearest of 8 directions, each straight and each diagonal a 45°
 * sector. A lean past the edge still steers by its angle, so a thumb that slides off the pad keeps its direction.
 * Non-finite leans count as centred.
 */
export function directionBits(x: number, y: number, deadZone: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  const lean = Math.hypot(x, y);
  if (lean <= deadZone) return 0;
  const edge = lean * SECTOR;
  return (
    (y < -edge ? UP : 0) |
    (y > edge ? DOWN : 0) |
    (x < -edge ? LEFT : 0) |
    (x > edge ? RIGHT : 0)
  );
}

/** The directions `bits` holds, as words for the d-pad's `data-dir` (CSS lights those arrows): "up left", "". */
export function directionName(bits: number): string {
  return (
    [
      [UP, "up"],
      [DOWN, "down"],
      [LEFT, "left"],
      [RIGHT, "right"],
    ] as const
  )
    .filter(([bit]) => bits & bit)
    .map(([, word]) => word)
    .join(" ");
}

/** The parts of a pointer event the d-pad reads. */
export interface PadPointer {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  preventDefault(): void;
}
export type PadEvent =
  | "pointerdown"
  | "pointermove"
  | "pointerup"
  | "pointercancel"
  | "lostpointercapture";
/** The d-pad's element (a fake in tests): where a thumb lands, its box, and capture so a slide off its edge steers on. */
export interface PadSurface {
  addEventListener(type: PadEvent, listener: (event: PadPointer) => void): void;
  getBoundingClientRect(): {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  setPointerCapture(pointerId: number): void;
}

/**
 * One thumb on the d-pad. The first pointer down steers until it lifts or the browser cancels it; a second finger on
 * the pad is ignored, so it cannot take the first one's direction away. Each move picks the direction from the thumb's
 * place against the pad's centre (`directionBits`), so sliding round the pad walks the diagonals and sliding back to
 * the centre lets go. `hold` hears every change of the bits, 0 for none.
 */
export class DPad {
  private pointer: number | undefined;
  private held = 0;
  constructor(
    private readonly surface: PadSurface,
    private readonly hold: (bits: number) => void,
    private readonly deadZone = PAD_DEAD_ZONE,
  ) {
    surface.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (this.pointer !== undefined || event.button !== 0) return;
      // Capture is what brings the lift (or a cancel) to the pad from anywhere on the screen. A pointer the browser
      // will not let the pad capture is one it no longer tracks, so its lift may never come: it steers nothing.
      try {
        surface.setPointerCapture(event.pointerId);
      } catch {
        return;
      }
      this.pointer = event.pointerId;
      this.steer(event);
    });
    surface.addEventListener("pointermove", (event) => {
      if (event.pointerId === this.pointer) this.steer(event);
    });
    for (const type of [
      "pointerup",
      "pointercancel",
      "lostpointercapture",
    ] as const)
      surface.addEventListener(type, (event) => this.lift(event.pointerId));
  }
  get bits(): number {
    return this.held;
  }
  /**
   * The browser reports pointer `pointerId` lifted or cancelled, wherever on the page: the page passes on every lift it
   * hears, for a thumb whose lift landed elsewhere than on the pad (it slid off, or the pad moved). Only the pad's own
   * thumb ends its press.
   */
  lift(pointerId: number): void {
    if (pointerId === this.pointer) this.cancel();
  }
  /** Lets go: the thumb lifted, or the page lost focus or went hidden. Its later moves steer nothing. */
  cancel(): void {
    this.pointer = undefined;
    this.set(0);
  }
  private steer(event: PadPointer): void {
    const box = this.surface.getBoundingClientRect(),
      radius = Math.min(box.width, box.height) / 2;
    if (radius <= 0) return;
    this.set(
      directionBits(
        (event.clientX - box.left - box.width / 2) / radius,
        (event.clientY - box.top - box.height / 2) / radius,
        this.deadZone,
      ),
    );
  }
  private set(bits: number): void {
    if (bits === this.held) return;
    this.held = bits;
    this.hold(bits);
  }
}

/** The buttons beside the d-pad, with the keys they stand for. */
export const PAD_BUTTONS = [
  { label: "ATTACK", bit: ATTACK, keys: "J Z" },
  { label: "JUMP", bit: JUMP, keys: "K X" },
  { label: "MAGIC", bit: MAGIC, keys: "L C" },
] as const;

/** The source a button holds its bit under in `HeldControls`. */
export const padSource = (label: string): string => `pad:${label}`;

/**
 * The buttons as fuse-ui's controller row takes them: each holds its bit from press to release under its own source,
 * so two thumbs on two buttons hold both.
 */
export function padButtons(
  hold: (source: string, bits: number) => void,
): ControllerButton[] {
  return PAD_BUTTONS.map(({ label, bit, keys }) => ({
    label,
    keys,
    onPress: () => hold(padSource(label), bit),
    onRelease: () => hold(padSource(label), 0),
  }));
}

/**
 * Lets go of the pads, and only the pads: the d-pad's thumb and every button's hold, keys held on a keyboard stay held.
 * For when the pads are moved under a thumb (onto the phone's controller and back): a browser need not tell a pad that
 * has changed its place in the page when the thumb lifts, and nothing may stay held for want of that.
 */
export function releasePads(
  dpad: DPad,
  hold: (source: string, bits: number) => void,
): void {
  dpad.cancel();
  for (const { label } of PAD_BUTTONS) hold(padSource(label), 0);
}
