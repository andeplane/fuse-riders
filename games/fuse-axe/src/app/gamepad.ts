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
 * One gamepad drives this device's hero: the last to press. A pad's press is its bits changing to something held, and
 * the first pad to hold anything drives until another presses, so a phantom pad whose axis sits off centre (or a
 * resting one) cannot stand in the way of a real pad, and a second pad plugged in takes over only when it is used. The
 * driver keeps the hero while it holds anything, and a pad that goes away lets go of what it held. `hold` hears the
 * driving pad's bits every poll (`HeldControls.hold` logs only changes).
 *
 * A pad held through `letGo` (blur, a hidden page, the phone's MENU) or while a poll is not `active` is read as
 * neutral until it lets go itself, so the stick or button that was down does not come straight back the next frame.
 */
export class GamepadInput {
  private driver: number | undefined;
  /** Each connected pad's bits at the last poll, to tell which one has just pressed. */
  private seen = new Map<number, number>();
  /** The pads held when input was let go, which are read as neutral until they are. */
  private readonly latched = new Set<number>();
  constructor(
    private readonly source: GamepadSource,
    private readonly hold: (bits: number) => void,
  ) {}
  /** Lets go of everything the pads hold, now and until each lets go itself. */
  letGo(): void {
    this.poll(false);
  }
  /** Reads the pads and holds the driver's bits; while not `active` (a hidden page, MENU open) it holds none. */
  poll(active = true): void {
    const bits = new Map<number, number>();
    for (const pad of this.source.pads()) {
      if (!pad?.connected) continue;
      const held = gamepadBits(pad);
      if (!held) this.latched.delete(pad.index);
      else if (!active) this.latched.add(pad.index);
      bits.set(pad.index, this.latched.has(pad.index) ? 0 : held);
    }
    for (const index of this.latched)
      if (!bits.has(index)) this.latched.delete(index);
    if (this.driver !== undefined && !bits.has(this.driver))
      this.driver = undefined;
    for (const [index, held] of bits)
      if (held && (this.driver === undefined || held !== this.seen.get(index)))
        this.driver = index;
    this.seen = bits;
    this.hold(
      active && this.driver !== undefined ? (bits.get(this.driver) ?? 0) : 0,
    );
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
