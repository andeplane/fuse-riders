import { ATTACK, DOWN, JUMP, LEFT, MAGIC, RIGHT, UP } from "../engine/input.js";
import { directionBits } from "./pad.js";

/**
 * Gamepads, as Fuse Bombers reads them (`games/fuse-bombers/src/app/input/gamepad.ts`), for one hero: the Gamepad API
 * has no button events, so the page polls once an animation frame and holds what the pad holds.
 */

/** The part of a `Gamepad` this reads. */
export interface GamepadLike {
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly {
    readonly pressed: boolean;
    readonly value: number;
  }[];
}

/** Where the pads come from: the browser's `navigator.getGamepads` (`browserGamepads`), a fake in tests. */
export interface GamepadSource {
  pads(): readonly (GamepadLike | null)[];
}

/** How far (0–1) the left stick must lean before it steers, so a worn stick resting off centre does not walk. */
export const STICK_DEAD_ZONE = 0.35;
/** Standard mapping: the d-pad's up, down, left and right buttons. */
const DPAD: readonly (readonly [number, number])[] = [
  [12, UP],
  [13, DOWN],
  [14, LEFT],
  [15, RIGHT],
];
/** The face buttons: A (Cross) attacks, B (Circle) jumps, X (Square) and Y (Triangle) cast magic. */
const FACE: readonly (readonly [number, number])[] = [
  [0, ATTACK],
  [1, JUMP],
  [2, MAGIC],
  [3, MAGIC],
];

const isDown = (button: GamepadLike["buttons"][number] | undefined) =>
  button !== undefined && (button.pressed || button.value > 0.5);

/**
 * The bits `pad` holds: the left stick (past its dead zone, 8-way) or the d-pad walks, the face buttons fight. An
 * unmapped pad has no known d-pad, so only its stick and first four buttons count.
 */
export function gamepadBits(pad: GamepadLike): number {
  let bits = directionBits(pad.axes[0] ?? 0, pad.axes[1] ?? 0, STICK_DEAD_ZONE);
  for (const [button, bit] of FACE)
    if (isDown(pad.buttons[button])) bits |= bit;
  if (pad.mapping === "standard")
    for (const [button, bit] of DPAD)
      if (isDown(pad.buttons[button])) bits |= bit;
  return bits;
}

/**
 * One gamepad drives this device's hero: the one in use. The first pad to press anything takes it, and keeps it while
 * it holds anything; once it lets go, another pad that presses takes over, so a second pad plugged in or a phantom
 * one cannot stand in the way. A pad that goes away lets go of what it held. `hold` hears the driving pad's bits every
 * poll (`HeldControls.hold` logs only changes).
 */
export class GamepadInput {
  private driver: number | undefined;
  constructor(
    private readonly source: GamepadSource,
    private readonly hold: (bits: number) => void,
  ) {}
  poll(): void {
    const held = new Map<number, number>();
    for (const pad of this.source.pads())
      if (pad?.connected) held.set(pad.index, gamepadBits(pad));
    if (this.driver === undefined || !held.get(this.driver))
      for (const [index, bits] of held)
        if (bits) {
          this.driver = index;
          break;
        }
    this.hold(this.driver === undefined ? 0 : (held.get(this.driver) ?? 0));
  }
}

/** The part of `navigator` the browser's gamepads come through. */
export interface GamepadNavigator {
  getGamepads?: () => readonly (GamepadLike | null)[];
}

/**
 * `navigator.getGamepads` as a `GamepadSource`. A browser without the API, or a permissions policy that forbids it
 * (it throws), simply has no pads.
 */
export function browserGamepads(navigator: GamepadNavigator): GamepadSource {
  return {
    pads() {
      try {
        return navigator.getGamepads?.() ?? [];
      } catch {
        return [];
      }
    },
  };
}
